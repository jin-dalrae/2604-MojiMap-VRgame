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
export const ENEMY_HP = 3;
export const ENEMY_DAMAGE_RADIUS = 0.6; // meters — enemy touch damages player
export const ENEMY_DPS = 20;
export const ENEMY_SPEED = 0.7;         // m/s, chase velocity
export const ENEMY_KILL_POINTS = 2;
export const SWORD_RADIUS = 0.6;        // meters — grip-to-enemy
export const SWORD_DAMAGE = 1;
export const SWORD_COOLDOWN_MS = 350;
export const PROJECTILE_SPEED = 12;     // m/s
export const PROJECTILE_LIFE_MS = 2500;
export const PROJECTILE_RADIUS = 0.25;  // collision radius with enemies
export const PROJECTILE_DAMAGE = 1;
export const GUN_COOLDOWN_MS = 220;     // rate-limit trigger spam

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

export const GameActions = {
  damageEnemy: (g: Globals) => g.damageEnemy as DamageFn | undefined,
  setDamageEnemy: (g: Globals, fn: DamageFn) => { g.damageEnemy = fn; },
  findEnemyAt: (g: Globals) => g.findEnemyAt as FindEnemyFn | undefined,
  setFindEnemyAt: (g: Globals, fn: FindEnemyFn) => { g.findEnemyAt = fn; },
  fireProjectile: (g: Globals) => g.fireProjectile as FireFn | undefined,
  setFireProjectile: (g: Globals, fn: FireFn) => { g.fireProjectile = fn; },
};

// Named getters so signal names stay consistent across systems.
export const GameState = {
  roundRunning: (g: Globals) => getOrInit<boolean>(g, "roundRunning", false),
  roundEndsAt:  (g: Globals) => getOrInit<number>(g, "roundEndsAt", 0),
  score:        (g: Globals) => getOrInit<number>(g, "score", 0),
  playerHealth: (g: Globals) => getOrInit<number>(g, "playerHealth", MAX_HEALTH),
  equippedLeft: (g: Globals) => getOrInit<"sword" | null>(g, "equippedLeft", null),
  equippedRight:(g: Globals) => getOrInit<"gun" | null>(g, "equippedRight", null),
};
