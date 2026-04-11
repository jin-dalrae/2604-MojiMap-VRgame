import {
  AssetManifest,
  AssetType,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  World,
  AssetManager,
  SRGBColorSpace,
} from "@iwsdk/core";

import { SyncSystem, Synced } from "./sync.js";

const assets: AssetManifest = {
  robot: { url: "/gltf/robot/robot.gltf", type: AssetType.GLTF },
  environmentDesk: { url: "/gltf/environmentDesk/environmentDesk.gltf", type: AssetType.GLTF },
};

async function init() {
  const container = document.getElementById("scene-container") as HTMLDivElement;
  
  const world = await World.create(container, {
    assets,
    xr: { offer: "none" }, // Broadcast view is spectator only
    features: {
      locomotion: false,
      grabbing: false,
      physics: false,
    },
  });

  const { scene, camera } = world;
  
  // Configure Broadcast Camera View
  camera.position.set(3, 3, 5);
  camera.lookAt(0, 1, 0);

  // Register Sync System
  world.registerSystem(SyncSystem);

  // Base Environment (Same as index.ts)
  const { scene: deskMesh } = AssetManager.getGLTF("environmentDesk")!;
  deskMesh.traverse((node) => {
    if (node instanceof Mesh && node.material) {
      if (node.material.map) node.material.map.colorSpace = SRGBColorSpace;
    }
  });
  world.createTransformEntity(deskMesh);

  // Player Visual Proxy
  // We'll create a simple head proxy that follows the VR user
  const headGeom = new SphereGeometry(0.15, 16, 16);
  const headMat = new MeshBasicMaterial({ color: 0x6366f1, wireframe: true });
  const headProxy = new Mesh(headGeom, headMat);
  world.createTransformEntity(headProxy)
    .addComponent(Synced, { id: "player_head" });

  console.log("Broadcast Mode Initialized");
}

init();
