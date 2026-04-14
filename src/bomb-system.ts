// BombSystem — spawns 💩 bombs that fly out from the player, blink red,
// and detonate in a radius. Triggered by VoiceSystem (phrase match) or
// the B keyboard shortcut. Each bomb is a small state machine:
//
//   flying  → moves forward for BOMB_FLY_MS at BOMB_FLY_SPEED
//   blinking → stationary, pulses red at an accelerating tempo
//   exploding → brief orange flash, AoE damage via GameActions.explodeAt

import {
  createSystem,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  AdditiveBlending,
  Vector3,
  Object3D,
} from "@iwsdk/core";
import {
  GameActions,
  GameState,
  BOMB_THROW_FWD,
  BOMB_THROW_UP,
  BOMB_GRAVITY,
  BOMB_FLOOR_Y,
  BOMB_MAX_FLY_MS,
  BOMB_BLINK_MS,
  BOMB_EXPLOSION_RADIUS,
  BOMB_EXPLOSION_MS,
  BOMB_COOLDOWN_MS,
} from "./game-state.js";
import { FX } from "./game-fx.js";

type BombStage = "flying" | "blinking" | "exploding";
type Bomb = {
  root: Object3D;              // parent group that holds the emoji + boom sphere
  sprite: Sprite;              // 💩 emoji billboard
  blast: Mesh;                 // hidden until detonation
  velocity: Vector3;
  spawnedAt: number;           // ms epoch — stage timing is derived from age
  stage: BombStage;
  stageStartedAt: number;
  lastTickAt: number;          // throttle for the tick sound
  exploded: boolean;           // kill path runs once
};

function makePoopSprite(size = 0.45): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.font = '108px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("💩", 64, 70);
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new SpriteMaterial({ map: tex, transparent: true, depthWrite: true });
  const s = new Sprite(mat);
  s.scale.set(size, size, 1);
  return s;
}

function makeBlastMesh(): Mesh {
  // Additive-blended orange sphere — draws bright wherever it overlaps
  // other geometry, reading as a flash without needing a particle system.
  const mat = new MeshBasicMaterial({
    color: 0xffa500,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new Mesh(new SphereGeometry(1, 24, 16), mat);
  mesh.visible = false;
  return mesh;
}

export class BombSystem extends createSystem({}) {
  private bombs: Bomb[] = [];
  private lastSpawnAt = 0;

  init() {
    GameActions.setSpawnBomb(
      this.world.globals as Record<string, unknown>,
      () => this.spawnBomb(),
    );
  }

  // Called by VoiceSystem (phrase match) or PortalSystem keyboard handler.
  //
  // Grenade-style launch — bomb spawns at chest height just in front of
  // the player, with initial velocity = (horizontal forward) + (upward
  // kick). Gravity applies per-frame so it arcs and lands on the floor
  // in front of wherever the player was facing.
  //
  // Gated on bombCharges — must have picked up a 💩 item first. Throwing
  // consumes one charge.
  private spawnBomb() {
    const now = performance.now();
    if (now - this.lastSpawnAt < BOMB_COOLDOWN_MS) return; // spam guard
    const globals = this.world.globals as Record<string, unknown>;
    const charges = GameState.bombCharges(globals);
    if (charges.peek() <= 0) {
      console.log('[Bomb] no charges — pick up a 💩 first');
      return;
    }
    this.lastSpawnAt = now;
    charges.value = charges.peek() - 1;

    const head = this.player.head;
    const headPos = new Vector3();
    head.getWorldPosition(headPos);
    // Head forward — IWSDK/WebXR head Object3D exposes +Z as its axis
    // column, which points OUT THE BACK of the user, so we negate to
    // get the looking-forward direction. Flatten Y so the arc is level
    // with the ground regardless of head pitch.
    const forward = new Vector3();
    head.getWorldDirection(forward);
    forward.negate();
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();

    const root = new Object3D();
    const sprite = makePoopSprite();
    root.add(sprite);
    const blast = makeBlastMesh();
    root.add(blast);

    // Spawn at chest height, a bit ahead of the face so it doesn't clip.
    root.position.copy(headPos);
    root.position.y -= 0.35;
    root.position.addScaledVector(forward, 0.35);
    this.scene.add(root);

    // Launch velocity: forward component + upward kick for the arc.
    const velocity = forward.clone().multiplyScalar(BOMB_THROW_FWD);
    velocity.y = BOMB_THROW_UP;

    const bomb: Bomb = {
      root,
      sprite,
      blast,
      velocity,
      spawnedAt: now,
      stage: "flying",
      stageStartedAt: now,
      lastTickAt: 0,
      exploded: false,
    };
    this.bombs.push(bomb);
    FX.bombThrow(this.input.gamepads.right ?? this.input.gamepads.left);
  }

  update(delta: number) {
    if (this.bombs.length === 0) return;
    const now = performance.now();

    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      const age = now - b.spawnedAt;

      if (b.stage === "flying") {
        // Integrate gravity into velocity, advance position.
        b.velocity.y -= BOMB_GRAVITY * delta;
        b.root.position.addScaledVector(b.velocity, delta);

        // Landed on the floor → pin and transition to blinking.
        if (b.root.position.y <= BOMB_FLOOR_Y) {
          b.root.position.y = BOMB_FLOOR_Y;
          b.velocity.set(0, 0, 0);
          b.stage = "blinking";
          b.stageStartedAt = now;
        } else if (age > BOMB_MAX_FLY_MS) {
          // Safety net — if the bomb somehow never lands (shouldn't
          // happen in a grounded room, but guard anyway), detonate in
          // place instead of leaking the entity forever.
          b.stage = "blinking";
          b.stageStartedAt = now;
        }
      } else if (b.stage === "blinking") {
        // Blink rate ramps up across the window. Freq = 4 Hz → 16 Hz.
        const sinceBlink = now - b.stageStartedAt;
        const t = sinceBlink / BOMB_BLINK_MS;
        const freq = 4 + t * 12;
        const on = Math.sin(now / 1000 * Math.PI * 2 * freq) > 0;
        const mat = b.sprite.material as SpriteMaterial;
        mat.color.setRGB(on ? 2 : 1, on ? 0.3 : 1, on ? 0.3 : 1);
        // Periodic tick sound — faster as it gets closer to boom.
        const tickGap = Math.max(50, 300 - t * 250);
        if (now - b.lastTickAt >= tickGap) {
          b.lastTickAt = now;
          FX.bombTick();
        }
        if (t >= 1) {
          this.detonate(b);
        }
      } else {
        // Exploding — blast sphere scales out then we retire.
        const since = now - b.stageStartedAt;
        const p = Math.min(1, since / BOMB_EXPLOSION_MS);
        const scale = BOMB_EXPLOSION_RADIUS * (0.2 + 0.8 * p);
        b.blast.scale.setScalar(scale);
        const mat = b.blast.material as MeshBasicMaterial;
        mat.opacity = (1 - p) * 0.9;
        b.sprite.visible = false;
        if (since >= BOMB_EXPLOSION_MS) {
          this.scene.remove(b.root);
          this.disposeBomb(b);
          this.bombs.splice(i, 1);
        }
      }
    }
  }

  private detonate(b: Bomb) {
    if (b.exploded) return;
    b.exploded = true;
    b.stage = "exploding";
    b.stageStartedAt = performance.now();
    b.blast.visible = true;
    b.blast.scale.setScalar(0.2);
    (b.blast.material as MeshBasicMaterial).opacity = 0.9;

    // Apply AoE damage via PortalSystem's exposed callback. Horizontal
    // radius match — the explode helper ignores Y.
    const globals = this.world.globals as Record<string, unknown>;
    const explode = GameActions.explodeAt(globals);
    const p = b.root.position;
    explode?.(p.x, p.y, p.z, BOMB_EXPLOSION_RADIUS);
    FX.bombExplode(this.input.gamepads.right ?? this.input.gamepads.left);
  }

  private disposeBomb(b: Bomb) {
    const smat = b.sprite.material as SpriteMaterial;
    if (smat.map) smat.map.dispose();
    smat.dispose();
    b.blast.geometry.dispose();
    (b.blast.material as MeshBasicMaterial).dispose();
  }
}
