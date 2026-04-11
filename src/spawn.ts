import {
  createSystem,
  EnvironmentRaycastTarget,
  InputComponent,
  Vector3,
  World,
} from "@iwsdk/core";
import { BallSystem } from "./ball.js";

export class SurfaceSpawnSystem extends createSystem({
  spawners: { required: [EnvironmentRaycastTarget] },
}) {
  private hitPos!: Vector3;

  init() {
    this.hitPos = new Vector3();
  }

  update() {
    const leftGamepad = this.input.gamepads.left;
    const rightGamepad = this.input.gamepads.right;

    // Check for trigger press on right controller
    const triggerPressed = rightGamepad?.getButtonDown(InputComponent.Trigger);

    if (triggerPressed) {
      for (const entity of this.queries.spawners.entities) {
        const xrResult = entity.getValue(EnvironmentRaycastTarget, "xrHitTestResult");
        if (xrResult) {
          // The entity with EnvironmentRaycastTarget is automatically 
          // positioned at the hit location by EnvironmentRaycastSystem.
          const pos = entity.object3D!.position;
          
          const ballSystem = this.world.getSystem(BallSystem);
          if (ballSystem) {
             // Spawn a slightly higher to let it fall
             ballSystem.createBall(this.world, [pos.x, pos.y + 0.2, pos.z], 0x6366f1);
          }
        }
      }
    }
  }
}
