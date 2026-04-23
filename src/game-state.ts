// Shared game-state signal plumbing.
//
// Signals live on `world.globals` so any system can peek/subscribe without
// importing the system that "owns" them. This module just exposes typed
// getters + the ItemRole enum so we don't stringly-type across files.

import { signal, type Signal } from "@preact/signals-core";

export type ItemRole =
  | "weapon-sword"
  | "weapon-gun"
  | "weapon-poo"
  | "weapon-feather"
  | "goal"
  | "powerup"
  | "mushroom"
  | "obstacle-damage"
  | "enemy"
  | "bird"
  | "spawn"
  | "decor";

export function isPickup(role: ItemRole): boolean {
  return (
    role === "weapon-sword" ||
    role === "weapon-gun" ||
    role === "weapon-poo" ||
    role === "weapon-feather" ||
    role === "goal" ||
    role === "powerup" ||
    role === "mushroom"
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

// Life points are discrete (hearts, not a percentage bar). Ghost/skull
// contact = -1 per hit. Pickups restore 1 or 2. Mushrooms can push the
// total ABOVE MAX_HEALTH — that over-stack is what spawns followers.
export const MAX_HEALTH = 5;
export const GOAL_POINTS = 1;
export const POWERUP_HEAL = 1;   // 🍌 banana heals one life point
export const STAR_HEAL = 1;      // ⭐ star also heals one life point
export const MUSHROOM_HEAL = 2;  // 🍄 mushroom adds 2 lives (can exceed max)
// Gap (in ms) between each mushroom in the follower chain. Picking up
// two mushrooms spawns followers that sample the player's trail at
// +400ms and +800ms ago respectively, so they stagger in a line.
export const MUSHROOM_FOLLOWER_DELAY_MS = 400;
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
  // HP is uniform at 2 so the combat rule is predictable:
  //   sword or gun = 1-hit kill, bare hands = 2-hit kill.
  robot:   { hp: 2, speed: 1.5,  dps: 20, killPoints: 2, bobAmp: 0,    bobSpeed: 0   },
  ghost:   { hp: 2, speed: 0.45, dps: 14, killPoints: 3, bobAmp: 0.35, bobSpeed: 3.2 },
  skull:   { hp: 2, speed: 0.95, dps: 26, killPoints: 1, bobAmp: 0,    bobSpeed: 0   },
  // ⛄ Lumbering iceberg — slowest on the board, light touch damage.
  snowman: { hp: 2, speed: 0.35, dps: 12, killPoints: 2, bobAmp: 0,    bobSpeed: 0   },
};

// Per-variant AI behavior flags
export type EnemyBehavior = {
  aggroRadius: number | null;   // null = always aggroed
  wallPass: boolean;            // if false, blocked by walls
  retargetMs: number | null;    // null = never switches target
};
export const ENEMY_BEHAVIOR: Record<string, EnemyBehavior> = {
  robot:   { aggroRadius: 3.0,  wallPass: false, retargetMs: null  },
  ghost:   { aggroRadius: null, wallPass: true,  retargetMs: null  },
  skull:   { aggroRadius: null, wallPass: false, retargetMs: 4000  },
  // Snowman: always aggroed, can't phase walls, never switches target.
  snowman: { aggroRadius: null, wallPass: false, retargetMs: null  },
};
export function enemyBehavior(type: string): EnemyBehavior {
  return ENEMY_BEHAVIOR[type] ?? { aggroRadius: null, wallPass: false, retargetMs: null };
}

export function enemyStats(type: string): EnemyStats {
  return ENEMY_STATS[type] ?? ENEMY_DEFAULT;
}
export const SWORD_RADIUS = 0.6;        // meters — grip-to-enemy
export const SWORD_DAMAGE = 2;          // one-shots a 2 HP enemy
export const SWORD_COOLDOWN_MS = 350;
export const PROJECTILE_SPEED = 12;     // m/s
export const PROJECTILE_LIFE_MS = 2500;
export const PROJECTILE_RADIUS = 0.25;  // collision radius with enemies
export const PROJECTILE_DAMAGE = 2;     // watergun one-shots too
export const GUN_COOLDOWN_MS = 220;     // rate-limit trigger spam

// Bare-handed melee — when the left hand has no sword equipped, the
// left controller grip itself becomes the contact source. Shorter reach
// and half the damage of a sword, so it takes 2 hits to down an enemy.
export const BARE_HANDS_DAMAGE    = 1;
export const BARE_HANDS_RADIUS    = 0.4;
export const BARE_HANDS_MIN_SPEED = 4.0;

// Ready-check flow — player must stand near the chair and press SELECT
// after the portal requests a round, before the round actually starts.
export const CHAIR_READY_RADIUS = 0.9; // meters — close enough to the chair

// Grid scale — the playable stage shrinks by this factor so the
// board fits inside a Quest room-scale boundary. Cell positions and
// the visible grid/floor scale with this, but walls + pickup sprites
// keep their real-world size so they still feel human-scale. This is
// a runtime signal (portal page exposes a slider) so tuning doesn't
// require a reload. 0.75 × 8 cells = 6m on each side, matching a
// room-scale Quest guardian without exceeding it.
// 1.0m per cell × 8×8 = 8m × 8m playable area. Big enough that a player
// with full physical walking (no locomotion) can actually dodge an
// approaching enemy before it closes the gap.
export const GRID_SCALE_DEFAULT = 1.0;
export const GRID_SCALE_MIN = 0.4;
// 2.0 → 8×2.0 = 16m board. Large enough to match a full-room guardian
// without the cell-per-meter feel getting too cramped. Was 1.2 (9.6m)
// which capped out quickly for designers wanting a bigger play area.
export const GRID_SCALE_MAX = 2.0;

// Emoji scale — grows/shrinks every sprite (pickups, enemies, eagles,
// chair face) AND their hitboxes together. Lets the operator tune how
// "present" the items feel in the space without re-scaling the stage.
// 1.0 = baseline 1.1m sprite height with the baseline hitbox radii.
export const EMOJI_SCALE_DEFAULT = 1.0;
export const EMOJI_SCALE_MIN = 0.4;
export const EMOJI_SCALE_MAX = 2.0;

// The grid coverage itself (8 cols × 8 rows) doesn't change — only
// the per-cell size does. Helpers read the current scale signal so
// every consumer stays in sync with the slider.
export function currentGridScale(g: Globals): number {
  return GameState.gridScale(g).peek();
}
export function currentEmojiScale(g: Globals): number {
  return GameState.emojiScale(g).peek();
}
export function boardHalfW(g: Globals): number { return 4 * currentGridScale(g); }
export function boardHalfD(g: Globals): number { return 4 * currentGridScale(g); }
// Skull circle radii cap at the smaller play-space dimension so the
// orbit at least has a chance of staying on the board.
export function boardMinDim(g: Globals): number {
  return Math.min(boardHalfW(g) * 2, boardHalfD(g) * 2);
}

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
export const BIRD_POINTS = 5;                 // highest-value target on the board
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

// 🪶 Feather → flight. Picking up a feather immediately lifts the
// player to FLIGHT_ALTITUDE and holds them there for FLIGHT_DURATION_MS,
// during which taking damage is disabled (invulnerable sky-walk). The
// "I'm a peacock … fly" voice phrase triggers the same effect.
export const FLIGHT_DURATION_MS = 3000;
export const FLIGHT_ALTITUDE    = 3.0;  // meters above floor
// Legacy: mega-jump constants still used by the locomotor path inside
// megaJump() as a fallback FX if flight-altitude override is unavailable.
export const MEGA_JUMP_HEIGHT  = 8;
export const MEGA_JUMP_COOLDOWN_MS = 200;
// Legacy manual-physics fields, retained for the field types but unused
// since locomotor handles the integration internally.
export const MEGA_JUMP_VY      = 13;
export const MEGA_JUMP_GRAVITY = 9.8;

// 💩 Voice-triggered bomb — "poo poo doo doo" spawns one. Launched like
// a grenade: forward-and-up throw, gravity arcs it down, lands on the
// floor and blinks with rising urgency before detonating.
export const BOMB_THROW_FWD   = 5.0;   // m/s horizontal component on launch
export const BOMB_THROW_UP    = 4.2;   // m/s vertical component on launch
export const BOMB_GRAVITY     = 9.8;   // m/s² — realistic-ish arc
export const BOMB_FLOOR_Y     = 0.25;  // rest height above the world floor
export const BOMB_MAX_FLY_MS  = 3000;  // safety timeout if the arc somehow never lands
export const BOMB_BLINK_MS    = 1600;  // blink window before boom
export const BOMB_EXPLOSION_RADIUS = 3.2; // meters
export const BOMB_EXPLOSION_MS = 450;  // visible flash duration
export const BOMB_COOLDOWN_MS  = 2500; // per-player throttle
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

// Spawn a falling bomb at a world position (zero horizontal velocity).
export type DropBombFn = (x: number, y: number, z: number) => void;

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
  megaJump: (g: Globals) => g.megaJump as FireFn | undefined,
  setMegaJump: (g: Globals, fn: FireFn) => { g.megaJump = fn; },
  // 🦅💩 Drop a bomb from an arbitrary world position (used by the
  // bird-poop voice action). Zero horizontal velocity — just gravity.
  dropBombAt: (g: Globals) => g.dropBombAt as DropBombFn | undefined,
  setDropBombAt: (g: Globals, fn: DropBombFn) => { g.dropBombAt = fn; },
  // "kaka" / "gga gga" voice trigger — PortalSystem iterates its flying
  // birds and calls dropBombAt at each one's position.
  birdPoop: (g: Globals) => g.birdPoop as FireFn | undefined,
  setBirdPoop: (g: Globals, fn: FireFn) => { g.birdPoop = fn; },
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
  // Live max-health. Starts at MAX_HEALTH and grows by MUSHROOM_HEAL
  // per 🍄 pickup; shrinks back by MUSHROOM_HEAL whenever a hit pops a
  // mushroom off the tail. Floors at MAX_HEALTH.
  playerMaxHealth: (g: Globals) => getOrInit<number>(g, "playerMaxHealth", MAX_HEALTH),
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
  // 💩 bomb ability — picking up a poopoodoodoo item flips this true
  // and grants UNLIMITED throws for the rest of the round. Reset on
  // ROUND_START / ROUND_END / death.
  hasBomb:        (g: Globals) => getOrInit<boolean>(g, "hasBomb", false),
  // 🪶 mega-jump ability — picking up a feather grants unlimited
  // peacock-phrase jumps. Same lifecycle as hasBomb.
  hasMegaJump:    (g: Globals) => getOrInit<boolean>(g, "hasMegaJump", false),
  // True on the broadcast (spectator) page. PortalSystem and friends
  // gate their gameplay ticks on this — spectator only renders.
  isSpectator:    (g: Globals) => getOrInit<boolean>(g, "isSpectator", false),
  // Live grid scale — portal.html slider writes here (via WS + server
  // relay). PortalSystem + the stage meshes subscribe and rebuild.
  gridScale:      (g: Globals) => getOrInit<number>(g, "gridScale", GRID_SCALE_DEFAULT),
  // Live emoji scale — scales every sprite's visual size AND its
  // interaction hitboxes together (pickup/enemy-touch/sword/fire/bird).
  emojiScale:     (g: Globals) => getOrInit<number>(g, "emojiScale", EMOJI_SCALE_DEFAULT),
};

// Per-user live stats, exposed on globals so the spectator HUD can
// read it without coupling to PortalSystem internals.
export type PlayerStat = {
  score: number;
  health: number;
  goalsCollected: number;
  goalsTotal: number;
  dead: boolean;
};
export function getPlayerStats(g: Globals): Map<string, PlayerStat> {
  let m = g.playerStats as Map<string, PlayerStat> | undefined;
  if (!m) { m = new Map(); g.playerStats = m; }
  return m;
}

// Enemies use this as a cell-size for wall avoidance: a wall occupies
// ~0.95m of a cell, so 0.5 is a reasonable "don't enter" radius.
export const WALL_CELL_HALF = 0.48;

export const RESULT_DISPLAY_MS = 4500;
