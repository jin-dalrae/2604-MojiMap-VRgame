// WeaponSystem — spawns/despawns the weapon meshes on the player's hands
// in response to `equippedLeft` / `equippedRight` signal changes.
//
// The weapon is attached directly to `player.gripSpaces.left/right` so it
// tracks the controller 1:1 with zero cost (no per-frame transform sync).
// Signal-driven — no polling in update().

import {
  createSystem,
  Group,
  Mesh,
  BoxGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  Object3D,
  InputComponent,
} from "@iwsdk/core";
import {
  GameState,
  GameActions,
  GUN_COOLDOWN_MS,
  SWORD_SWING_MS,
} from "./game-state.js";
import { FX } from "./game-fx.js";

// Factories kept tiny on purpose — these are placeholder shapes that
// read clearly in VR without asset loading. Swap for GLTFs later.
function makeSword(): Group {
  const group = new Group();

  // Blade — extends forward from the grip (controller-local -Z)
  const blade = new Mesh(
    new BoxGeometry(0.04, 0.04, 0.6),
    new MeshStandardMaterial({ color: 0xd4d4d8, metalness: 0.8, roughness: 0.2 }),
  );
  blade.position.set(0, 0, -0.3);
  group.add(blade);

  // Hilt — short handle behind the grip origin
  const hilt = new Mesh(
    new BoxGeometry(0.03, 0.03, 0.12),
    new MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 }),
  );
  hilt.position.set(0, 0, 0.06);
  group.add(hilt);

  // Crossguard
  const guard = new Mesh(
    new BoxGeometry(0.16, 0.02, 0.03),
    new MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.6, roughness: 0.4 }),
  );
  guard.position.set(0, 0, 0);
  group.add(guard);

  return group;
}

function makeSquirtGun(): Group {
  const group = new Group();

  // Barrel forward
  const barrel = new Mesh(
    new CylinderGeometry(0.025, 0.025, 0.18, 12),
    new MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.5 }),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.09);
  group.add(barrel);

  // Body (block above grip)
  const body = new Mesh(
    new BoxGeometry(0.06, 0.08, 0.12),
    new MeshStandardMaterial({ color: 0xef4444, roughness: 0.6 }),
  );
  body.position.set(0, 0.01, 0);
  group.add(body);

  // Handle
  const handle = new Mesh(
    new BoxGeometry(0.04, 0.1, 0.04),
    new MeshStandardMaterial({ color: 0xef4444, roughness: 0.6 }),
  );
  handle.position.set(0, -0.06, 0.02);
  group.add(handle);

  return group;
}

export class WeaponSystem extends createSystem({}) {
  private leftWeapon: Object3D | null = null;
  private rightWeapon: Object3D | null = null;
  private lastFireAt = 0;
  private gunEquipped = false;
  private swordEquipped = false;
  // Set to performance.now() when a swing starts; cleared when the
  // animation completes. Drives the sword's rotation.y sweep.
  private swingAnimStartAt = 0;

  init() {
    const globals = this.world.globals as Record<string, unknown>;
    const equippedLeft  = GameState.equippedLeft(globals);
    const equippedRight = GameState.equippedRight(globals);
    const lastSwingAt   = GameState.lastSwingAt(globals);

    this.cleanupFuncs.push(
      equippedLeft.subscribe((v) => {
        this.syncLeft(v);
        this.swordEquipped = v === 'sword';
      }),
      equippedRight.subscribe((v) => {
        this.syncRight(v);
        this.gunEquipped = v === 'gun';
      }),
      // PortalSystem bumps this signal whenever swingSword() runs — that's
      // our cue to kick the visual animation. This fires both for keyboard
      // and controller triggered swings.
      lastSwingAt.subscribe((ms) => {
        if (ms > 0) this.swingAnimStartAt = performance.now();
      }),
    );
  }

  // Per-frame: poll gun/sword triggers, run sword swing animation.
  update() {
    const now = performance.now();

    // Right trigger → fire squirt gun (rate-limited).
    if (this.gunEquipped) {
      const gamepad = this.input.gamepads.right;
      if (gamepad?.getButtonDown(InputComponent.Trigger) &&
          now - this.lastFireAt >= GUN_COOLDOWN_MS) {
        this.lastFireAt = now;
        const fire = GameActions.fireProjectile(this.world.globals as Record<string, unknown>);
        fire?.();
        FX.gunFire(gamepad);
      }
    }

    // Left trigger → swing sword. Dispatches to PortalSystem which
    // applies the damage and bumps lastSwingAt → triggers our animation.
    if (this.swordEquipped) {
      const gamepad = this.input.gamepads.left;
      if (gamepad?.getButtonDown(InputComponent.Trigger)) {
        const swing = GameActions.swingSword(this.world.globals as Record<string, unknown>);
        swing?.();
      }
    }

    // Sword swing animation — sine arc on rotation.y over SWORD_SWING_MS.
    if (this.swingAnimStartAt > 0 && this.leftWeapon) {
      const t = (now - this.swingAnimStartAt) / SWORD_SWING_MS;
      if (t >= 1) {
        this.leftWeapon.rotation.y = 0;
        this.swingAnimStartAt = 0;
      } else {
        // Forehand slash — start neutral, sweep to ~2π/3 forehand, return.
        this.leftWeapon.rotation.y = -Math.sin(t * Math.PI) * (2 * Math.PI / 3);
      }
    }
  }

  private syncLeft(weapon: "sword" | null) {
    if (weapon === "sword" && !this.leftWeapon) {
      this.leftWeapon = makeSword();
      this.player.gripSpaces.left.add(this.leftWeapon);
    } else if (!weapon && this.leftWeapon) {
      this.player.gripSpaces.left.remove(this.leftWeapon);
      this.disposeSubtree(this.leftWeapon);
      this.leftWeapon = null;
      this.swingAnimStartAt = 0; // cancel any in-flight animation
    }
  }

  private syncRight(weapon: "gun" | null) {
    if (weapon === "gun" && !this.rightWeapon) {
      this.rightWeapon = makeSquirtGun();
      this.player.gripSpaces.right.add(this.rightWeapon);
    } else if (!weapon && this.rightWeapon) {
      this.player.gripSpaces.right.remove(this.rightWeapon);
      this.disposeSubtree(this.rightWeapon);
      this.rightWeapon = null;
    }
  }

  // Clean up geometry/materials so re-equipping doesn't leak GPU memory.
  private disposeSubtree(obj: Object3D) {
    obj.traverse((node) => {
      const mesh = node as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose?.();
      }
    });
  }
}
