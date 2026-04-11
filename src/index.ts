import {
  AssetManifest,
  AssetType,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SessionMode,
  SRGBColorSpace,
  AssetManager,
  World,
} from "@iwsdk/core";

import {
  AudioSource,
  DistanceGrabbable,
  MovementMode,
  Interactable,
  PanelUI,
  PlaybackMode,
  ScreenSpace,
} from "@iwsdk/core";

import {
  EnvironmentType,
  LocomotionEnvironment,
  DomeGradient,
  EnvironmentRaycastTarget,
  RaycastSpace,
  TorusGeometry,
  MeshStandardMaterial,
  GridHelper,
  Color,
} from "@iwsdk/core";

import { BallSystem } from "./ball.js";
import { SurfaceSpawnSystem } from "./spawn.js";
import { PortalSystem } from "./portal.js";
import { SyncSystem, Synced } from "./sync.js";

import { PanelSystem } from "./panel.js";

import { Robot } from "./robot.js";

import { RobotSystem } from "./robot.js";

const assets: AssetManifest = {
  chimeSound: {
    url: "/audio/chime.mp3",
    type: AssetType.Audio,
    priority: "background",
  },
  webxr: {
    url: "/textures/webxr.png",
    type: AssetType.Texture,
    priority: "critical",
  },
  environmentDesk: {
    url: "./gltf/environmentDesk/environmentDesk.gltf",
    type: AssetType.GLTF,
    priority: "critical",
  },
  plantSansevieria: {
    url: "./gltf/plantSansevieria/plantSansevieria.gltf",
    type: AssetType.GLTF,
    priority: "critical",
  },
  robot: {
    url: "./gltf/robot/robot.gltf",
    type: AssetType.GLTF,
    priority: "critical",
  },
};

World.create(document.getElementById("scene-container") as HTMLDivElement, {
  assets,
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: "always",
    // Optional structured features; layers/local-floor are offered by default
    features: { handTracking: true, layers: true },
  },
  features: {
    locomotion: { useWorker: true },
    grabbing: true,
    physics: true,
    sceneUnderstanding: true,
    environmentRaycast: true,
  },
}).then((world) => {
  const { camera } = world;

  camera.position.set(-4, 1.5, -6);
  camera.rotateY(-Math.PI * 0.75);

  const { scene: envMesh } = AssetManager.getGLTF("environmentDesk")!;
  envMesh.rotateY(Math.PI);
  envMesh.position.set(0, -0.1, 0);
  world
    .createTransformEntity(envMesh)
    .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

  // Premium Environment Gradient (Disabled in AR for Passthrough)
  /*
  const levelRoot = world.activeLevel.value;
  levelRoot.addComponent(DomeGradient, {
    sky: [0.05, 0.05, 0.2, 1.0],      // Deep night sky
    equator: [0.39, 0.4, 0.95, 1.0], // Indigo horizon
    ground: [0.02, 0.02, 0.05, 1.0], // Dark ground
    intensity: 1.2,
  });
  */

  const { scene: plantMesh } = AssetManager.getGLTF("plantSansevieria")!;

  plantMesh.position.set(1.2, 0.85, -1.8);

  world
    .createTransformEntity(plantMesh)
    .addComponent(Interactable)
    .addComponent(DistanceGrabbable, {
      movementMode: MovementMode.MoveFromTarget,
    });

  const { scene: robotMesh } = AssetManager.getGLTF("robot")!;
  robotMesh.position.set(-1.2, 0.95, -1.8);
  robotMesh.scale.setScalar(0.5);

  world
    .createTransformEntity(robotMesh)
    .addComponent(Interactable)
    .addComponent(Robot)
    .addComponent(AudioSource, {
      src: "./audio/chime.mp3",
      maxInstances: 3,
      playbackMode: PlaybackMode.FadeRestart,
    });

  const panelEntity = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: "/ui/welcome.json",
      maxHeight: 0.8,
      maxWidth: 1.6,
    })
    .addComponent(Interactable)
    .addComponent(ScreenSpace, {
      top: "20px",
      left: "20px",
      height: "40%",
    });
  panelEntity.object3D!.position.set(0, 1.29, -1.9);

  const webxrLogoTexture = AssetManager.getTexture("webxr")!;
  webxrLogoTexture.colorSpace = SRGBColorSpace;
  const logoBanner = new Mesh(
    new PlaneGeometry(3.39, 0.96),
    new MeshBasicMaterial({
      map: webxrLogoTexture,
      transparent: true,
    }),
  );
  world.createTransformEntity(logoBanner);
  logoBanner.position.set(0, 1, 1.8);
  logoBanner.rotateY(Math.PI);

  world
    .registerSystem(PanelSystem)
    .registerSystem(RobotSystem)
    .registerSystem(BallSystem)
    .registerSystem(SurfaceSpawnSystem)
    .registerSystem(PortalSystem)
    .registerSystem(SyncSystem);

  // Surface Spawner Reticle
  const reticleGeometry = new TorusGeometry(0.05, 0.005, 16, 32);
  reticleGeometry.rotateX(Math.PI / 2);
  const reticleMaterial = new MeshStandardMaterial({ 
    color: 0x6366f1, 
    transparent: true, 
    opacity: 0.8,
    emissive: 0x6366f1,
    emissiveIntensity: 0.5
  });
  const reticleMesh = new Mesh(reticleGeometry, reticleMaterial);
  world.createTransformEntity(reticleMesh)
    .addComponent(EnvironmentRaycastTarget, { space: RaycastSpace.Right });

  // Grid Floor (Matching Portal Grid — 20 cols × 10 rows, 1m cells)
  const gridSize = 20;
  const gridHelper = new GridHelper(gridSize, gridSize, 0x6366f1, 0x27272a);
  gridHelper.position.y = 0.01;
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.5;
  world.createTransformEntity(gridHelper);

  // Transparent Floor Plane for better collision/visibility
  const floorGeom = new PlaneGeometry(gridSize, gridSize);
  floorGeom.rotateX(-Math.PI / 2);
  const floorMat = new MeshStandardMaterial({ 
    color: 0x09090b, 
    transparent: true, 
    opacity: 0.2,
    roughness: 1.0 
  });
  const floorMesh = new Mesh(floorGeom, floorMat);
  world.createTransformEntity(floorMesh)
    .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

  // Create some interactive physics balls
  const ballSystem = world.getSystem(BallSystem);
  if (ballSystem) {
    ballSystem.createBall(world, [0.5, 1.2, -1.5], 0x6366f1); // Indigo
    ballSystem.createBall(world, [0.8, 1.2, -1.5], 0xf59e0b); // Amber
    ballSystem.createBall(world, [1.1, 1.2, -1.5], 0xec4899); // Pink
  }
});
