import {
  createSystem,
  Vector3,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  TextureLoader,
  SRGBColorSpace,
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
  LocomotionSystem,
  AdditiveBlending,
  setWorldPosition,
} from "@iwsdk/core";
import { type Signal } from "@preact/signals-core";
import { FX, pulse } from "./game-fx.js";
import {
  GameState,
  GameActions,
  getPlayerStats,
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
  SWORD_MIN_SPEED,
  SWORD_HIT_COOLDOWN_MS,
  SWORD_KNOCKBACK_SPEED,
  SWORD_KNOCKBACK_MS,
  CHAIR_READY_RADIUS,
  WALL_CELL_HALF,
  boardHalfW,
  boardHalfD,
  boardMinDim,
  currentGridScale,
  currentEmojiScale,
  HAZARD_COOLDOWN_MS,
  BIRD_HP,
  BIRD_SPEED,
  BIRD_FLIGHT_HEIGHT,
  BIRD_FLAP_AMP,
  BIRD_FLAP_FREQ,
  BIRD_DRIFT_AMP,
  BIRD_DRIFT_FREQ,
  BIRD_TURN_P_PER_SEC,
  BIRD_FALL_SPEED,
  BIRD_HIT_FLASH_MS,
  BIRD_POINTS,
  BIRD_HIT_RADIUS,
  WOOD_HP,
  WOOD_COLOR,
  WOOD_HIT_FLASH_MS,
  MEGA_JUMP_HEIGHT,
  MEGA_JUMP_COOLDOWN_MS,
  enemyBehavior,
  type ItemRole,
} from "./game-state.js";

// ── Grid coordinate mapping ──────────────────────────────────
// Portal grid: 20 cols × 10 rows, cells scaled by the live gridScale
// signal so the play area fits a Quest room boundary (portal slider
// drives it). Cell centers → world:
//   x = (col - 9.5) * scale, z = (row - 4.5) * scale.
// y stays fixed at 0.55m so billboards hover at a human-friendly
// height regardless of cell scale.
function gridToWorld(
  row: number,
  col: number,
  scale: number,
): [number, number, number] {
  return [(col - 9.5) * scale, 0.55, (row - 4.5) * scale];
}

// Backfill a role for legacy items whose stored `role` is 'decor'.
// Mirrors the portal's ROLE_BY_ICON mapping but keyed off `type`, since
// type is the field that was always present even on early placements.
const TYPE_TO_ROLE: Record<string, ItemRole> = {
  sword:         'weapon-sword',
  gun:           'weapon-gun',
  poopoodoodoo:  'weapon-poo',
  feather:       'weapon-feather',
  star:          'goal',
  fire:          'obstacle-damage',
  robot:         'enemy',
  ghost:         'enemy',
  skull:         'enemy',
  bird:          'bird',
  chair:         'spawn',
};
function roleFromType(type: string): ItemRole {
  return TYPE_TO_ROLE[type] ?? 'decor';
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

// ── 2D PNG art for selected item types ──────────────────────
// Types listed here render as a PNG billboard (from public/textures/)
// instead of the emoji canvas sprite. Anything not in this map falls
// back to makeEmojiSprite.
const ITEM_TEXTURES: Record<string, string> = {
  ghost: "/textures/Ghost.png",
  bird:  "/textures/Bird.png",
  gun:   "/textures/Gun.png",
  chair: "/textures/Chair.png",
};
const sharedTextureLoader = new TextureLoader();
function makeTexturedSprite(url: string, size = 1.1): Sprite {
  const texture = sharedTextureLoader.load(url);
  texture.colorSpace = SRGBColorSpace;
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
// Pre-round: walls are rendered as thin floor tiles so players can see
// the layout but walk through them to reach the starting-point chair.
// On ROUND_START, they pop up to full height + become solid colliders.
const WALL_IDLE_SCALE_Y = 0.02;

// Chair beacon — a glowing translucent column that shoots up above the
// starting-point chair so players can spot it from anywhere on the grid.
const CHAIR_BEACON_HEIGHT = 40;
const CHAIR_BEACON_RADIUS = 0.22;
const CHAIR_BEACON_COLOR  = 0x10b981; // green, matches the 'spawn' tint

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
  // Per-variant AI scratch state. Not all fields apply to every type;
  // init per spawnItem.
  heading: number;     // robot + bird: current flight direction
  radius: number;      // skull: circle radius around origin
  omega: number;       // skull: angular velocity (rad/s, signed)
  phase: number;       // skull / bird: phase offset
  // Bird-only: 'flying' while alive, 'falling' after kill shot, then
  // 'grounded' when it hits the floor and stays upside-down.
  birdState: 'flying' | 'falling' | 'grounded';
  // Red flash window — used by birds for the non-lethal hit glow.
  hitFlashUntil: number; // ms epoch
  // Optional companion mesh — chairs mount a glowing beacon above them
  // so players can find the spawn from anywhere. Disposed with the item.
  extra?: Mesh;
  // Knockback — set by a sword hit on robots/ghosts. While `now` is
  // before knockbackUntil, the enemy's normal AI is suppressed and its
  // position is advanced by (knockbackVx, knockbackVz) decayed each
  // frame. Skulls and birds are immune.
  knockbackUntil: number;
  knockbackVx: number;
  knockbackVz: number;
};

export class PortalSystem extends createSystem({}) {
  private ws: WebSocket | null = null;
  private spawnedEntities = new Map<string, SpawnedItem>();
  private avatars = new Map<string, AvatarRecord>();
  private lastPosSend = 0;
  private lastItemStateBroadcastAt = 0;
  private tempPos!: Vector3;
  private tempFwd!: Vector3;
  private tempGrip!: Vector3;
  private tempChase!: Vector3;
  private tempSwordTip!: Vector3;
  private prevSwordTip: Vector3 | null = null;
  // Cooldown gates — keeps sword from deleting enemies in a single tick
  // by virtue of being inside their hit radius for several frames.
  private lastSwordHitAt = 0;
  // Ready-check state — true while portal has requested a round and
  // this VR client hasn't confirmed yet. Cleared on ROUND_START/CANCEL.
  private roundPending!: Signal<boolean>;
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
  private hasBomb!: Signal<boolean>;
  private hasMegaJump!: Signal<boolean>;
  // Mega-jump physics state.
  private megaJumpActive = false;
  private megaJumpVy = 0;
  private megaJumpFloorY = 0;
  private megaJumpLastAt = 0;
  private isDead!: Signal<boolean>;
  // Hazard damage cooldown — player invulnerable while `now` is
  // inside this window. Blocks spam damage and pairs with the red
  // flash + oof cue.
  private damageCooldownUntil = 0;
  private lastDamageAt!: Signal<number>;
  private lastSwingAt!: Signal<number>;
  // spaceId is the Quest Shared Spaces XRSharedReferenceSpace UUID when available.
  // Set externally (e.g. by a future SharedSpaceSystem that requests the "shared"
  // feature and listens for the reference space UUID); forwarded on every update.
  public spaceId: string | null = null;
  // Pre-allocated to avoid update() allocations. The stats fields ride
  // along with every position packet so observers (portal/broadcast) can
  // render a leaderboard at the native 10 Hz update cadence.
  private posMsg: {
    type: string;
    position: { x: number; y: number; z: number; heading: number; pitch: number };
    score: number;
    health: number;
    goalsCollected: number;
    goalsTotal: number;
    dead: boolean;
    spaceId: string | null;
  } = {
    type: 'PLAYER_POSITION',
    // y rides along so spectators see the player jumping — the mega
    // jump pumps the XROrigin's y, which is what we read here.
    position: { x: 0, y: 0, z: 0, heading: 0, pitch: 0 },
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
    this.tempSwordTip = new Vector3();

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
    this.hasBomb        = GameState.hasBomb(globals);
    this.hasMegaJump    = GameState.hasMegaJump(globals);
    this.isDead         = GameState.isDead(globals);
    this.roundPending   = GameState.roundPending(globals);
    this.lastDamageAt   = GameState.lastDamageAt(globals);
    this.lastSwingAt    = GameState.lastSwingAt(globals);

    // Expose damage entry-point for ProjectileSystem + any future attackers.
    // Passing the key lets the callback do O(1) lookup + broadcast GRID_CLEAR.
    GameActions.setDamageEnemy(globals, (key, amount) => this.damageEnemy(key, amount));
    GameActions.setFindEnemyAt(globals, (x, y, z, r2) => this.findEnemyAt(x, y, z, r2));
    GameActions.setSwingSword(globals, () => this.swingSword());
    GameActions.setExplodeAt(globals, (x, y, z, r) => this.explodeAt(x, y, z, r));
    GameActions.setMegaJump(globals, () => this.megaJump());

    this.connectWS();
    this.setupKeyboard();

    // Walls toggle between flat preview tiles (pre-round) and full-height
    // solid colliders (during round). Subscribe to the roundRunning signal
    // so every wall updates in lockstep; new walls placed mid-state adopt
    // the current state on spawn.
    this.cleanupFuncs.push(
      this.roundRunning.subscribe((running) => {
        for (const item of this.spawnedEntities.values()) {
          if (item.kind === 'wall') this.setWallState(item, running);
        }
      }),
    );

    // Live grid scale — portal slider writes this over the WS. When it
    // flips, reposition every already-spawned item so walls/chair/etc.
    // slide to their new cell centers without a full respawn.
    this.cleanupFuncs.push(
      GameState.gridScale(globals).subscribe(() => this.repositionOnScaleChange()),
    );
    // Live emoji scale — resize each sprite's baseSize field in place.
    // animateItems() reads baseSize every tick and writes sprite.scale,
    // so updating the field is enough to make the change live.
    this.cleanupFuncs.push(
      GameState.emojiScale(globals).subscribe(() => this.resizeOnEmojiScaleChange()),
    );
  }

  // Walk every sprite and scale its baseSize by the current emoji
  // scale (the baseline is 1.1m). Walls are left alone — they're not
  // emoji and player-relative obstacles.
  private resizeOnEmojiScaleChange() {
    const g = this.world.globals as Record<string, unknown>;
    const scale = currentEmojiScale(g);
    const baseline = 1.1;
    for (const item of this.spawnedEntities.values()) {
      if (item.kind !== 'sprite') continue;
      item.baseSize = baseline * scale;
    }
  }

  // Snap every spawned item to the cell center implied by its grid key
  // and the current grid scale. Called on gridScale signal change. Items
  // with dynamic y (birds in flight, wall idle-vs-active heights) keep
  // their current y — only x/z shift with the scale.
  private repositionOnScaleChange() {
    const g = this.world.globals as Record<string, unknown>;
    const scale = currentGridScale(g);
    for (const [key, item] of this.spawnedEntities.entries()) {
      const [row, col] = key.split(',').map(Number);
      const [x, y, z] = gridToWorld(row, col, scale);
      item.origin = [x, y, z];
      item.object3D.position.x = x;
      item.object3D.position.z = z;
      // Keep each item's current y — walls pick their own height based
      // on preview/active state, sprites already sit at y from gridToWorld
      // (we just wrote it), birds are airborne.
      if (item.kind === 'wall') {
        // Walls fill their cell — resize X/Z to the new gridScale so
        // adjacent walls keep their "one per cell" look. setWallState
        // re-reads origin and only writes Y scale, leaving X/Z alone.
        const mesh = item.object3D as Mesh;
        mesh.scale.x = scale;
        mesh.scale.z = scale;
        this.setWallState(item, this.roundRunning.peek());
      }
      if (item.extra) {
        // Chair beacon pillar follows the chair.
        item.extra.position.x = x;
        item.extra.position.z = z;
      }
    }
  }

  // Toggle a single wall between preview (flat + walk-through) and
  // active (tall + solid collider). LocomotionEnvironment is added or
  // removed on the entity so the locomotion system knows whether to
  // treat the mesh as an obstacle.
  private setWallState(item: SpawnedItem, running: boolean) {
    if (item.kind !== 'wall') return;
    const mesh = item.object3D as Mesh;
    if (running) {
      mesh.scale.y = 1;
      mesh.position.set(item.origin[0], WALL_HEIGHT / 2, item.origin[2]);
      const ent = item.entity as unknown as {
        hasComponent?: (c: unknown) => boolean;
        addComponent: (c: unknown, v?: Record<string, unknown>) => unknown;
      };
      // Only add the collider component if it isn't already attached —
      // spawning mid-round should result in a single attachment.
      if (!ent.hasComponent || !ent.hasComponent(LocomotionEnvironment)) {
        ent.addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });
      }
    } else {
      mesh.scale.y = WALL_IDLE_SCALE_Y;
      mesh.position.set(
        item.origin[0],
        (WALL_HEIGHT * WALL_IDLE_SCALE_Y) / 2,
        item.origin[2],
      );
      const ent = item.entity as unknown as {
        hasComponent?: (c: unknown) => boolean;
        removeComponent?: (c: unknown) => unknown;
      };
      if (ent.removeComponent && (!ent.hasComponent || ent.hasComponent(LocomotionEnvironment))) {
        try {
          ent.removeComponent(LocomotionEnvironment);
        } catch {
          // removeComponent throws if component isn't present; ignore.
        }
      }
    }
  }

  // Browser/keyboard shortcuts for testing in the emulator (the real
  // controllers still work unchanged — these just fire the same actions).
  //
  //   Space / Enter → primary action:
  //     • pending + near chair  → confirm ROUND_READY
  //     • round running + gun   → fire the squirt gun
  //   G → force pickup of the nearest pickup item within 2m
  private setupKeyboard() {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in an input (in case the HUD ever gets one).
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.repeat) return;
      switch (e.code) {
        case 'Space':
        case 'Enter':
          e.preventDefault();
          this.primaryAction();
          break;
        case 'KeyG':
          e.preventDefault();
          this.forcePickupNearest();
          break;
        case 'KeyE':
          e.preventDefault();
          this.swingSword();
          break;
        case 'KeyB': {
          e.preventDefault();
          // Keyboard fallback for the voice-triggered poop bomb.
          const spawn = GameActions.spawnBomb(this.world.globals as Record<string, unknown>);
          spawn?.();
          break;
        }
        case 'KeyJ': {
          e.preventDefault();
          // Keyboard fallback for the voice-triggered mega jump.
          const jump = GameActions.megaJump(this.world.globals as Record<string, unknown>);
          jump?.();
          break;
        }
      }
    };
    window.addEventListener('keydown', handler);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', handler));
  }

  // Unified "primary action" — whatever the right trigger would do.
  private primaryAction() {
    // Ready-check takes priority: if the round is pending and we're
    // near the chair, confirm. This mirrors the xr_select path.
    if (this.roundPending.peek()) {
      for (const item of this.spawnedEntities.values()) {
        if (item.role !== 'spawn' && item.type !== 'chair') continue;
        this.player.head.getWorldPosition(this.tempPos);
        const dx = this.tempPos.x - item.origin[0];
        const dz = this.tempPos.z - item.origin[2];
        if (dx * dx + dz * dz <= CHAIR_READY_RADIUS * CHAIR_READY_RADIUS) {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ROUND_READY' }));
          }
          return;
        }
      }
    }
    // Otherwise fire the gun if equipped.
    if (this.equippedRight.peek() === 'gun' && this.roundRunning.peek()) {
      const fire = GameActions.fireProjectile(this.world.globals as Record<string, unknown>);
      fire?.();
    }
  }

  // Browser helper — grab the nearest pickup within ~2m without waiting
  // for auto-proximity. Makes weapon testing quick in the emulator.
  private forcePickupNearest() {
    this.player.head.getWorldPosition(this.tempPos);
    let nearestKey: string | null = null;
    let nearestD2 = 4; // 2m squared
    for (const [key, item] of this.spawnedEntities) {
      if (!isPickup(item.role)) continue;
      const dx = this.tempPos.x - item.object3D.position.x;
      const dz = this.tempPos.z - item.object3D.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < nearestD2) { nearestD2 = d2; nearestKey = key; }
    }
    if (!nearestKey) return;
    const item = this.spawnedEntities.get(nearestKey)!;
    this.applyPickup(item.role);
    this.despawnItem(nearestKey);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'GRID_CLEAR', key: nearestKey }));
    }
  }

  // Nearest hittable target within its effective hit radius, or null.
  // Birds use a larger BIRD_HIT_RADIUS because they're small, fast,
  // and high up — the stock projectile radius would make them nearly
  // unhittable. Ground enemies use the incoming r2 as usual.
  private findEnemyAt(x: number, y: number, z: number, r2: number): string | null {
    // Emoji scale also sizes the bird's effective hitbox — easier to
    // hit a big eagle, harder to hit a tiny one.
    const eScale = currentEmojiScale(this.world.globals as Record<string, unknown>);
    const birdR  = BIRD_HIT_RADIUS * eScale;
    const birdR2 = birdR * birdR;
    // Ground-enemy radius (caller's r2) also scales — caller passes
    // the nominal squared radius; we scale it by emojiScale² here so
    // both projectile and sword paths see the same sized enemy.
    const groundR2 = r2 * eScale * eScale;
    let bestKey: string | null = null;
    let bestScore = Infinity;
    for (const [key, item] of this.spawnedEntities) {
      const isEnemy = item.role === 'enemy';
      const isBird  = item.role === 'bird' && item.birdState === 'flying';
      if (!isEnemy && !isBird) continue;
      const effectiveR2 = isBird ? birdR2 : groundR2;

      const dx = item.object3D.position.x - x;
      const dy = isBird ? item.object3D.position.y - y : 0;
      const dz = item.object3D.position.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > effectiveR2) continue;

      // Rank by "fraction of own hit radius used" so a clean shot at a
      // small enemy beats a sloppy graze on a bird when both are in
      // range of the same droplet.
      const score = d2 / effectiveR2;
      if (score < bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }
    return bestKey;
  }

  // Returns true if the hit killed the target (so callers can skip further
  // processing against a now-gone entity).
  private damageEnemy(key: string, amount: number): boolean {
    const item = this.spawnedEntities.get(key);
    if (!item) return false;
    if (item.role === 'bird') return this.damageBird(key, item, amount);
    if (item.role !== 'enemy') return false;

    item.hp -= amount;
    if (item.hp <= 0) {
      this.score.value = this.score.peek() + enemyStats(item.type).killPoints;
      this.despawnItem(key);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'GRID_CLEAR', key }));
      }
      FX.enemyKill(this.input.gamepads.right ?? this.input.gamepads.left);
      return true;
    }
    return false;
  }

  // Bird damage — first hit glows red + squawks; second hit kills +
  // transitions into a fall to the floor (rendered upside-down on land).
  // Does NOT broadcast GRID_CLEAR: the corpse is a local visual, so
  // each client shoots the bird independently. Fine for a prototype.
  private damageBird(key: string, item: SpawnedItem, amount: number): boolean {
    if (item.birdState !== 'flying') return false; // falling/grounded = ignore
    item.hp -= amount;
    item.hitFlashUntil = performance.now() + BIRD_HIT_FLASH_MS;
    FX.birdHit(this.input.gamepads.right ?? this.input.gamepads.left);
    if (item.hp <= 0) {
      item.birdState = 'falling';
      this.score.value = this.score.peek() + BIRD_POINTS;
      this.goalsCollected.value = this.goalsCollected.peek(); // no change — birds aren't goals
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
        // Adopt the server's current scales BEFORE spawning items so
        // spawnItem computes the correct cell positions + sprite sizes
        // on first render.
        if (typeof msg.gridScale === 'number') {
          GameState.gridScale(this.world.globals as Record<string, unknown>).value = msg.gridScale;
        }
        if (typeof msg.emojiScale === 'number') {
          GameState.emojiScale(this.world.globals as Record<string, unknown>).value = msg.emojiScale;
        }
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
          this.roundPending.value = false;
        } else if (msg.pendingRound) {
          this.roundEndsAt.value = 0;
          this.roundRunning.value = false;
          this.roundPending.value = true;
        } else {
          this.roundEndsAt.value = 0;
          this.roundRunning.value = false;
          this.roundPending.value = false;
        }
        break;

      case 'ROUND_PENDING':
        console.log(`[Round] Pending — walk to 🪑 and press SELECT`);
        this.roundPending.value = true;
        break;

      case 'ROUND_CANCEL':
        console.log('[Round] Cancelled');
        this.roundPending.value = false;
        break;

      case 'ROUND_START': {
        console.log(`[Round] Started — ends at ${new Date(msg.endsAt).toISOString()}`);
        // Fresh run: clear inventory + score, heal up. WeaponSystem reacts
        // via the signal subscription and despawns any weapon meshes.
        this.score.value = 0;
        this.playerHealth.value = MAX_HEALTH;
        this.equippedLeft.value = null;
        this.equippedRight.value = null;
        this.hasBomb.value = false;
        this.hasMegaJump.value = false;
        this.isDead.value = false;
        this.roundPending.value = false;
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
        this.damageCooldownUntil = 0;
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
        this.hasBomb.value = false;
        this.hasMegaJump.value = false;
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

      case 'SET_GRID_SCALE': {
        // Portal slider → server → us. Writing the signal triggers the
        // repositionOnScaleChange subscription set up in init().
        if (typeof msg.scale === 'number') {
          GameState.gridScale(this.world.globals as Record<string, unknown>).value = msg.scale;
        }
        break;
      }

      case 'SET_EMOJI_SCALE': {
        // Triggers resizeOnEmojiScaleChange() to update every sprite's
        // baseSize. Hitbox reads pull the live signal each frame.
        if (typeof msg.scale === 'number') {
          GameState.emojiScale(this.world.globals as Record<string, unknown>).value = msg.scale;
        }
        break;
      }

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
        // Stats ride along — useful for the spectator HUD scoreboard.
        getPlayerStats(this.world.globals as Record<string, unknown>).set(msg.userId, {
          score: msg.score ?? 0,
          health: msg.health ?? 100,
          goalsCollected: msg.goalsCollected ?? 0,
          goalsTotal: msg.goalsTotal ?? 0,
          dead: !!msg.dead,
        });
        break;

      case 'ITEM_STATES': {
        // Authoritative item positions from a VR client. Only applied in
        // spectator mode — VR clients are themselves authoritative for
        // their own items and ignore inbound state.
        if (!this.isSpectator()) break;
        type StateEntry = { key: string; x: number; y: number; z: number; birdState?: string };
        for (const i of msg.items as StateEntry[]) {
          const it = this.spawnedEntities.get(i.key);
          if (!it) continue;
          it.object3D.position.set(i.x, i.y, i.z);
          if (i.birdState && it.role === 'bird' && it.kind === 'sprite') {
            const mat = (it.object3D as Sprite).material as SpriteMaterial;
            mat.rotation = i.birdState === 'grounded' ? Math.PI : 0;
            // Track the state so future visual logic can branch.
            it.birdState = i.birdState as 'flying' | 'falling' | 'grounded';
          }
        }
        break;
      }
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
    pos: { x: number; y?: number; z: number; heading?: number; pitch?: number },
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
    if (typeof pos.y === 'number') av.root.position.y = pos.y;
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
    const g = this.world.globals as Record<string, unknown>;
    const [x, y, z] = gridToWorld(row, col, currentGridScale(g));

    const type = item.type ?? 'decor';
    // Role normally arrives baked into the item (the portal stamps it
    // at placement time). Items placed before a given role mapping
    // existed will arrive as 'decor' though — backfill from `type` so
    // pickups still pick up after you re-deploy the palette.
    let role: ItemRole = item.role ?? 'decor';
    if (role === 'decor') role = roleFromType(type);
    // baseSize follows the live emoji-scale slider — sprite.scale is
    // kept in sync later via the emojiScale signal subscription too.
    const baseSize = 1.1 * currentEmojiScale(g);

    // 🟦 cubes and 🟫 wood both render as 3D wall-shaped blocks. Cubes
    // are invincible; wood breaks after WOOD_HP sword swings. They share
    // the same pre-round preview (thin floor tile + walk-through) so
    // players can navigate to the chair without getting boxed in.
    if (type === 'cube' || type === 'wood') {
      const isWood = type === 'wood';
      const wall = new Mesh(
        new BoxGeometry(WALL_WIDTH, WALL_HEIGHT, WALL_WIDTH),
        new MeshStandardMaterial({
          color: isWood ? WOOD_COLOR : WALL_COLOR,
          roughness: isWood ? 0.95 : 0.7,
          metalness: isWood ? 0 : 0.1,
        }),
      );
      // Walls fill their cell — scale X/Z with gridScale so shrinking
      // the stage shrinks the footprint of each wall too. Y is handled
      // by setWallState (preview vs active height), so don't touch it.
      const gScale = currentGridScale(g);
      wall.scale.x = gScale;
      wall.scale.z = gScale;
      const entity = this.world.createTransformEntity(wall);
      this.spawnedEntities.set(key, {
        entity,
        object3D: wall,
        kind: 'wall',
        role,
        type,
        baseSize,
        origin: [x, y, z],
        hp: isWood ? WOOD_HP : 0,
        nextDamageableAt: 0,
        heading: 0, radius: 0, omega: 0, phase: 0,
        birdState: 'flying', hitFlashUntil: 0,
        knockbackUntil: 0, knockbackVx: 0, knockbackVz: 0,
      });
      this.setWallState(this.spawnedEntities.get(key)!, this.roundRunning.peek());
      return;
    }

    // Role drives halo/aura in the canvas. Older items placed before the
    // portal started tagging roles fall back to decor (no halo). Types
    // listed in ITEM_TEXTURES render as PNG billboards instead — those
    // skip the halo since the art already conveys affordance.
    const texturedUrl = ITEM_TEXTURES[type];
    const sprite = texturedUrl
      ? makeTexturedSprite(texturedUrl, baseSize)
      : makeEmojiSprite(item.icon, role, baseSize);
    sprite.position.set(x, y, z);

    const entity = this.world.createTransformEntity(sprite);

    // Per-variant AI initial state.
    // Robot: random heading for its straight-line walk.
    // Skull: random circle radius capped at the board's smaller dim,
    //        signed angular velocity, and phase so identical spawns
    //        don't move in lockstep.
    // Bird:  random heading + phase so two eagles on the grid don't
    //        move in lockstep. Also starts elevated and billboard-flipped
    //        if sprite rotation was ever set on a previous life.
    let heading = 0, radius = 0, omega = 0, phase = 0;
    if (type === 'robot') {
      heading = Math.random() * Math.PI * 2;
    } else if (type === 'skull') {
      radius = 1 + Math.random() * (boardMinDim(g) - 1);
      omega = (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 0.8);
      phase = Math.random() * Math.PI * 2;
    } else if (role === 'bird') {
      heading = Math.random() * Math.PI * 2;
      phase = Math.random() * Math.PI * 2;
      sprite.position.y = BIRD_FLIGHT_HEIGHT; // start in the air
      (sprite.material as SpriteMaterial).rotation = 0; // right-side up
    }

    // Starting-point chairs get a glowing beacon shooting up to the sky
    // so players can locate them from anywhere before the round starts.
    // Tracked as a separate mesh (extra) so we can dispose it with the
    // item without tangling the sprite's lifecycle.
    let extra: Mesh | undefined;
    if (role === 'spawn' || type === 'chair') {
      const beacon = new Mesh(
        new CylinderGeometry(
          CHAIR_BEACON_RADIUS,
          CHAIR_BEACON_RADIUS,
          CHAIR_BEACON_HEIGHT,
          20,
          1,
          true,
        ),
        new MeshBasicMaterial({
          color: CHAIR_BEACON_COLOR,
          transparent: true,
          opacity: 0.35,
          blending: AdditiveBlending,
          side: DoubleSide,
          depthWrite: false,
        }),
      );
      beacon.position.set(x, CHAIR_BEACON_HEIGHT / 2, z);
      this.scene.add(beacon);
      extra = beacon;
    }

    this.spawnedEntities.set(key, {
      entity,
      object3D: sprite,
      kind: 'sprite',
      role,
      type,
      baseSize,
      origin: [x, y, z],
      hp: role === 'enemy' ? enemyStats(type).hp : role === 'bird' ? BIRD_HP : 0,
      nextDamageableAt: 0,
      heading, radius, omega, phase,
      birdState: 'flying',
      hitFlashUntil: 0,
      extra,
      knockbackUntil: 0, knockbackVx: 0, knockbackVz: 0,
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
    if (record.extra) {
      this.scene.remove(record.extra);
      record.extra.geometry.dispose();
      const m = record.extra.material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.());
      else (m as MeshBasicMaterial).dispose?.();
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

    // Hitboxes scale with the emoji size so a 2× bigger skull hits
    // you from 2× further out (and a 2× bigger pickup is easier to
    // grab). Keeps visual + functional size in sync.
    const eScale = currentEmojiScale(this.world.globals as Record<string, unknown>);
    const pickupR  = PICKUP_RADIUS       * eScale;
    const fireR    = FIRE_RADIUS         * eScale;
    const enemyR   = ENEMY_DAMAGE_RADIUS * eScale;
    const pickupR2 = pickupR * pickupR;
    const fireR2   = fireR   * fireR;
    const enemyR2  = enemyR  * enemyR;

    const hittable = performance.now() >= this.damageCooldownUntil;
    const headX = this.tempPos.x, headZ = this.tempPos.z;

    // Snapshot keys first: despawning during Map iteration is fine, but
    // deterministic ordering matters when several items overlap.
    for (const [key, item] of [...this.spawnedEntities]) {
      // Horizontal distance only — enemies sit on the grid at y≈0.55
      // while the player's head is around y≈1.6, so 3D distance would
      // always overshoot the hit radius. Treating the game as top-down
      // for contact checks matches the grid-based layout.
      const ix = item.object3D.position.x;
      const iz = item.object3D.position.z;
      const dhx = headX - ix, dhz = headZ - iz;
      const headD2 = dhx * dhx + dhz * dhz;

      // ── Pickups (weapons, goals, powerups) ──
      if (isPickup(item.role) && headD2 < pickupR2) {
        this.applyPickup(item.role);
        this.despawnItem(key);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'GRID_CLEAR', key }));
        }
        continue;
      }

      // ── Fire: one discrete hit per cooldown while inside ──
      if (hittable && item.role === 'obstacle-damage' && headD2 < fireR2) {
        this.takeHit(FIRE_DPS);
        break;
      }

      // ── Enemy touch → damage the player (sword damage to enemies is
      //    now handled explicitly in swingSword()).
      if (item.role === 'enemy' && hittable && headD2 < enemyR2) {
        this.takeHit(enemyStats(item.type).dps);
        break;
      }
    }
  }

  // Swing is now animation-only. Damage comes from contact + velocity
  // in tickSwordContact — which also picks up hits when the user
  // physically swings their arm, not just key/trigger presses.
  //
  // We still rate-limit the animation itself so key spam can't cause
  // a jittery re-trigger mid-swing.
  private swingSword() {
    if (this.isDead.peek()) return;
    if (this.equippedLeft.peek() !== 'sword') return;
    const now = performance.now();
    if (now < this.lastSwordHitAt + SWORD_COOLDOWN_MS) return;
    this.lastSwordHitAt = now;
    // Kick the animation — WeaponSystem is subscribed to lastSwingAt.
    this.lastSwingAt.value = Date.now();
    FX.swordHit(this.input.gamepads.left); // whoosh
  }

  // 🪶 Mega jump — uses IWSDK's built-in locomotion jump engine, which
  // already handles physics, ground detection, and fall-back-to-floor
  // correctly. Manually writing to player.position.y was being clobbered
  // every frame by locomotion's gravity raycast (hence the "shaking at
  // ground level" bug).
  //
  // We temporarily swap jumpHeight to MEGA_JUMP_HEIGHT, call jump(),
  // then restore on the next tick. Locomotor reads jumpHeight when the
  // jump is *issued*, not over time, so this works even though the
  // restore happens before the player has fully come back down.
  private megaJump() {
    if (this.isDead.peek()) return;
    if (!this.hasMegaJump.peek()) {
      console.log('[MegaJump] no ability — pick up a 🪶 first');
      return;
    }
    const now = performance.now();
    if (now - this.megaJumpLastAt < MEGA_JUMP_COOLDOWN_MS) return;
    this.megaJumpLastAt = now;

    // LocomotionSystem.locomotor is private in the type defs but real
    // at runtime; reach in via an `any` cast.
    const loco = this.world.getSystem(LocomotionSystem) as unknown as {
      locomotor?: { jump(): void };
      config: { jumpHeight: { value: number; peek(): number } };
    } | undefined;
    if (!loco?.locomotor) {
      console.log('[MegaJump] LocomotionSystem unavailable');
      return;
    }
    const jumpHeight = loco.config.jumpHeight;
    const original = jumpHeight.peek();
    jumpHeight.value = MEGA_JUMP_HEIGHT;
    loco.locomotor.jump();
    // Restore on next macrotask so locomotor has read the boosted value.
    setTimeout(() => { jumpHeight.value = original; }, 0);

    FX.megaJump(this.input.gamepads.left ?? this.input.gamepads.right);
  }

  // No-op kept for callers — locomotor handles the physics now. Field
  // state retained for any future custom-physics path.
  private tickMegaJump(_deltaSeconds: number) {
    /* intentionally empty */
  }

  // Wood damage — 5 sword hits to break. Flashes red per hit (the wall
  // tick picks up hitFlashUntil). On death: GRID_CLEAR so other clients
  // see it vanish, same as any other grid removal.
  private damageWood(key: string, item: SpawnedItem) {
    item.hp -= 1;
    item.hitFlashUntil = performance.now() + WOOD_HIT_FLASH_MS;
    FX.woodHit(this.input.gamepads.left);
    if (item.hp <= 0) {
      this.despawnItem(key);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'GRID_CLEAR', key }));
      }
    }
  }

  // Apply a discrete damage hit. Gated by the hazard cooldown so the
  // player can't be hit again immediately — that window is also what
  // the red flash + oof cue are timed to.
  private takeHit(amount: number) {
    const now = performance.now();
    if (now < this.damageCooldownUntil) return;
    this.damageCooldownUntil = now + HAZARD_COOLDOWN_MS;

    const current = this.playerHealth.peek();
    const next = Math.max(0, current - amount);
    this.playerHealth.value = next;
    this.lastDamageAt.value = Date.now();
    console.log(`[Hit] -${amount} HP (${current} → ${next})`);
    FX.oof(this.input.gamepads.right ?? this.input.gamepads.left);
    if (next <= 0) this.playerDied();
  }

  // Per-variant AI. Three distinct behaviors now:
  //  - Robot: picks a random heading, walks straight until it hits a
  //    wall or the board edge, then picks a new heading and repeats.
  //  - Ghost: slow chase of closest live player, phases through walls.
  //  - Skull: circles its spawn point at a fixed radius and angular
  //    velocity chosen at spawn. Ignores walls and the board edges.
  //
  // Dead players are excluded from chase targets so a downed player
  // doesn't keep enemies glued to them.
  private tickEnemyAI(deltaSeconds: number, time: number) {
    // Cache board bounds + scale once per tick — cheap signal peeks.
    const g = this.world.globals as Record<string, unknown>;
    const halfW = boardHalfW(g);
    const halfD = boardHalfD(g);
    const gScale = currentGridScale(g);

    // Walls are static — gather once per tick.
    const walls: { x: number; z: number }[] = [];
    for (const item of this.spawnedEntities.values()) {
      if (item.kind === 'wall') walls.push({ x: item.origin[0], z: item.origin[2] });
    }
    // Walls scale with gridScale; avoidance half-extent scales too so
    // enemies don't walk through visibly-smaller walls or clip into
    // visibly-larger ones.
    const blockR = WALL_CELL_HALF * gScale + 0.18;
    const hitsWall = (x: number, z: number): boolean => {
      for (const w of walls) {
        if (Math.abs(x - w.x) < blockR && Math.abs(z - w.z) < blockR) return true;
      }
      return false;
    };

    // Live targets — ghosts still chase, others don't care.
    const targets: { x: number; z: number }[] = [];
    if (!this.isDead.peek()) {
      this.player.head.getWorldPosition(this.tempPos);
      targets.push({ x: this.tempPos.x, z: this.tempPos.z });
    }
    for (const [, av] of this.avatars) {
      if (av.dead) continue;
      targets.push({ x: av.root.position.x, z: av.root.position.z });
    }

    const nowMs = performance.now();
    for (const item of this.spawnedEntities.values()) {
      // Birds have their own AI track — handled separately since they
      // fly, fall, and land rather than chasing/wandering like enemies.
      if (item.role === 'bird') {
        this.tickBird(item, deltaSeconds, time);
        continue;
      }
      if (item.role !== 'enemy') continue;
      const pos = item.object3D.position;

      // Knockback override — while an enemy is stunned from a sword hit,
      // it drifts with its residual knockback velocity and the normal
      // AI branch is skipped entirely. Velocity decays exponentially.
      if (nowMs < item.knockbackUntil) {
        pos.x += item.knockbackVx * deltaSeconds;
        pos.z += item.knockbackVz * deltaSeconds;
        const decay = Math.pow(0.12, deltaSeconds); // ~88%/s decay
        item.knockbackVx *= decay;
        item.knockbackVz *= decay;
        continue;
      }

      const stats = enemyStats(item.type);

      if (item.type === 'skull') {
        // Pure circular motion around origin; walls + edges ignored.
        const angle = item.phase + time * item.omega;
        pos.x = item.origin[0] + item.radius * Math.cos(angle);
        pos.z = item.origin[2] + item.radius * Math.sin(angle);
      } else if (item.type === 'robot') {
        // Straight walk in `heading`; pick a new heading on collision.
        const step = stats.speed * deltaSeconds;
        const nx = pos.x + Math.cos(item.heading) * step;
        const nz = pos.z + Math.sin(item.heading) * step;
        const outOfBounds =
          nx < -halfW || nx > halfW ||
          nz < -halfD || nz > halfD;
        if (outOfBounds || hitsWall(nx, nz)) {
          item.heading = Math.random() * Math.PI * 2;
        } else {
          pos.x = nx;
          pos.z = nz;
        }
      } else {
        // Ghost + anything else: chase closest LIVE player. If every
        // player in range is dead (spectator), drift back to origin so
        // the ghost visibly disengages — dead players complained they
        // were still being shadowed.
        let targetX: number, targetZ: number;
        if (targets.length === 0) {
          targetX = item.origin[0];
          targetZ = item.origin[2];
        } else {
          let target = targets[0];
          let bestD2 = Infinity;
          for (const p of targets) {
            const dx = p.x - pos.x;
            const dz = p.z - pos.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) { bestD2 = d2; target = p; }
          }
          targetX = target.x;
          targetZ = target.z;
        }
        const dx = targetX - pos.x;
        const dz = targetZ - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.05) {
          const step = Math.min(dist, stats.speed * deltaSeconds);
          pos.x += (dx * step) / dist;
          pos.z += (dz * step) / dist;
        }
      }

      // Vertical bob — ghosts float and weave, ground units skip this.
      if (stats.bobAmp > 0) {
        pos.y = item.origin[1] + 0.5 + Math.sin(time * stats.bobSpeed) * stats.bobAmp;
      }
    }
  }

  // Bird AI — three states.
  //  - flying: erratic wandering in the air, ignoring walls and edges.
  //  - falling: straight down at BIRD_FALL_SPEED until it hits the floor.
  //  - grounded: sprite flipped upside-down, sits still forever.
  private tickBird(item: SpawnedItem, deltaSeconds: number, time: number) {
    const pos = item.object3D.position;
    const mat = item.object3D.material as SpriteMaterial;

    // Red-glow flash on non-lethal hit. SpriteMaterial.color multiplies
    // with the texture, so setting it bright-red tints the emoji crimson
    // while the hit cue plays. Returns to normal when the window expires.
    const flashing = performance.now() < item.hitFlashUntil;
    if (flashing) mat.color.setRGB(1.8, 0.25, 0.25);
    else if (mat.color.r !== 1 || mat.color.g !== 1 || mat.color.b !== 1) {
      mat.color.setRGB(1, 1, 1);
    }

    if (item.birdState === 'grounded') {
      // Keep it pinned; upside-down rotation already applied on landing.
      return;
    }

    if (item.birdState === 'falling') {
      pos.y -= BIRD_FALL_SPEED * deltaSeconds;
      if (pos.y <= 0.35) {
        pos.y = 0.35;
        item.birdState = 'grounded';
        // Sprites are always camera-facing, but their image can be
        // rotated in-plane — PI = upside-down.
        mat.rotation = Math.PI;
      }
      return;
    }

    // Flying — sharp direction changes, fast flap + slow drift Y.
    if (Math.random() < BIRD_TURN_P_PER_SEC * deltaSeconds) {
      item.heading += (Math.random() - 0.5) * Math.PI;
    }
    // Smooth wobble on top so it looks like a confused bird, not a
    // straight-line missile.
    item.heading += Math.sin(time * 1.7 + item.phase) * 0.3 * deltaSeconds;

    const speed = BIRD_SPEED + Math.sin(time * 2.1 + item.phase) * 0.35;
    pos.x += Math.cos(item.heading) * speed * deltaSeconds;
    pos.z += Math.sin(item.heading) * speed * deltaSeconds;

    const flap  = Math.sin(time * BIRD_FLAP_FREQ + item.phase) * BIRD_FLAP_AMP;
    const drift = Math.sin(time * BIRD_DRIFT_FREQ + item.phase * 0.3) * BIRD_DRIFT_AMP;
    pos.y = BIRD_FLIGHT_HEIGHT + flap + drift;
  }

  // AoE: kill every enemy, bird, and wood block inside a horizontal
  // radius. Called by BombSystem on detonation. Uses XZ distance so the
  // bomb's altitude doesn't need to match grounded targets.
  private explodeAt(x: number, _y: number, z: number, radius: number) {
    const r2 = radius * radius;
    for (const [key, item] of [...this.spawnedEntities]) {
      const dx = item.object3D.position.x - x;
      const dz = item.object3D.position.z - z;
      if (dx * dx + dz * dz > r2) continue;
      if (item.role === 'enemy') {
        // Overkill damage ensures the kill path runs (score + despawn).
        this.damageEnemy(key, 9999);
      } else if (item.role === 'bird') {
        const it = this.spawnedEntities.get(key);
        if (it) this.damageBird(key, it, 9999);
      } else if (item.type === 'wood') {
        const it = this.spawnedEntities.get(key);
        if (it) {
          it.hp = 0;
          it.hitFlashUntil = performance.now() + WOOD_HIT_FLASH_MS;
          this.despawnItem(key);
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'GRID_CLEAR', key }));
          }
        }
      }
    }
  }

  // Sword contact + physics-ish hit detection. Runs every frame the
  // sword is equipped — compute the tip's world velocity since last
  // frame, and if it's moving fast enough (SWORD_MIN_SPEED) check for
  // enemy/wood targets inside SWORD_RADIUS. Per-target cooldown so a
  // single swing doesn't chain 10 hits on the same enemy.
  //
  // Robots and ghosts get knocked back + stunned on hit; skulls run on
  // a parametric circle so knockback would just look broken.
  private tickSwordContact(deltaSeconds: number) {
    const globals = this.world.globals as Record<string, unknown>;
    const tip = globals.swordTip as Object3D | undefined;
    if (!tip || this.equippedLeft.peek() !== 'sword' || this.isDead.peek()) {
      this.prevSwordTip = null;
      return;
    }

    // Current tip world position.
    tip.getWorldPosition(this.tempSwordTip);
    if (!this.prevSwordTip) {
      this.prevSwordTip = this.tempSwordTip.clone();
      return;
    }

    // Velocity magnitude — require it to exceed SWORD_MIN_SPEED. Clamp
    // delta to avoid huge spikes on tab-switch / first frame.
    const safeDelta = Math.max(deltaSeconds, 0.001);
    const vx = (this.tempSwordTip.x - this.prevSwordTip.x) / safeDelta;
    const vy = (this.tempSwordTip.y - this.prevSwordTip.y) / safeDelta;
    const vz = (this.tempSwordTip.z - this.prevSwordTip.z) / safeDelta;
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

    // Remember this frame's tip position for next frame's velocity calc,
    // regardless of whether we land a hit.
    this.prevSwordTip.copy(this.tempSwordTip);

    if (speed < SWORD_MIN_SPEED) return;

    // Scale sword hit radius with emoji size so a bigger enemy is
    // hittable from proportionally further out.
    const eScale = currentEmojiScale(this.world.globals as Record<string, unknown>);
    const swordR = SWORD_RADIUS * eScale;
    const swordR2 = swordR * swordR;
    const now = performance.now();
    const leftPad = this.input.gamepads.left;

    for (const [key, item] of [...this.spawnedEntities]) {
      if (now < item.nextDamageableAt) continue;
      const pos = item.object3D.position;
      const dx = pos.x - this.tempSwordTip.x;
      const dz = pos.z - this.tempSwordTip.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > swordR2) continue;

      if (item.role === 'enemy') {
        item.nextDamageableAt = now + SWORD_HIT_COOLDOWN_MS;
        const killed = this.damageEnemy(key, SWORD_DAMAGE);
        if (killed) continue;
        // Knockback + stun for ground-motion variants only. Skull's
        // parametric orbit would immediately overwrite pushback.
        if (item.type === 'robot' || item.type === 'ghost') {
          const len = Math.hypot(dx, dz) || 1;
          item.knockbackVx = (dx / len) * SWORD_KNOCKBACK_SPEED;
          item.knockbackVz = (dz / len) * SWORD_KNOCKBACK_SPEED;
          item.knockbackUntil = now + SWORD_KNOCKBACK_MS;
          pulse(leftPad, 0.9, 70); // extra thump on a stun hit
        }
      } else if (item.type === 'wood') {
        item.nextDamageableAt = now + SWORD_HIT_COOLDOWN_MS;
        this.damageWood(key, item);
      }
    }
  }

  // Push current world positions of every dynamic item (enemies +
  // birds) at ~10 Hz so the broadcast page (and any other clients)
  // can render the same scene the VR player sees instead of running
  // their own divergent AI. Cheap — ~10 items × ~30 bytes × 10 Hz.
  private tickItemStateBroadcast() {
    const now = performance.now();
    if (now - this.lastItemStateBroadcastAt < 100) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const items: Array<{
      key: string; x: number; y: number; z: number; birdState?: string;
    }> = [];
    for (const [key, item] of this.spawnedEntities) {
      if (item.role !== 'enemy' && item.role !== 'bird') continue;
      const p = item.object3D.position;
      const entry: { key: string; x: number; y: number; z: number; birdState?: string } = {
        key, x: p.x, y: p.y, z: p.z,
      };
      if (item.role === 'bird') entry.birdState = item.birdState;
      items.push(entry);
    }
    if (items.length === 0) return;
    this.lastItemStateBroadcastAt = now;
    this.ws.send(JSON.stringify({ type: 'ITEM_STATES', items }));
  }

  // Walls (incl. wood) may be flashing red from a sword hit. Each frame
  // we either paint the flash color or snap back to the base color —
  // unconditional writes are cheap for Three.js Color and keep this
  // logic trivially correct for multiple wall variants.
  private tickWallFlash() {
    const now = performance.now();
    for (const item of this.spawnedEntities.values()) {
      if (item.kind !== 'wall') continue;
      const mat = (item.object3D as Mesh).material as MeshStandardMaterial;
      if (now < item.hitFlashUntil) {
        mat.color.setRGB(1.6, 0.28, 0.28);
      } else {
        mat.color.setHex(item.type === 'wood' ? WOOD_COLOR : WALL_COLOR);
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
    this.hasBomb.value = false;
    this.hasMegaJump.value = false;
    FX.roundLose(); // personal death cue — everyone else plays on
  }

  // Teleport places the XROrigin so the player's head ends up at `target`.
  // Uses `setWorldPosition` to handle any parent-transform chain IWSDK
  // might introduce, and compensates for the tracked head offset so the
  // head lands near the spawn point rather than wherever the rig origin
  // happens to be.
  private teleportPlayerTo(targetX: number, targetZ: number) {
    // Current world positions of origin + head.
    const originWorld = this.tempChase;
    this.player.getWorldPosition(originWorld);
    const headWorld = this.tempPos;
    this.player.head.getWorldPosition(headWorld);
    // Head's world-space offset from the origin.
    const dx = headWorld.x - originWorld.x;
    const dz = headWorld.z - originWorld.z;
    // Desired origin world position: target minus that offset.
    originWorld.set(targetX - dx, this.player.position.y, targetZ - dz);
    setWorldPosition(this.player, originWorld);
    console.log(
      `[Teleport] Player → (${targetX.toFixed(2)}, ${targetZ.toFixed(2)})`,
    );
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

  // Ready check — runs while the portal has a round pending. Player
  // walks to the chair and presses SELECT on either controller to
  // confirm; first confirm (from any VR client) actually starts the
  // round for everyone.
  private tickReadyCheck() {
    if (!this.roundPending.peek()) return;

    // Find the chair (single-chair rule enforced on the portal).
    let chairPos: { x: number; z: number } | null = null;
    for (const item of this.spawnedEntities.values()) {
      if (item.role === 'spawn' || item.type === 'chair') {
        chairPos = { x: item.origin[0], z: item.origin[2] };
        break;
      }
    }
    if (!chairPos) return;

    this.player.head.getWorldPosition(this.tempPos);
    const dx = this.tempPos.x - chairPos.x;
    const dz = this.tempPos.z - chairPos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > CHAIR_READY_RADIUS * CHAIR_READY_RADIUS) return;

    // Within range — watch for either controller's primary select press.
    const left  = this.input.gamepads.left;
    const right = this.input.gamepads.right;
    const selectDown = left?.getSelectStart() || right?.getSelectStart();
    if (!selectDown) return;

    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[Round] Ready confirmed — sending ROUND_READY');
      this.ws.send(JSON.stringify({ type: 'ROUND_READY' }));
    }
  }

  private applyPickup(role: ItemRole) {
    console.log('[Pickup]', role);
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
      case 'weapon-poo':
        // Picking up 💩 grants UNLIMITED bomb throws for the rest of
        // the round. WeaponSystem also mounts a 💩 visual on the
        // sword hand on this signal change.
        this.hasBomb.value = true;
        FX.pickupWeapon(rightPad ?? leftPad);
        break;
      case 'weapon-feather':
        // 🪶 grants UNLIMITED mega-jumps via the peacock voice phrase
        // (or the J keyboard shortcut for testing).
        this.hasMegaJump.value = true;
        FX.pickupWeapon(rightPad ?? leftPad);
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

  // Tiny helper — broadcast pages set isSpectator on globals before
  // registering systems. Spectators only render; gameplay ticks bail.
  private isSpectator(): boolean {
    return GameState.isSpectator(this.world.globals as Record<string, unknown>).peek();
  }

  update(delta: number) {
    // Spectator (broadcast page) is a pure renderer — no AI, no
    // gameplay ticks, no position broadcast back to the server.
    if (this.isSpectator()) return;

    const time = performance.now() / 1000;
    const roundRunning = this.roundRunning.peek();
    this.animateItems(time, roundRunning);

    // Gameplay interactions only fire while the round is live. Gives the
    // planner time to place items before the contestant can grab them.
    if (roundRunning) {
      this.tickEnemyAI(delta, time);
      this.handleCollisions(delta);
    }
    // Sword contact checks run whenever the sword is equipped — the
    // tip's velocity is what decides a hit, not a discrete swing event.
    if (roundRunning) this.tickSwordContact(delta);
    // Mega-jump runs any time so an in-flight jump completes cleanly
    // even at round-end / death.
    this.tickMegaJump(delta);
    // Wall red-flash (on sword hit) runs any time so the tint resets
    // cleanly regardless of round state.
    this.tickWallFlash();
    // Ready-check is active only during a pending round.
    this.tickReadyCheck();

    // Authoritative item-position broadcast for spectators (~10 Hz).
    this.tickItemStateBroadcast();

    // Send VR player head position at ~10 Hz
    const now = performance.now();
    if (now - this.lastPosSend < 100) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.player.head.getWorldPosition(this.tempPos);
    this.posMsg.position.x = this.tempPos.x;
    this.posMsg.position.y = this.tempPos.y;
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
