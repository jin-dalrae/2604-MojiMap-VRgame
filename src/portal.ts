import {
  createSystem,
  Vector3,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  CylinderGeometry,
  ConeGeometry,
  BoxGeometry,
  DoubleSide,
  Object3D,
  LocomotionEnvironment,
  EnvironmentType,
} from "@iwsdk/core";
import { type Signal } from "@preact/signals-core";
import { FX } from "./game-fx.js";
import {
  GameState,
  GameActions,
  RESULT_DISPLAY_MS,
  type RoundEndReason,
  type RoundResult,
  isPickup,
  isHazard,
  MAX_HEALTH,
  GOAL_POINTS,
  POWERUP_HEAL,
  FIRE_DPS,
  FIRE_RADIUS,
  PICKUP_RADIUS,
  ENEMY_DAMAGE_RADIUS,
  enemyStats,
  SWORD_RADIUS,
  SWORD_DAMAGE,
  SWORD_COOLDOWN_MS,
  WARP_RADIUS,
  WARP_COOLDOWN_MS,
  WALL_CELL_HALF,
  enemyBehavior,
  type ItemRole,
} from "./game-state.js";

// ── Grid coordinate mapping ──────────────────────────────────
// Portal grid: 20 cols × 10 rows
// Cell (row r, col c) center → world: x = c - 9.5, z = r - 4.5.
// y is chosen so the billboarded sprite hovers just above the grid floor.
function gridToWorld(row: number, col: number): [number, number, number] {
  return [col - 9.5, 0.55, row - 4.5];
}

// ── Emoji sprite factory ─────────────────────────────────────
// Render the emoji onto a CanvasTexture wrapped in a Three.js Sprite so
// it always faces the headset. For pickups we also paint a soft white
// radial halo underneath — reads as "collectible" at a glance. Hazards
// get a subtle red aura so players know to keep their distance.
function makeEmojiSprite(
  emoji: string,
  role: ItemRole = "decor",
  size = 1.1,
): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;

  if (isPickup(role)) {
    // Soft white disc behind emoji — affordance for "grab me"
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0.0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
  } else if (role === "warp") {
    // Purple swirl aura — reads as "portal/teleport", distinct from pickups
    const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
    grad.addColorStop(0, "rgba(168,85,247,0.85)");
    grad.addColorStop(0.6, "rgba(168,85,247,0.35)");
    grad.addColorStop(1, "rgba(168,85,247,0.0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
  } else if (isHazard(role)) {
    // Red glow — danger signal, no "pickup" affordance
    const grad = ctx.createRadialGradient(64, 64, 12, 64, 64, 60);
    grad.addColorStop(0, "rgba(239,68,68,0.55)");
    grad.addColorStop(1, "rgba(239,68,68,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = '108px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 64, 70);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.05,
    depthWrite: true,
  });
  const sprite = new Sprite(material);
  sprite.scale.set(size, size, 1);
  return sprite;
}

// ── Avatar colors (same palette as broadcast + portal) ──────
const AVATAR_COLORS = [
  0x6366f1, 0xec4899, 0xf59e0b, 0x10b981,
  0x3b82f6, 0xef4444, 0xa855f7, 0x14b8a6,
];
function colorForUser(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// Shared cone geometry for avatar facing indicators (allocated once).
// Tip at origin, base extends forward (+Z) — rotates with avatar heading.
const avatarConeGeom = new ConeGeometry(0.5, 1.2, 20, 1, true);
avatarConeGeom.rotateX(-Math.PI / 2); // tip → -Z, base → +Z
avatarConeGeom.translate(0, 0, 0.6);  // tip at z=0, base at z=1.2

type AvatarRecord = {
  root: Object3D;
  cone: Mesh;
  entity: { dispose(): void };
  // Dead = spectator. Avatar still updates position so the portal can
  // render them moving, but they're translucent and enemy AI ignores them.
  dead: boolean;
  // Materials referenced by setOpacity — cached so we don't walk the
  // subtree every frame.
  materials: MeshBasicMaterial[];
  baseOpacities: number[];
};

// ── System ───────────────────────────────────────────────────
// Wall ("cube") items are rendered as real 3D geometry, not sprites,
// so players can treat them as spatial obstacles. Tall enough to block
// over-the-top shots but short enough to peek above if standing.
const WALL_WIDTH  = 0.95;   // m — leaves a narrow gap between grid cells
const WALL_HEIGHT = 2.2;
const WALL_COLOR  = 0x3b82f6; // Tailwind blue-500 — matches the 🟦 emoji

type SpawnedItem = {
  entity: { dispose(): void };
  // The visual Object3D. Sprites for emoji items, Meshes for walls.
  // `kind` lets animateItems/collision skip irrelevant branches cleanly.
  object3D: Sprite | Mesh;
  kind: 'sprite' | 'wall';
  role: ItemRole;
  // Portal's `type` string (e.g. "robot", "ghost"). Drives per-variant
  // enemy stats via enemyStats() — decor/pickups ignore it.
  type: string;
  baseSize: number;
  // Original grid cell position — used to snap enemies back home when
  // the round ends and they've drifted from chasing the player.
  origin: [number, number, number];
  hp: number;
  nextDamageableAt: number; // ms epoch; 0 = always hittable
};

export class PortalSystem extends createSystem({}) {
  private ws: WebSocket | null = null;
  private spawnedEntities = new Map<string, SpawnedItem>();
  private avatars = new Map<string, AvatarRecord>();
  private lastPosSend = 0;
  private tempPos!: Vector3;
  private tempFwd!: Vector3;
  private tempGrip!: Vector3;
  private tempChase!: Vector3;
  // Cooldown gates — keeps sword from deleting enemies in a single tick
  // by virtue of being inside their hit radius for several frames.
  private lastSwordHitAt = 0;
  // Warp cooldown + exclusion — after a teleport the player keeps drifting
  // inside the destination warp's radius for a frame or two. We block
  // re-triggers globally for WARP_COOLDOWN_MS, and additionally exclude
  // the destination warp until the player physically walks out of it.
  private warpCooldownUntil = 0;
  private lockedWarpKey: string | null = null;
  private userId: string | null = null;

  // Round/game state signals — shared via world.globals. PortalSystem
  // writes most of these; WeaponSystem and HUDSystem only read.
  private roundRunning!: Signal<boolean>;
  private roundEndsAt!: Signal<number>; // ms epoch, 0 when idle
  private score!: Signal<number>;
  private playerHealth!: Signal<number>;
  private equippedLeft!: Signal<"sword" | null>;
  private equippedRight!: Signal<"gun" | null>;
  private roundResult!: Signal<RoundResult | null>;
  private goalsTotal!: Signal<number>;
  private goalsCollected!: Signal<number>;
  private isDead!: Signal<boolean>;
  // Skull target state — rotates periodically between live players.
  // userId -> last-retarget timestamp; enemy-specific state lives in
  // SpawnedItem but target-tracking needs the player list too.
  private skullTargetUserId: string | null = null;
  private skullRetargetAt = 0;
  // spaceId is the Quest Shared Spaces XRSharedReferenceSpace UUID when available.
  // Set externally (e.g. by a future SharedSpaceSystem that requests the "shared"
  // feature and listens for the reference space UUID); forwarded on every update.
  public spaceId: string | null = null;
  // Pre-allocated to avoid update() allocations. The stats fields ride
  // along with every position packet so observers (portal/broadcast) can
  // render a leaderboard at the native 10 Hz update cadence.
  private posMsg: {
    type: string;
    position: { x: number; z: number; heading: number; pitch: number };
    score: number;
    health: number;
    goalsCollected: number;
    goalsTotal: number;
    dead: boolean;
    spaceId: string | null;
  } = {
    type: 'PLAYER_POSITION',
    position: { x: 0, z: 0, heading: 0, pitch: 0 },
    score: 0,
    health: MAX_HEALTH,
    goalsCollected: 0,
    goalsTotal: 0,
    dead: false,
    spaceId: null,
  };

  init() {
    this.tempPos = new Vector3();
    this.tempFwd = new Vector3();
    this.tempGrip = new Vector3();
    this.tempChase = new Vector3();

    const globals = this.world.globals as Record<string, unknown>;
    this.roundRunning  = GameState.roundRunning(globals);
    this.roundEndsAt   = GameState.roundEndsAt(globals);
    this.score         = GameState.score(globals);
    this.playerHealth  = GameState.playerHealth(globals);
    this.equippedLeft  = GameState.equippedLeft(globals);
    this.equippedRight = GameState.equippedRight(globals);
    this.roundResult   = GameState.roundResult(globals);
    this.goalsTotal     = GameState.goalsTotal(globals);
    this.goalsCollected = GameState.goalsCollected(globals);
    this.isDead         = GameState.isDead(globals);

    // Expose damage entry-point for ProjectileSystem + any future attackers.
    // Passing the key lets the callback do O(1) lookup + broadcast GRID_CLEAR.
    GameActions.setDamageEnemy(globals, (key, amount) => this.damageEnemy(key, amount));
    GameActions.setFindEnemyAt(globals, (x, y, z, r2) => this.findEnemyAt(x, y, z, r2));

    this.connectWS();
  }

  // Nearest enemy within squared radius, or null. Linear scan — fine
  // for the few dozen items a round has; swap to a spatial hash if we
  // ever push past a couple hundred.
  private findEnemyAt(x: number, y: number, z: number, r2: number): string | null {
    let bestKey: string | null = null;
    let bestD2 = r2;
    for (const [key, item] of this.spawnedEntities) {
      if (item.role !== 'enemy') continue;
      const dx = item.object3D.position.x - x;
      const dy = item.object3D.position.y - y;
      const dz = item.object3D.position.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestKey = key;
      }
    }
    return bestKey;
  }

  // Returns true if the hit killed the enemy (so callers can skip further
  // processing against a now-gone entity).
  private damageEnemy(key: string, amount: number): boolean {
    const item = this.spawnedEntities.get(key);
    if (!item || item.role !== 'enemy') return false;
    item.hp -= amount;
    if (item.hp <= 0) {
      this.score.value = this.score.peek() + enemyStats(item.type).killPoints;
      this.despawnItem(key);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'GRID_CLEAR', key }));
      }
      // Either hand works for the kill thump; prefer whichever has a pad.
      FX.enemyKill(this.input.gamepads.right ?? this.input.gamepads.left);
      return true;
    }
    return false;
  }

  private connectWS() {
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const url = isLocal ? `ws://${location.hostname}:3001` : `wss://ar-app-ws-production.up.railway.app`;
    console.log(`[GridSync] Connecting → ${url}`);
    const ws = new WebSocket(url);

    ws.onopen = () => console.log('[GridSync] Connected');

    ws.onmessage = (e: MessageEvent) => {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.handleMessage(msg);
    };

    ws.onclose = () => {
      console.log('[GridSync] Disconnected — retrying in 2s');
      setTimeout(() => this.connectWS(), 2000);
    };

    this.cleanupFuncs.push(() => ws.close());
    this.ws = ws;
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'WELCOME':
        this.userId = msg.userId;
        console.log(`[GridSync] Joined as ${this.userId?.slice(0, 8)}`);
        for (const key of [...this.spawnedEntities.keys()]) this.despawnItem(key);
        for (const [key, item] of Object.entries(msg.grid as Record<string, any>)) {
          this.spawnItem(key, item);
        }
        for (const [, av] of this.avatars) this.disposeAvatar(av);
        this.avatars.clear();
        for (const [uid, user] of Object.entries(msg.users as Record<string, any>)) {
          if (uid !== this.userId) this.updateAvatar(uid, user.position, !!user.dead);
        }
        // Adopt any round already in progress on the server.
        if (msg.round && msg.round.endsAt > Date.now()) {
          this.roundEndsAt.value = msg.round.endsAt;
          this.roundRunning.value = true;
        } else {
          this.roundEndsAt.value = 0;
          this.roundRunning.value = false;
        }
        break;

      case 'ROUND_START': {
        console.log(`[Round] Started — ends at ${new Date(msg.endsAt).toISOString()}`);
        // Fresh run: clear inventory + score, heal up. WeaponSystem reacts
        // via the signal subscription and despawns any weapon meshes.
        this.score.value = 0;
        this.playerHealth.value = MAX_HEALTH;
        this.equippedLeft.value = null;
        this.equippedRight.value = null;
        this.isDead.value = false;
        this.roundEndsAt.value = msg.endsAt;
        this.roundRunning.value = true;
        // Snapshot goal count so checkWin() knows if this was a
        // goal-based round (ignore survival rounds with zero goals).
        let total = 0;
        for (const item of this.spawnedEntities.values()) {
          if (item.role === 'goal') total++;
        }
        this.goalsTotal.value = total;
        this.goalsCollected.value = 0;
        // Teleport the player to a spawn point — deterministic by userId
        // so two players reliably get different chairs when possible.
        this.teleportToSpawn();
        this.skullTargetUserId = null;
        this.skullRetargetAt = 0;
        FX.roundStart();
        break;
      }

      case 'ROUND_END': {
        const finalScore = this.score.peek();
        const reason = (msg.reason ?? 'timeout') as RoundEndReason;
        console.log(`[Round] Ended (${reason}) — final score: ${finalScore}`);
        this.roundEndsAt.value = 0;
        this.roundRunning.value = false;
        // Drop weapons at round end per design ("if you drop your weapons,
        // they despawn"). Health stays so the player sees their final state.
        this.equippedLeft.value = null;
        this.equippedRight.value = null;
        // HUD shows the result overlay; it clears the signal when it hides.
        this.roundResult.value = {
          reason,
          score: finalScore,
          expiresAt: Date.now() + RESULT_DISPLAY_MS,
        };
        // Reason-driven cue — completion feels different from timeout/death.
        if      (reason === 'completed') FX.roundWin();
        else if (reason === 'died')      FX.roundLose();
        else                             FX.roundTimeout();
        break;
      }

      case 'GRID_UPDATE':
        this.despawnItem(msg.key);
        this.spawnItem(msg.key, msg.item);
        break;

      case 'GRID_SYNC':
        // Server sends this at ROUND_END to restore the designer's
        // original layout. Blow away everything we have and repopulate
        // from the payload so any picked-up items reappear.
        for (const key of [...this.spawnedEntities.keys()]) this.despawnItem(key);
        for (const [key, item] of Object.entries(msg.grid as Record<string, any>)) {
          this.spawnItem(key, item);
        }
        break;

      case 'GRID_CLEAR':
        this.despawnItem(msg.key);
        break;

      case 'GRID_CLEAR_ALL':
        for (const key of [...this.spawnedEntities.keys()]) this.despawnItem(key);
        break;

      case 'USER_JOIN':
        if (msg.userId !== this.userId) this.updateAvatar(msg.userId, msg.position);
        break;

      case 'USER_LEAVE': {
        const av = this.avatars.get(msg.userId);
        if (av) { this.disposeAvatar(av); this.avatars.delete(msg.userId); }
        break;
      }

      case 'PLAYER_POSITION':
        if (msg.userId !== this.userId) {
          this.updateAvatar(msg.userId, msg.position, !!msg.dead);
        }
        break;
    }
  }

  // ── Avatar management ─────────────────────────────────────
  private createAvatar(userId: string): AvatarRecord {
    const color = colorForUser(userId);
    const root = new Object3D();
    // All body materials are created transparent so dead=translucent is
    // a cheap opacity write (no remake required).
    const materials: MeshBasicMaterial[] = [];
    const baseOpacities: number[] = [];
    const addMat = (m: MeshBasicMaterial) => {
      m.transparent = true;
      materials.push(m);
      baseOpacities.push(m.opacity);
      return m;
    };

    const body = new Mesh(
      new CylinderGeometry(0.15, 0.15, 0.6, 12),
      addMat(new MeshBasicMaterial({ color })),
    );
    body.position.y = 0.7;
    root.add(body);

    const head = new Mesh(
      new SphereGeometry(0.2, 16, 16),
      addMat(new MeshBasicMaterial({ color })),
    );
    head.position.y = 1.2;
    root.add(head);

    const face = makeEmojiSprite('🧑', 'decor', 0.5);
    face.position.y = 1.55;
    root.add(face);

    const cone = new Mesh(
      avatarConeGeom,
      addMat(new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        side: DoubleSide,
      })),
    );
    cone.position.y = 1.2;
    root.add(cone);

    const entity = this.world.createTransformEntity(root);
    return { root, cone, entity, dead: false, materials, baseOpacities };
  }

  private setAvatarDead(av: AvatarRecord, dead: boolean) {
    if (av.dead === dead) return;
    av.dead = dead;
    // Dead players fade to ~25% opacity; alive restores the per-material
    // baseline (cone was 0.3, body was 1.0, etc.).
    for (let i = 0; i < av.materials.length; i++) {
      av.materials[i].opacity = dead ? av.baseOpacities[i] * 0.3 : av.baseOpacities[i];
    }
  }

  private disposeAvatar(av: AvatarRecord) {
    av.root.traverse((obj: any) => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose?.();
        obj.material.dispose?.();
      }
    });
    av.entity.dispose();
  }

  private updateAvatar(
    userId: string,
    pos: { x: number; z: number; heading?: number; pitch?: number },
    dead = false,
  ) {
    if (!pos) return;
    let av = this.avatars.get(userId);
    if (!av) {
      av = this.createAvatar(userId);
      this.avatars.set(userId, av);
    }
    this.setAvatarDead(av, dead);
    av.root.position.x = pos.x;
    av.root.position.z = pos.z;
    if (typeof pos.heading === 'number') {
      av.root.rotation.y = pos.heading;
    }
    if (typeof pos.pitch === 'number') {
      av.cone.rotation.x = -pos.pitch;
    }
  }

  private spawnItem(
    key: string,
    item: { type: string; icon: string; role?: ItemRole },
  ) {
    const [row, col] = key.split(',').map(Number);
    const [x, y, z] = gridToWorld(row, col);

    const role: ItemRole = item.role ?? 'decor';
    const type = item.type ?? 'decor';
    const baseSize = 1.1;

    // 🟦 cubes become real 3D walls — tall blocks the player can't
    // pass through and that visually carve up the play area. Every
    // other item stays a billboarded sprite.
    if (type === 'cube') {
      const wall = new Mesh(
        new BoxGeometry(WALL_WIDTH, WALL_HEIGHT, WALL_WIDTH),
        new MeshStandardMaterial({
          color: WALL_COLOR,
          roughness: 0.7,
          metalness: 0.1,
        }),
      );
      wall.position.set(x, WALL_HEIGHT / 2, z);
      // LocomotionEnvironment makes the mesh a collider for the
      // locomotion system so the player can't walk through it.
      const entity = this.world
        .createTransformEntity(wall)
        .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });
      this.spawnedEntities.set(key, {
        entity,
        object3D: wall,
        kind: 'wall',
        role,
        type,
        baseSize,
        origin: [x, y, z],
        hp: 0,
        nextDamageableAt: 0,
      });
      return;
    }

    // Role drives halo/aura in the canvas. Older items placed before the
    // portal started tagging roles fall back to decor (no halo).
    const sprite = makeEmojiSprite(item.icon, role, baseSize);
    sprite.position.set(x, y, z);

    const entity = this.world.createTransformEntity(sprite);
    this.spawnedEntities.set(key, {
      entity,
      object3D: sprite,
      kind: 'sprite',
      role,
      type,
      baseSize,
      origin: [x, y, z],
      hp: role === 'enemy' ? enemyStats(type).hp : 0,
      nextDamageableAt: 0,
    });
  }

  private despawnItem(key: string) {
    const record = this.spawnedEntities.get(key);
    if (!record) return;
    if (record.kind === 'sprite') {
      const mat = (record.object3D as Sprite).material as SpriteMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
    } else {
      const mesh = record.object3D as Mesh;
      mesh.geometry.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.());
      else (m as MeshStandardMaterial).dispose?.();
    }
    record.entity.dispose();
    this.spawnedEntities.delete(key);
  }

  // Per-frame item animation: pulse pickups, flicker hazards when a round
  // is active. Idle state leaves items at their static base transform.
  private animateItems(time: number, roundRunning: boolean) {
    // Shared phases — one sin per frame, not per item.
    const pulse = Math.sin(time * 3.5);        // pickup scale oscillation
    const bob   = Math.sin(time * 1.8) * 0.05; // pickup vertical bob
    const flick = 0.75 + Math.random() * 0.25; // hazard opacity jitter

    for (const item of this.spawnedEntities.values()) {
      // Walls are static geometry — no halo, no pulse, no flicker.
      if (item.kind !== 'sprite') continue;

      const s = item.object3D as Sprite;
      const mat = s.material as SpriteMaterial;

      if (!roundRunning) {
        // Snap to neutral state so the idle view stays calm. Restore
        // origin so enemies that wandered during chase return home.
        s.scale.set(item.baseSize, item.baseSize, 1);
        s.position.set(item.origin[0], item.origin[1], item.origin[2]);
        mat.opacity = 1;
        continue;
      }

      if (isPickup(item.role)) {
        const scale = item.baseSize * (1 + 0.08 * pulse);
        s.scale.set(scale, scale, 1);
        s.position.y = 0.55 + bob;
        mat.opacity = 1;
      } else if (item.role === 'warp') {
        // Slow breathing pulse + taller hover — reads as "active portal"
        const scale = item.baseSize * (1 + 0.12 * pulse);
        s.scale.set(scale, scale, 1);
        s.position.y = 0.7 + bob * 0.8;
        mat.opacity = 0.9 + 0.1 * Math.sin(time * 5);
      } else if (isHazard(item.role)) {
        // Fire/enemies read as "alive" via opacity flicker. Steady scale
        // keeps the animation from feeling seizure-y.
        mat.opacity = flick;
        s.position.y = 0.55;
      }
    }
  }

  // Locally-authoritative collision: each client checks its own head
  // against the shared grid items. On pickup/kill we broadcast GRID_CLEAR
  // so other clients see the item vanish. No server-side validation —
  // trust-the-client is fine for a prototype, not a competitive game.
  //
  // Dead players skip everything: can't pick up items, can't take damage,
  // can't deal damage with the sword (they have no sword anyway).
  private handleCollisions(deltaSeconds: number) {
    if (this.isDead.peek()) return;
    this.player.head.getWorldPosition(this.tempPos);

    const pickupR2 = PICKUP_RADIUS * PICKUP_RADIUS;
    const fireR2   = FIRE_RADIUS   * FIRE_RADIUS;
    const swordR2  = SWORD_RADIUS  * SWORD_RADIUS;
    const enemyR2  = ENEMY_DAMAGE_RADIUS * ENEMY_DAMAGE_RADIUS;

    const now = performance.now();
    const swordEquipped = this.equippedLeft.peek() === 'sword';
    const swordReady = swordEquipped && now >= this.lastSwordHitAt + SWORD_COOLDOWN_MS;
    if (swordEquipped) {
      this.player.gripSpaces.left.getWorldPosition(this.tempGrip);
    }

    let totalHealthDelta = 0; // apply once so Signal only fires one write

    // Snapshot keys first: despawning during Map iteration is fine, but
    // deterministic ordering matters when several items overlap.
    for (const [key, item] of [...this.spawnedEntities]) {
      const headD2 = this.tempPos.distanceToSquared(item.object3D.position);

      // ── Pickups (weapons, goals, powerups) ──
      if (isPickup(item.role) && headD2 < pickupR2) {
        this.applyPickup(item.role);
        this.despawnItem(key);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'GRID_CLEAR', key }));
        }
        continue;
      }

      // ── Fire: damage-over-time when player stands inside ──
      if (item.role === 'obstacle-damage' && headD2 < fireR2) {
        totalHealthDelta -= FIRE_DPS * deltaSeconds;
      }

      // ── Enemy logic ──
      if (item.role === 'enemy') {
        // Enemy touches player → damage over time (per variant)
        if (headD2 < enemyR2) {
          totalHealthDelta -= enemyStats(item.type).dps * deltaSeconds;
        }
        // Sword touches enemy → scheduled damage (once per cooldown)
        if (swordReady) {
          const gripD2 = this.tempGrip.distanceToSquared(item.object3D.position);
          if (gripD2 < swordR2) {
            this.lastSwordHitAt = now;
            const killed = this.damageEnemy(key, SWORD_DAMAGE);
            if (!killed) FX.swordHit(this.input.gamepads.left);
            continue; // item may be gone; don't touch it again this tick
          }
        }
      }
    }

    if (totalHealthDelta !== 0) {
      const current = this.playerHealth.peek();
      const next = Math.max(0, current + totalHealthDelta);
      if (next !== current) {
        this.playerHealth.value = next;
        // Cue once per chunk of damage taken (not per frame) — floor(hp/5)
        // changing means at least 5 HP drained since the last cue.
        if (Math.floor(next / 5) < Math.floor(current / 5)) {
          FX.playerHurt(this.input.gamepads.right ?? this.input.gamepads.left);
        }
        if (next <= 0) this.playerDied();
      }
    }
  }

  // Per-variant chase AI. Three behaviors stack on the same loop:
  //  - Robot: aggro only within radius, else walk home to origin.
  //  - Ghost: always chase (slow), passes through walls.
  //  - Skull: always chase, periodically switches target between
  //    live players (multiplayer flavor).
  //
  // Dead players are filtered out of the target list entirely so the
  // round can continue without the game turning into a corpse parade.
  private tickEnemyAI(deltaSeconds: number, time: number) {
    const now = performance.now();

    // Gather live player positions. Own player excluded if dead.
    const targets: { id: string; x: number; z: number }[] = [];
    if (!this.isDead.peek()) {
      this.player.head.getWorldPosition(this.tempPos);
      targets.push({ id: this.userId ?? 'self', x: this.tempPos.x, z: this.tempPos.z });
    }
    for (const [uid, av] of this.avatars) {
      if (av.dead) continue;
      targets.push({ id: uid, x: av.root.position.x, z: av.root.position.z });
    }
    if (targets.length === 0) return; // nobody to chase — enemies idle

    // Walls are static — gather once per tick.
    const walls: { x: number; z: number }[] = [];
    for (const item of this.spawnedEntities.values()) {
      if (item.kind === 'wall') walls.push({ x: item.origin[0], z: item.origin[2] });
    }
    const blockR = WALL_CELL_HALF + 0.18; // wall half + enemy half
    const hitsWall = (x: number, z: number): boolean => {
      for (const w of walls) {
        if (Math.abs(x - w.x) < blockR && Math.abs(z - w.z) < blockR) return true;
      }
      return false;
    };

    // Skull target selection — rotate through live players periodically.
    // Pick once per tick; individual skulls share the selection so the
    // hunt feels coordinated.
    const skullRetarget = enemyBehavior('skull').retargetMs ?? 4000;
    let skullTarget = targets[0];
    if (this.skullTargetUserId) {
      const t = targets.find((p) => p.id === this.skullTargetUserId);
      if (t) skullTarget = t;
    }
    if (now >= this.skullRetargetAt) {
      skullTarget = targets[Math.floor(Math.random() * targets.length)];
      this.skullTargetUserId = skullTarget.id;
      this.skullRetargetAt = now + skullRetarget;
    }

    for (const item of this.spawnedEntities.values()) {
      if (item.role !== 'enemy') continue;
      const stats = enemyStats(item.type);
      const behav = enemyBehavior(item.type);
      const pos = item.object3D.position;

      // Pick a target per variant:
      //   skull → shared skullTarget
      //   everyone else → closest live player
      let target = targets[0];
      if (item.type === 'skull') {
        target = skullTarget;
      } else {
        let bestD2 = Infinity;
        for (const p of targets) {
          const dx = p.x - pos.x;
          const dz = p.z - pos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; target = p; }
        }
      }

      // Aggro: robots only chase if target is within radius; otherwise
      // they return to origin. null radius = always aggroed.
      let moveToX: number, moveToZ: number;
      if (behav.aggroRadius === null) {
        moveToX = target.x;
        moveToZ = target.z;
      } else {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        if (dx * dx + dz * dz < behav.aggroRadius * behav.aggroRadius) {
          moveToX = target.x;
          moveToZ = target.z;
        } else {
          moveToX = item.origin[0];
          moveToZ = item.origin[2];
        }
      }

      // Move toward destination, optionally blocked by walls.
      const dx = moveToX - pos.x;
      const dz = moveToZ - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.05) {
        const step = Math.min(dist, stats.speed * deltaSeconds);
        const nx = pos.x + (dx * step) / dist;
        const nz = pos.z + (dz * step) / dist;
        if (behav.wallPass || !hitsWall(nx, nz)) {
          pos.x = nx;
          pos.z = nz;
        } else {
          // Slide along a wall: try each axis independently so enemies
          // don't just stick helplessly on a corner.
          if (!hitsWall(nx, pos.z))      pos.x = nx;
          else if (!hitsWall(pos.x, nz)) pos.z = nz;
        }
      }

      // Vertical bob — ghosts float and weave, ground units skip this.
      if (stats.bobAmp > 0) {
        pos.y = item.origin[1] + 0.5 + Math.sin(time * stats.bobSpeed) * stats.bobAmp;
      }
    }
  }

  private playerDied() {
    console.log('[Round] Player died — entering spectator mode');
    // Round continues for everyone else. Local player becomes a
    // spectator: AI ignores them (see tickEnemyAI), they can't pick up
    // items (see handleCollisions), and the HUD shows GAME OVER.
    // Drops weapons since they're not participating anymore.
    this.isDead.value = true;
    this.equippedLeft.value = null;
    this.equippedRight.value = null;
    FX.roundLose(); // personal death cue — everyone else plays on
  }

  // Teleport math — moves XROrigin so the player's head lands at `target`
  // on the XZ plane. Y is left alone so floor-level is preserved.
  private teleportPlayerTo(targetX: number, targetZ: number) {
    const headWorld = this.tempPos;
    this.player.head.getWorldPosition(headWorld);
    const originWorld = this.tempChase;
    this.player.getWorldPosition(originWorld);
    this.player.position.x = targetX - (headWorld.x - originWorld.x);
    this.player.position.z = targetZ - (headWorld.z - originWorld.z);
  }

  // Pick a deterministic spawn: hash userId into the spawn list so two
  // players reliably end up at different chairs when there are enough.
  // Falls back to origin when no spawns are placed.
  private teleportToSpawn() {
    const spawns: { x: number; z: number }[] = [];
    for (const item of this.spawnedEntities.values()) {
      // Accept either the new role or a raw `type: 'chair'` — the
      // latter handles chairs placed before the ROLE_BY_ICON mapping
      // existed on the portal (they'd be stored with role='decor').
      if (item.role === 'spawn' || item.type === 'chair') {
        spawns.push({ x: item.origin[0], z: item.origin[2] });
      }
    }
    console.log(`[Round] Teleporting to spawn. ${spawns.length} chair(s) found.`);
    if (spawns.length === 0) {
      this.teleportPlayerTo(0, 0);
      return;
    }
    // Hash userId to a stable index. Portal observers have no userId
    // here — fallback to random for offline/dev.
    let h = 0;
    const id = this.userId ?? String(Math.random());
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    const pick = spawns[Math.abs(h) % spawns.length];
    this.teleportPlayerTo(pick.x, pick.z);
  }

  // Warp teleport — active any time, not gated on roundRunning. Walking
  // into a 🌀 sends the player to a random *other* warp on the grid.
  //
  // The re-trigger problem (player lands inside another warp and would
  // chain instantly) is solved two ways, together:
  //   1) Global cooldown blocks any warp for WARP_COOLDOWN_MS.
  //   2) The destination warp is *locked* until the player physically
  //      leaves its radius — so even after cooldown, you won't bounce
  //      back unless you move.
  private tickWarps() {
    this.player.head.getWorldPosition(this.tempPos);
    const r2 = WARP_RADIUS * WARP_RADIUS;
    const now = performance.now();

    // Collect all warps once — we need both "am I inside one?" and
    // "give me a random destination" lookups.
    const warps: { key: string; pos: Vector3 }[] = [];
    for (const [key, item] of this.spawnedEntities) {
      if (item.role === 'warp') warps.push({ key, pos: item.object3D.position });
    }

    // Clear the locked warp once the player has stepped out of its radius.
    if (this.lockedWarpKey) {
      const locked = this.spawnedEntities.get(this.lockedWarpKey);
      if (!locked || locked.role !== 'warp') {
        this.lockedWarpKey = null;
      } else {
        const d2 = this.tempPos.distanceToSquared(locked.object3D.position);
        if (d2 > r2) this.lockedWarpKey = null;
      }
    }

    if (now < this.warpCooldownUntil) return;
    if (warps.length < 2) return; // need at least two to make a trip

    // Find the warp the player is currently inside (that isn't locked)
    let entered: { key: string; pos: Vector3 } | null = null;
    for (const w of warps) {
      if (w.key === this.lockedWarpKey) continue;
      if (this.tempPos.distanceToSquared(w.pos) < r2) { entered = w; break; }
    }
    if (!entered) return;

    // Pick a random destination that isn't the one we're inside.
    const candidates = warps.filter((w) => w.key !== entered!.key);
    const dest = candidates[Math.floor(Math.random() * candidates.length)];

    // Teleport by moving the XROrigin such that the player's head lands
    // at the destination. We don't touch Y so the player stays at the
    // floor level the locomotion system maintained.
    const headWorld = this.tempPos;             // already set above
    const originWorld = this.tempChase;         // reuse scratch
    this.player.getWorldPosition(originWorld);
    const dx = dest.pos.x - (headWorld.x - originWorld.x);
    const dz = dest.pos.z - (headWorld.z - originWorld.z);
    this.player.position.x = dx;
    this.player.position.z = dz;

    this.warpCooldownUntil = now + WARP_COOLDOWN_MS;
    this.lockedWarpKey = dest.key;
    // Either hand works — prefer right if both are connected.
    FX.warp(this.input.gamepads.right ?? this.input.gamepads.left);
    console.log(`[Warp] ${entered.key} → ${dest.key}`);
  }

  private applyPickup(role: ItemRole) {
    const leftPad  = this.input.gamepads.left;
    const rightPad = this.input.gamepads.right;
    switch (role) {
      case 'weapon-sword':
        this.equippedLeft.value = 'sword';
        FX.pickupWeapon(leftPad);
        break;
      case 'weapon-gun':
        this.equippedRight.value = 'gun';
        FX.pickupWeapon(rightPad);
        break;
      case 'goal':
        this.score.value = this.score.peek() + GOAL_POINTS;
        this.goalsCollected.value = this.goalsCollected.peek() + 1;
        FX.pickupGoal(rightPad ?? leftPad);
        this.checkWin();
        break;
      case 'powerup':
        this.playerHealth.value = Math.min(
          MAX_HEALTH,
          this.playerHealth.peek() + POWERUP_HEAL,
        );
        FX.pickupPowerup(rightPad ?? leftPad);
        break;
    }
  }

  // End the round early when no goals remain. Only triggers if at least
  // one goal existed at round start — a survival round (zero goals)
  // should just run the clock.
  private checkWin() {
    if (this.goalsTotal.peek() === 0) return;
    if (this.goalsCollected.peek() < this.goalsTotal.peek()) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ROUND_END', reason: 'completed' }));
    }
  }

  update(delta: number) {
    const time = performance.now() / 1000;
    const roundRunning = this.roundRunning.peek();
    this.animateItems(time, roundRunning);

    // Gameplay interactions only fire while the round is live. Gives the
    // planner time to place items before the contestant can grab them.
    if (roundRunning) {
      this.tickEnemyAI(delta, time);
      this.handleCollisions(delta);
    }
    // Warps are spatial navigation, not gameplay — active outside rounds
    // too so the designer can test teleport geometry.
    this.tickWarps();

    // Send VR player head position at ~10 Hz
    const now = performance.now();
    if (now - this.lastPosSend < 100) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.player.head.getWorldPosition(this.tempPos);
    this.posMsg.position.x = this.tempPos.x;
    this.posMsg.position.z = this.tempPos.z;
    this.player.head.getWorldDirection(this.tempFwd);
    this.posMsg.position.heading = Math.atan2(-this.tempFwd.x, -this.tempFwd.z);
    this.posMsg.position.pitch = -Math.asin(Math.max(-1, Math.min(1, this.tempFwd.y)));
    this.posMsg.score          = this.score.peek();
    this.posMsg.health         = this.playerHealth.peek();
    this.posMsg.goalsCollected = this.goalsCollected.peek();
    this.posMsg.goalsTotal     = this.goalsTotal.peek();
    this.posMsg.dead           = this.isDead.peek();
    this.posMsg.spaceId        = this.spaceId;
    this.ws.send(JSON.stringify(this.posMsg));
    this.lastPosSend = now;
  }
}
