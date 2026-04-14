// Shared game-state signal plumbing.
//
// Signals live on `world.globals` so any system can peek/subscribe without
// importing the system that "owns" them. This module just exposes typed
// getters + the ItemRole enum so we don't stringly-type across files.

import { signal, type Signal } from "@preact/signals-core";

export type ItemRole =
  | "weapon-sword"
  | "weapon-gun"
  | "goal"
  | "powerup"
  | "obstacle-damage"
  | "enemy"
  | "bird"
  | "spawn"
  | "decor";

export function isPickup(role: ItemRole): boolean {
  return (
    role === "weapon-sword" ||
    role === "weapon-gun" ||
    role === "goal" ||
    role === "powerup"
  );
}

export function isHazard(role: ItemRole): boolean {
  return role === "obstacle-damage" || role === "enemy";
}

// ── Signal accessors ─────────────────────────────────────────
// Each returns the signal, creating+registering it on first call.
// Idempotent — safe to call from any system's init().

type Globals = Record<string, unknown>;
function getOrInit<T>(globals: Globals, key: string, initial: T): Signal<T> {
  const existing = globals[key] as Signal<T> | undefined;
  if (existing) return existing;
  const s = signal(initial);
  globals[key] = s;
  return s;
}

export const MAX_HEALTH = 100;
export const GOAL_POINTS = 1;
export const POWERUP_HEAL = 25;
export const FIRE_DPS = 30;         // health drain per second inside fire
export const FIRE_RADIUS = 0.4;     // meters
export const PICKUP_RADIUS = 0.5;   // meters — player head to item

// Combat tuning
export const ENEMY_DAMAGE_RADIUS = 0.6; // meters — enemy touch damages player

// Per-variant stats. Lookup keyed by the portal's `item.type` string so
// the portal can keep emoji picking simple and the game picks up flavor.
// Unknown types fall back to ENEMY_DEFAULT (backwards-compat with any
// older grid snapshots).
export type EnemyStats = {
  hp: number;
  speed: number;         // m/s
  dps: number;           // damage-per-second to player on touch
  killPoints: number;    // score award on defeat
  bobAmp: number;        // vertical bob amplitude (m) — 0 = grounded
  bobSpeed: number;      // rad/s
};

export const ENEMY_DEFAULT: EnemyStats = {
  hp: 3,
  speed: 0.7,
  dps: 20,
  killPoints: 2,
  bobAmp: 0,
  bobSpeed: 0,
};

export const ENEMY_STATS: Record<string, EnemyStats> = {
  // 🤖 Territorial guard — only chases when a player is within aggro
  //     range, otherwise walks home. Hits hard on touch.
  robot: { hp: 4, speed: 1.5,  dps: 20, killPoints: 2, bobAmp: 0,    bobSpeed: 0   },
  // 👻 Very slow but relentless — also the only enemy that phases
  //     through walls. Floats + weaves vertically.
  ghost: { hp: 3, speed: 0.45, dps: 14, killPoints: 3, bobAmp: 0.35, bobSpeed: 3.2 },
  // 💀 Normal-speed stalker — locks on, occasionally switches targets.
  skull: { hp: 3, speed: 0.95, dps: 26, killPoints: 1, bobAmp: 0,    bobSpeed: 0   },
};

// Per-variant AI behavior flags
export type EnemyBehavior = {
  aggroRadius: number | null;   // null = always aggroed
  wallPass: boolean;            // if false, blocked by walls
  retargetMs: number | null;    // null = never switches target
};
export const ENEMY_BEHAVIOR: Record<string, EnemyBehavior> = {
  robot: { aggroRadius: 3.0,  wallPass: false, retargetMs: null  },
  ghost: { aggroRadius: null, wallPass: true,  retargetMs: null  },
  skull: { aggroRadius: null, wallPass: false, retargetMs: 4000  },
};
export function enemyBehavior(type: string): EnemyBehavior {
  return ENEMY_BEHAVIOR[type] ?? { aggroRadius: null, wallPass: false, retargetMs: null };
}

export function enemyStats(type: string): EnemyStats {
  return ENEMY_STATS[type] ?? ENEMY_DEFAULT;
}
export const SWORD_RADIUS = 0.6;        // meters — grip-to-enemy
export const SWORD_DAMAGE = 1;
export const SWORD_COOLDOWN_MS = 350;
export const PROJECTILE_SPEED = 12;     // m/s
export const PROJECTILE_LIFE_MS = 2500;
export const PROJECTILE_RADIUS = 0.25;  // collision radius with enemies
export const PROJECTILE_DAMAGE = 1;
export const GUN_COOLDOWN_MS = 220;     // rate-limit trigger spam

// Ready-check flow — player must stand near the chair and press SELECT
// after the portal requests a round, before the round actually starts.
export const CHAIR_READY_RADIUS = 0.9; // meters — close enough to the chair

// Game space footprint (matches the grid drawn in src/index.ts: 20×10
// cells at 1m each). Robots bounce off these edges when random-walking.
export const BOARD_HALF_W = 10;   // x: [-10, +10]
export const BOARD_HALF_D = 5;    // z: [-5, +5]
// Skull circle radii are capped at the smaller play-space dimension —
// the user asked for "not longer than the smaller width of the game
// space" so the circle has a chance of staying near the board.
export const BOARD_MIN_DIM = Math.min(BOARD_HALF_W * 2, BOARD_HALF_D * 2);

// Hit cooldown — after taking damage the player is invulnerable for
// this long and the red flash / oof cue doesn't retrigger.
export const HAZARD_COOLDOWN_MS = 1100;
export const DAMAGE_FLASH_MS = 480; // red overlay fade duration

// Bird (🦅) — flies around erratically, takes 2 gun hits, doesn't
// hurt the player, counts as a goal-style point on kill.
export const BIRD_HP = 2;
export const BIRD_SPEED = 2.0;                // m/s horizontal baseline (bumped for livelier movement)
export const BIRD_FLIGHT_HEIGHT = 5.7;        // 3× higher so they really soar above the play area
export const BIRD_FLAP_AMP = 0.18;            // fast wing bob
export const BIRD_FLAP_FREQ = 11;             // rad/s
export const BIRD_DRIFT_AMP = 0.45;           // slow vertical drift
export const BIRD_DRIFT_FREQ = 0.6;
export const BIRD_TURN_P_PER_SEC = 1.8;       // random sharp-turn frequency
export const BIRD_FALL_SPEED = 3.5;           // m/s downward when dead
export const BIRD_HIT_FLASH_MS = 260;         // red glow duration after a non-lethal hit
export const BIRD_POINTS = 1;                 // score on kill, same as a star
// Slightly forgiving gun hitbox — birds are small, high, and erratic.
export const BIRD_HIT_RADIUS = 0.85;

// 🟫 wood block — visually a wall but breakable. Same flat-preview /
// tall-during-round behavior as 🟦 walls, plus a small HP bar.
export const WOOD_HP = 5;
export const WOOD_COLOR = 0x7a3e12;        // warm brown, matches the 🟫 emoji
export const WOOD_HIT_FLASH_MS = 260;      // shared with bird-style tint flash

// Sword swing — manual now (no more auto-proximity damage). Keyboard E
// and the left controller's trigger both dispatch a swing.
export const SWORD_SWING_MS = 300;

// 💩 Voice-triggered bomb — "poo poo doo doo" spawns one. Flies out in
// front of the player, blinks red with rising urgency, then detonates
// and kills every enemy inside BOMB_EXPLOSION_RADIUS.
export const BOMB_FLY_SPEED   = 4.5;     // m/s while in flight
export const BOMB_FLY_MS      = 650;     // travel duration
export const BOMB_BLINK_MS    = 1600;    // blink window before boom
export const BOMB_EXPLOSION_RADIUS = 3.2; // meters
export const BOMB_EXPLOSION_MS = 450;    // visible flash duration
export const BOMB_COOLDOWN_MS  = 2500;   // per-player throttle
// Contact model: the tip has to be moving > SWORD_MIN_SPEED (m/s) to
// register damage. A still sword does nothing; an arm swing or the
// E-key animation both produce enough velocity to count.
//
// Tuning: walking in VR moves the grip at ~1 m/s; a lunge or brisk
// turn can push the tip to 2–3 m/s without anyone intending to swing.
// A real forehand slash produces 5+ m/s at the tip, and the E-key
// animation peaks around 13 m/s. A 5 m/s threshold reliably excludes
// everything except a deliberate swing.
export const SWORD_MIN_SPEED = 5.0;
// Per-target post-hit cooldown so one swing doesn't chain 10 hits on
// the same enemy while the tip sweeps through its hitbox.
export const SWORD_HIT_COOLDOWN_MS = 380;
// Knockback — robot + ghost fly back briefly; skull (circle-motion) is
// immune so the push doesn't look weird against its orbit.
export const SWORD_KNOCKBACK_SPEED = 3.5;   // m/s, decays fast
export const SWORD_KNOCKBACK_MS = 340;

// Cross-system callbacks registered on `world.globals`. Systems that
// own data expose these; consumers call without knowing the owner.
export type DamageFn = (itemKey: string, amount: number) => void;
export type FireFn = () => void;
// Returns the key of the closest enemy within `radius2` (squared), or null.
export type FindEnemyFn = (
  x: number,
  y: number,
  z: number,
  radius2: number,
) => string | null;

// AoE damage centered at a world point — bombs use this to wipe out
// every enemy/bird inside a radius in one call.
export type AreaDamageFn = (x: number, y: number, z: number, radius: number) => void;

export const GameActions = {
  damageEnemy: (g: Globals) => g.damageEnemy as DamageFn | undefined,
  setDamageEnemy: (g: Globals, fn: DamageFn) => { g.damageEnemy = fn; },
  findEnemyAt: (g: Globals) => g.findEnemyAt as FindEnemyFn | undefined,
  setFindEnemyAt: (g: Globals, fn: FindEnemyFn) => { g.findEnemyAt = fn; },
  fireProjectile: (g: Globals) => g.fireProjectile as FireFn | undefined,
  setFireProjectile: (g: Globals, fn: FireFn) => { g.fireProjectile = fn; },
  swingSword: (g: Globals) => g.swingSword as FireFn | undefined,
  setSwingSword: (g: Globals, fn: FireFn) => { g.swingSword = fn; },
  spawnBomb: (g: Globals) => g.spawnBomb as FireFn | undefined,
  setSpawnBomb: (g: Globals, fn: FireFn) => { g.spawnBomb = fn; },
  explodeAt: (g: Globals) => g.explodeAt as AreaDamageFn | undefined,
  setExplodeAt: (g: Globals, fn: AreaDamageFn) => { g.explodeAt = fn; },
};

// Round end reasons shared with the server / portal.
export type RoundEndReason = "completed" | "died" | "timeout" | "host-stopped";

export type RoundResult = {
  reason: RoundEndReason;
  score: number;
  // ms epoch — HUD auto-hides when this passes, then clears the signal.
  expiresAt: number;
};

// Named getters so signal names stay consistent across systems.
export const GameState = {
  roundRunning: (g: Globals) => getOrInit<boolean>(g, "roundRunning", false),
  roundEndsAt:  (g: Globals) => getOrInit<number>(g, "roundEndsAt", 0),
  score:        (g: Globals) => getOrInit<number>(g, "score", 0),
  playerHealth: (g: Globals) => getOrInit<number>(g, "playerHealth", MAX_HEALTH),
  equippedLeft: (g: Globals) => getOrInit<"sword" | null>(g, "equippedLeft", null),
  equippedRight:(g: Globals) => getOrInit<"gun" | null>(g, "equippedRight", null),
  roundResult:  (g: Globals) => getOrInit<RoundResult | null>(g, "roundResult", null),
  // Goal progress. goalsTotal is the snapshot taken at ROUND_START; when
  // it's 0, the round is a survival/exploration round and the HUD falls
  // back to showing raw score instead of "X/Y".
  goalsTotal:     (g: Globals) => getOrInit<number>(g, "goalsTotal", 0),
  goalsCollected: (g: Globals) => getOrInit<number>(g, "goalsCollected", 0),
  // Local death flag — true when the player's HP hit 0 during a round.
  // Round continues; dead players are spectators.
  isDead:         (g: Globals) => getOrInit<boolean>(g, "isDead", false),
  // Pending round — portal has requested start, waiting for a VR player
  // to walk to the chair and press SELECT. HUD renders a ready-check
  // banner while this is true.
  roundPending:   (g: Globals) => getOrInit<boolean>(g, "roundPending", false),
  // ms-epoch of the last damage hit. HUDSystem watches this to trigger
  // the red flash. 0 = never damaged this session.
  lastDamageAt:   (g: Globals) => getOrInit<number>(g, "lastDamageAt", 0),
  // ms-epoch of the last sword swing. WeaponSystem watches this to run
  // the visual slash animation on the left-hand sword.
  lastSwingAt:    (g: Globals) => getOrInit<number>(g, "lastSwingAt", 0),
};

// Enemies use this as a cell-size for wall avoidance: a wall occupies
// ~0.95m of a cell, so 0.5 is a reasonable "don't enter" radius.
export const WALL_CELL_HALF = 0.48;

export const RESULT_DISPLAY_MS = 4500;
