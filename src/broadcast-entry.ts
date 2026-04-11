import {
  AssetManifest,
  AssetType,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  World,
  AssetManager,
  SRGBColorSpace,
  Vector3,
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
  
  // Camera Orbit State
  let alpha = Math.PI / 4; // Horizontal rotation
  let beta = Math.PI / 6;  // Vertical rotation
  let radius = 6;          // Distance from center
  const target = new Vector3(0, 1, 0);

  const updateCamera = () => {
    // Clamp beta to avoid flipping
    beta = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, beta));
    
    camera.position.x = radius * Math.cos(alpha) * Math.cos(beta);
    camera.position.y = radius * Math.sin(beta) + target.y;
    camera.position.z = radius * Math.sin(alpha) * Math.cos(beta);
    camera.lookAt(target);
  };
  
  updateCamera();

  // Mouse Interactivity
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  container.addEventListener("mousedown", (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    
    alpha -= dx * 0.01;
    beta += dy * 0.01;
    
    updateCamera();
    
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener("mouseup", () => {
    isDragging = false;
  });

  // Scroll to zoom
  container.addEventListener("wheel", (e) => {
    radius = Math.max(2, Math.min(15, radius + e.deltaY * 0.01));
    updateCamera();
  }, { passive: true });

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
