import {
  Mesh,
  PlaneGeometry,
  SessionMode,
  World,
  MeshStandardMaterial,
  EnvironmentType,
  LocomotionEnvironment,
} from "@iwsdk/core";

import { PortalSystem } from "./portal.js";
import { SyncSystem } from "./sync.js";
import { createGlitchFloorMaterial, GlitchFloor, GlitchFloorSystem } from "./glitch-floor.js";

World.create(document.getElementById("scene-container") as HTMLDivElement, {
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: "always",
    features: { handTracking: true, layers: true },
  },
  features: {
    locomotion: { useWorker: true },
    grabbing: false,
    physics: false,
    sceneUnderstanding: true,
    environmentRaycast: true,
  },
}).then((world) => {
  const { camera } = world;

  // Start the non-XR preview camera above the grid looking toward origin
  // so the first-person/flat view immediately shows what's there.
  camera.position.set(0, 6, 9);
  camera.lookAt(0, 0, 0);

  world
    .registerSystem(PortalSystem)
    .registerSystem(SyncSystem)
    .registerSystem(GlitchFloorSystem);

  // ── Glitch Floor (20 cols × 10 rows) ──────────────────────
  const floorGeom = new PlaneGeometry(20, 10);
  floorGeom.rotateX(-Math.PI / 2);
  const glitchMat = createGlitchFloorMaterial();
  const floorMesh = new Mesh(floorGeom, glitchMat);
  const floorEntity = world.createTransformEntity(floorMesh);
  floorEntity
    .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC })
    .addComponent(GlitchFloor, { material: glitchMat });

  // Invisible extended floor so the player can't fall off the edge.
  // 200×200 covers far beyond anywhere they could walk.
  const safeGeom = new PlaneGeometry(200, 200);
  safeGeom.rotateX(-Math.PI / 2);
  const safeMat = new MeshStandardMaterial({
    visible: false,
  });
  const safeMesh = new Mesh(safeGeom, safeMat);
  safeMesh.position.y = -0.01;
  world
    .createTransformEntity(safeMesh)
    .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });
});
