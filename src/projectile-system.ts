// ProjectileSystem — spawns, moves, and collides water droplets fired
// from the squirt gun.
//
// Projectiles are plain Three.js meshes kept in a local array; they're
// short-lived and high-churn so the entity overhead isn't worth it.
// Hit detection uses the `findEnemyAt` callback so this system stays
// ignorant of how items are stored — PortalSystem owns that.

import {
  createSystem,
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  Vector3,
  Quaternion,
} from "@iwsdk/core";
import {
  GameActions,
  PROJECTILE_SPEED,
  PROJECTILE_LIFE_MS,
  PROJECTILE_RADIUS,
  PROJECTILE_DAMAGE,
} from "./game-state.js";

// Shared geometry + material — cheaper than per-projectile allocation.
const DROPLET_GEOM = new SphereGeometry(0.04, 8, 6);
const DROPLET_MAT = new MeshBasicMaterial({
  color: 0x22d3ee,
  transparent: true,
  opacity: 0.9,
});

type Droplet = {
  mesh: Mesh;
  velocity: Vector3;
  diesAt: number; // ms epoch
};

const HIT_RADIUS2 = PROJECTILE_RADIUS * PROJECTILE_RADIUS;

export class ProjectileSystem extends createSystem({}) {
  private droplets: Droplet[] = [];
  private tempQuat!: Quaternion;

  init() {
    this.tempQuat = new Quaternion();
    GameActions.setFireProjectile(
      this.world.globals as Record<string, unknown>,
      () => this.fire(),
    );
  }

  // gripSpace local -Z is "forward" in WebXR controller convention.
  private fire() {
    const grip = this.player.gripSpaces.right;
    const mesh = new Mesh(DROPLET_GEOM, DROPLET_MAT);
    grip.getWorldPosition(mesh.position);
    grip.getWorldQuaternion(this.tempQuat);

    const forward = new Vector3(0, 0, -1).applyQuaternion(this.tempQuat);
    // Nudge start forward so the droplet doesn't clip the gun barrel.
    mesh.position.addScaledVector(forward, 0.2);

    this.scene.add(mesh);
    this.droplets.push({
      mesh,
      velocity: forward.multiplyScalar(PROJECTILE_SPEED),
      diesAt: performance.now() + PROJECTILE_LIFE_MS,
    });
  }

  update(delta: number) {
    if (this.droplets.length === 0) return;

    const now = performance.now();
    const findEnemy = GameActions.findEnemyAt(this.world.globals as Record<string, unknown>);
    const damage    = GameActions.damageEnemy(this.world.globals as Record<string, unknown>);

    // Iterate backwards so splice(i,1) doesn't skip elements.
    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const d = this.droplets[i];
      d.mesh.position.addScaledVector(d.velocity, delta);
      const p = d.mesh.position;

      // Hit detection: nearest enemy within our radius dies on contact.
      if (findEnemy && damage) {
        const key = findEnemy(p.x, p.y, p.z, HIT_RADIUS2);
        if (key) {
          damage(key, PROJECTILE_DAMAGE);
          this.retireAt(i);
          continue;
        }
      }

      // Expire by timeout or if it dropped below the floor.
      if (now >= d.diesAt || p.y < -1) {
        this.retireAt(i);
      }
    }
  }

  private retireAt(i: number) {
    const d = this.droplets[i];
    this.scene.remove(d.mesh);
    this.droplets.splice(i, 1);
  }
}
