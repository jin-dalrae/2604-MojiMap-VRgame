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

// Named getters so signal names stay consistent across systems.
export const GameState = {
  roundRunning: (g: Globals) => getOrInit<boolean>(g, "roundRunning", false),
  roundEndsAt:  (g: Globals) => getOrInit<number>(g, "roundEndsAt", 0),
  score:        (g: Globals) => getOrInit<number>(g, "score", 0),
  playerHealth: (g: Globals) => getOrInit<number>(g, "playerHealth", MAX_HEALTH),
  equippedLeft: (g: Globals) => getOrInit<"sword" | null>(g, "equippedLeft", null),
  equippedRight:(g: Globals) => getOrInit<"gun" | null>(g, "equippedRight", null),
};
