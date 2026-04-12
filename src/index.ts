import {
  Mesh,
  PlaneGeometry,
  SessionMode,
  World,
  LineSegments,
  LineBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  MeshStandardMaterial,
  EnvironmentType,
  LocomotionEnvironment,
} from "@iwsdk/core";

import { PortalSystem } from "./portal.js";
import { SyncSystem } from "./sync.js";

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
    .registerSystem(SyncSystem);

  // ── Grid Floor (20 cols × 10 rows, 1m square cells) ───────
  {
    const cols = 20, rows = 10, cell = 1;
    const halfW = (cols * cell) / 2;
    const halfD = (rows * cell) / 2;
    const verts: number[] = [];
    for (let i = 0; i <= cols; i++) {
      const x = -halfW + i * cell;
      verts.push(x, 0, -halfD, x, 0, halfD);
    }
    for (let j = 0; j <= rows; j++) {
      const z = -halfD + j * cell;
      verts.push(-halfW, 0, z, halfW, 0, z);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(verts, 3));
    const mat = new LineBasicMaterial({
      color: 0x6366f1,
      transparent: true,
      opacity: 0.8,
    });
    const gridLines = new LineSegments(geo, mat);
    gridLines.position.y = 0.01;
    world.createTransformEntity(gridLines);
  }

  // Floor plane — gives the locomotion system something to stand on
  // and keeps placed grid items from blending into the passthrough feed.
  const floorGeom = new PlaneGeometry(20, 10);
  floorGeom.rotateX(-Math.PI / 2);
  const floorMat = new MeshStandardMaterial({
    color: 0x09090b,
    transparent: true,
    opacity: 0.35,
    roughness: 1.0,
  });
  const floorMesh = new Mesh(floorGeom, floorMat);
  world
    .createTransformEntity(floorMesh)
    .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });
});
