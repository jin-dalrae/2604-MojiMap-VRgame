import {
  createComponent,
  createSystem,
  Entity,
  PhysicsBody,
  PhysicsShape,
  PhysicsShapeType,
  PhysicsState,
  Transform,
  Types,
  Vector3,
  Mesh,
  SphereGeometry,
  MeshStandardMaterial,
  Interactable,
  DistanceGrabbable,
  MovementMode,
} from "@iwsdk/core";

export const Ball = createComponent("Ball", {
  originalPosition: { type: Types.Vec3, default: [0, 0, 0] },
});

export class BallSystem extends createSystem({
  balls: { required: [Ball, Transform] },
}) {
  private tempVec!: Vector3;

  init() {
    this.tempVec = new Vector3();
  }

  update() {
    for (const entity of this.queries.balls.entities) {
      const position = entity.getVectorView(Transform, "position");
      // If the ball falls too far, reset it
      if (position[1] < -5) {
        this.resetBall(entity);
      }
    }
  }

  resetBall(entity: Entity) {
    const originalPosition = entity.getVectorView(Ball, "originalPosition");
    const hasPhysics = entity.hasComponent(PhysicsBody);
    
    // Reset position
    entity.setValue(Transform, "position", [originalPosition[0], originalPosition[1], originalPosition[2]]);
    
    // Reset velocities if physics is attached
    if (hasPhysics) {
      entity.setValue(PhysicsBody, "_linearVelocity", [0, 0, 0]);
      entity.setValue(PhysicsBody, "_angularVelocity", [0, 0, 0]);
    }
  }

  createBall(world: any, position: [number, number, number], color: number = 0xff0000) {
    const geometry = new SphereGeometry(0.15, 32, 32);
    const material = new MeshStandardMaterial({ 
      color,
      roughness: 0.4,
      metalness: 0.6
    });
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...position);

    const entity = world.createTransformEntity(mesh);
    entity.addComponent(Ball, { originalPosition: position });
    entity.addComponent(Interactable);
    entity.addComponent(DistanceGrabbable, {
      movementMode: MovementMode.MoveFromTarget,
    });
    entity.addComponent(PhysicsBody, {
      state: PhysicsState.Dynamic,
      mass: 1.0,
      restitution: 0.8,
      friction: 0.2,
    });
    entity.addComponent(PhysicsShape, {
      shape: PhysicsShapeType.Sphere,
    });

    return entity;
  }
}
