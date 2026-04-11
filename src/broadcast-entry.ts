import {
  Mesh,
  MeshBasicMaterial,
  GridHelper,
  PlaneGeometry,
  SphereGeometry,
  World,
  Vector3,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
} from "@iwsdk/core";

async function init() {
  const container = document.getElementById("scene-container") as HTMLDivElement;

  const world = await World.create(container, {
    xr: { offer: "none" },
    features: {
      locomotion: false,
      grabbing: false,
      physics: false,
    },
  });

  const { camera } = world;

  // ── Grid Floor (20×20 to match portal grid) ────────────────
  const gridHelper = new GridHelper(20, 20, 0x6366f1, 0x27272a);
  (gridHelper.material as any).transparent = true;
  (gridHelper.material as any).opacity = 0.7;
  world.createTransformEntity(gridHelper);

  const floorGeom = new PlaneGeometry(20, 20);
  floorGeom.rotateX(-Math.PI / 2);
  const floorMat = new MeshBasicMaterial({
    color: 0x0d0d10,
    transparent: true,
    opacity: 0.6,
  });
  const floorMesh = new Mesh(floorGeom, floorMat);
  floorMesh.position.y = -0.001;
  world.createTransformEntity(floorMesh);

  // Subtle portal-grid outline (10 rows × 20 cols = 10m × 20m centered)
  const outlineGeom = new PlaneGeometry(20, 10);
  outlineGeom.rotateX(-Math.PI / 2);
  const outlineMat = new MeshBasicMaterial({
    color: 0x6366f1,
    transparent: true,
    opacity: 0.04,
  });
  const outlineMesh = new Mesh(outlineGeom, outlineMat);
  outlineMesh.position.y = 0.002;
  world.createTransformEntity(outlineMesh);

  // ── Camera orbit ───────────────────────────────────────────
  let alpha = Math.PI / 2;     // horizontal rotation (look from +Z toward origin)
  let beta = Math.PI / 3;      // tilt (high angle above grid)
  let radius = 18;             // zoom
  const target = new Vector3(0, 0, 0);

  const updateCamera = () => {
    beta = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, beta));
    camera.position.x = target.x + radius * Math.cos(alpha) * Math.cos(beta);
    camera.position.y = target.y + radius * Math.sin(beta);
    camera.position.z = target.z + radius * Math.sin(alpha) * Math.cos(beta);
    camera.lookAt(target);
  };
  updateCamera();

  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  container.addEventListener("mousedown", (e) => {
    isDragging = true; lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    alpha -= (e.clientX - lastX) * 0.01;
    beta  += (e.clientY - lastY) * 0.01;
    updateCamera();
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener("mouseup", () => { isDragging = false; });
  container.addEventListener("wheel", (e) => {
    radius = Math.max(4, Math.min(40, radius + e.deltaY * 0.02));
    updateCamera();
  }, { passive: true });

  // ── Emoji sprite factory ───────────────────────────────────
  function makeEmojiSprite(emoji: string, size = 1.1): Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '96px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 72);

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new Sprite(material);
    sprite.scale.set(size, size, 1);
    return sprite;
  }

  // ── Player marker ──────────────────────────────────────────
  const playerGeom = new SphereGeometry(0.2, 16, 16);
  const playerMat = new MeshBasicMaterial({ color: 0x6366f1 });
  const playerMesh = new Mesh(playerGeom, playerMat);
  playerMesh.position.set(0, 0.2, 0);
  playerMesh.visible = false;
  const playerLabel = makeEmojiSprite('🧑', 0.8);
  playerLabel.position.y = 0.9;
  playerMesh.add(playerLabel);
  world.createTransformEntity(playerMesh);

  // Glowing ring under player
  const ringGeom = new PlaneGeometry(0.9, 0.9);
  ringGeom.rotateX(-Math.PI / 2);
  const ringMat = new MeshBasicMaterial({
    color: 0x6366f1, transparent: true, opacity: 0.35, depthWrite: false,
  });
  const ringMesh = new Mesh(ringGeom, ringMat);
  ringMesh.visible = false;
  playerMesh.add(ringMesh);
  ringMesh.position.y = -0.19;

  // ── Grid item tracking ─────────────────────────────────────
  const spawnedSprites = new Map<string, Sprite>();

  function spawnGridItem(key: string, item: { type: string; icon: string; label: string }) {
    despawnGridItem(key);
    const [row, col] = key.split(',').map(Number);
    const x = col - 9.5;
    const z = row - 4.5;

    const sprite = makeEmojiSprite(item.icon, 1.1);
    sprite.position.set(x, 0.55, z);
    world.createTransformEntity(sprite);
    spawnedSprites.set(key, sprite);
  }

  function despawnGridItem(key: string) {
    const sprite = spawnedSprites.get(key);
    if (sprite) {
      sprite.parent?.remove(sprite);
      const mat = sprite.material as SpriteMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
      spawnedSprites.delete(key);
    }
  }

  // ── WebSocket sync ─────────────────────────────────────────
  function connectWS() {
    const url = `ws://${window.location.hostname}:3001`;
    console.log(`[Broadcast] Connecting → ${url}`);
    const ws = new WebSocket(url);

    ws.onopen = () => console.log('[Broadcast] Connected');

    ws.onclose = () => {
      console.log('[Broadcast] Disconnected — retrying in 2s');
      setTimeout(connectWS, 2000);
    };

    ws.onmessage = (e: MessageEvent) => {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }

      switch (msg.type) {
        case 'INIT':
          for (const key of [...spawnedSprites.keys()]) despawnGridItem(key);
          for (const [key, item] of Object.entries(msg.grid as Record<string, any>)) {
            spawnGridItem(key, item);
          }
          if (msg.playerPosition) updatePlayerPosition(msg.playerPosition);
          break;
        case 'GRID_UPDATE':
          spawnGridItem(msg.key, msg.item);
          break;
        case 'GRID_CLEAR':
          despawnGridItem(msg.key);
          break;
        case 'GRID_CLEAR_ALL':
          for (const key of [...spawnedSprites.keys()]) despawnGridItem(key);
          break;
        case 'PLAYER_POSITION':
          updatePlayerPosition(msg.position);
          break;
      }
    };
  }

  function updatePlayerPosition(pos: { x: number; z: number }) {
    playerMesh.visible = true;
    ringMesh.visible = true;
    playerMesh.position.x = pos.x;
    playerMesh.position.z = pos.z;
  }

  connectWS();

  console.log('Broadcast Mode Initialized');
}

init();
