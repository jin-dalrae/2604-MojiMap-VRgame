import {
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  ConeGeometry,
  World,
  Vector3,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  LineSegments,
  LineBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
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

  const { scene, camera } = world;
  scene.fog = null;

  // ── Grid Floor (20 cols × 10 rows, 1m square cells) ──────────
  function makeRectGrid(cols: number, rows: number, cell = 1): LineSegments {
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
    geo.setAttribute('position', new Float32BufferAttribute(verts, 3));
    const mat = new LineBasicMaterial({ color: 0x8b8fa8 });
    return new LineSegments(geo, mat);
  }
  const gridLines = makeRectGrid(20, 10, 1);
  gridLines.position.y = 0.002;
  world.createTransformEntity(gridLines);

  // Opaque floor plane — darker than grid lines so lines stay visible.
  const floorGeom = new PlaneGeometry(20, 10);
  floorGeom.rotateX(-Math.PI / 2);
  const floorMat = new MeshBasicMaterial({ color: 0x3f3f52 });
  const floorMesh = new Mesh(floorGeom, floorMat);
  floorMesh.position.y = 0;
  world.createTransformEntity(floorMesh);

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

    ctx.font = '108px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 70);

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new SpriteMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.1,
      depthWrite: true,
    });
    const sprite = new Sprite(material);
    sprite.scale.set(size, size, 1);
    return sprite;
  }

  // ── Per-user player marker factory ────────────────────────
  // Each connected VR user gets a sphere + emoji head + ring + facing cone,
  // all parented under a single entity so position/heading sync is cheap.
  type PlayerMarker = {
    entity: ReturnType<typeof world.createTransformEntity>;
    root: Mesh;
    headingPivot: Mesh;
    cone: Mesh;
  };

  const USER_COLORS = [
    0x6366f1, 0xec4899, 0xf59e0b, 0x10b981,
    0x3b82f6, 0xef4444, 0xa855f7, 0x14b8a6,
  ];
  // Shared cone geometry so new users don't re-allocate it.
  const sharedConeGeom = new ConeGeometry(0.9, 1.6, 24, 1, true);
  sharedConeGeom.rotateX(-Math.PI / 2);
  sharedConeGeom.translate(0, 0, 0.8);

  function colorForUser(userId: string): number {
    let h = 0;
    for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
    return USER_COLORS[Math.abs(h) % USER_COLORS.length];
  }

  function createPlayerMarker(userId: string): PlayerMarker {
    const color = colorForUser(userId);

    const root = new Mesh(
      new SphereGeometry(0.2, 16, 16),
      new MeshBasicMaterial({ color }),
    );
    root.position.set(0, 0.2, 0);

    const label = makeEmojiSprite('🧑', 0.8);
    label.position.y = 0.9;
    root.add(label);

    const ring = new Mesh(
      new PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    ring.position.y = -0.19;
    root.add(ring);

    const headingPivot = new Mesh(
      new PlaneGeometry(0, 0),
      new MeshBasicMaterial({ visible: false }),
    );
    root.add(headingPivot);

    const cone = new Mesh(
      sharedConeGeom,
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: 2, // DoubleSide
      }),
    );
    cone.position.y = 0.9;
    headingPivot.add(cone);

    const entity = world.createTransformEntity(root);
    return { entity, root, headingPivot, cone };
  }

  function disposePlayerMarker(m: PlayerMarker) {
    // Recursively dispose per-marker materials/geometries (except shared cone).
    m.root.traverse((obj: any) => {
      if (obj === m.headingPivot) return;
      if (obj.geometry && obj.geometry !== sharedConeGeom) obj.geometry.dispose?.();
      if (obj.material) {
        const mat = obj.material;
        if (mat.map) mat.map.dispose?.();
        mat.dispose?.();
      }
    });
    m.entity.dispose();
  }

  const players = new Map<string, PlayerMarker>();

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
        case 'WELCOME':
          // Full state snapshot: grid + everyone currently present.
          for (const key of [...spawnedSprites.keys()]) despawnGridItem(key);
          for (const [key, item] of Object.entries(msg.grid as Record<string, any>)) {
            spawnGridItem(key, item);
          }
          for (const [, marker] of players) disposePlayerMarker(marker);
          players.clear();
          for (const [userId, user] of Object.entries(msg.users as Record<string, any>)) {
            updatePlayerMarker(userId, user.position);
          }
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
        case 'USER_JOIN':
          updatePlayerMarker(msg.userId, msg.position);
          break;
        case 'USER_LEAVE': {
          const m = players.get(msg.userId);
          if (m) { disposePlayerMarker(m); players.delete(msg.userId); }
          break;
        }
        case 'PLAYER_POSITION':
          updatePlayerMarker(msg.userId, msg.position);
          break;
      }
    };
  }

  function updatePlayerMarker(
    userId: string,
    pos: { x: number; z: number; heading?: number; pitch?: number },
  ) {
    let marker = players.get(userId);
    if (!marker) {
      marker = createPlayerMarker(userId);
      players.set(userId, marker);
    }
    marker.root.position.x = pos.x;
    marker.root.position.z = pos.z;
    if (typeof pos.heading === 'number') {
      marker.headingPivot.rotation.y = pos.heading;
    }
    if (typeof pos.pitch === 'number') {
      marker.cone.rotation.x = -pos.pitch;
    }
  }

  connectWS();

  console.log('Broadcast Mode Initialized');
}

init();
