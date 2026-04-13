import {
  createSystem,
  Vector3,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  CylinderGeometry,
  ConeGeometry,
  DoubleSide,
  Object3D,
} from "@iwsdk/core";

// ── Grid coordinate mapping ──────────────────────────────────
// Portal grid: 20 cols × 10 rows
// Cell (row r, col c) center → world: x = c - 9.5, z = r - 4.5.
// y is chosen so the billboarded sprite hovers just above the grid floor.
function gridToWorld(row: number, col: number): [number, number, number] {
  return [col - 9.5, 0.55, row - 4.5];
}

// ── Emoji sprite factory ─────────────────────────────────────
// Same pipeline as the broadcast view: render the emoji character onto a
// CanvasTexture and wrap it in a Three.js Sprite so it always faces the
// headset. Works in WebXR — sprites are camera-locked quads.
function makeEmojiSprite(emoji: string, size = 1.1): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;

  ctx.font = '108px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
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

// ── Avatar colors (same palette as broadcast + portal) ──────
const AVATAR_COLORS = [
  0x6366f1, 0xec4899, 0xf59e0b, 0x10b981,
  0x3b82f6, 0xef4444, 0xa855f7, 0x14b8a6,
];
function colorForUser(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// Shared cone geometry for avatar facing indicators (allocated once).
// Tip at origin, base extends forward (+Z) — rotates with avatar heading.
const avatarConeGeom = new ConeGeometry(0.5, 1.2, 20, 1, true);
avatarConeGeom.rotateX(-Math.PI / 2); // tip → -Z, base → +Z
avatarConeGeom.translate(0, 0, 0.6);  // tip at z=0, base at z=1.2

type AvatarRecord = {
  root: Object3D;
  cone: Mesh;
  entity: { dispose(): void };
};

// ── System ───────────────────────────────────────────────────
export class PortalSystem extends createSystem({}) {
  private ws: WebSocket | null = null;
  private spawnedEntities = new Map<
    string,
    { entity: { dispose(): void }; sprite: Sprite }
  >();
  private avatars = new Map<string, AvatarRecord>();
  private lastPosSend = 0;
  private tempPos!: Vector3;
  private tempFwd!: Vector3;
  private userId: string | null = null;
  // spaceId is the Quest Shared Spaces XRSharedReferenceSpace UUID when available.
  // Set externally (e.g. by a future SharedSpaceSystem that requests the "shared"
  // feature and listens for the reference space UUID); forwarded on every update.
  public spaceId: string | null = null;
  // Pre-allocated to avoid update() allocations
  private posMsg: {
    type: string;
    position: { x: number; z: number; heading: number; pitch: number };
    spaceId: string | null;
  } = { type: 'PLAYER_POSITION', position: { x: 0, z: 0, heading: 0, pitch: 0 }, spaceId: null };

  init() {
    this.tempPos = new Vector3();
    this.tempFwd = new Vector3();
    this.connectWS();
  }

  private connectWS() {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const url = isLocal ? `ws://${window.location.hostname}:3001` : `wss://questproto-725835663363.us-west1.run.app`;
    console.log(`[GridSync] Connecting → ${url}`);
    const ws = new WebSocket(url);

    ws.onopen = () => console.log('[GridSync] Connected');

    ws.onmessage = (e: MessageEvent) => {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.handleMessage(msg);
    };

    ws.onclose = () => {
      console.log('[GridSync] Disconnected — retrying in 2s');
      setTimeout(() => this.connectWS(), 2000);
    };

    this.cleanupFuncs.push(() => ws.close());
    this.ws = ws;
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'WELCOME':
        this.userId = msg.userId;
        console.log(`[GridSync] Joined as ${this.userId?.slice(0, 8)}`);
        for (const key of [...this.spawnedEntities.keys()]) this.despawnItem(key);
        for (const [key, item] of Object.entries(msg.grid as Record<string, any>)) {
          this.spawnItem(key, item);
        }
        for (const [, av] of this.avatars) this.disposeAvatar(av);
        this.avatars.clear();
        for (const [uid, user] of Object.entries(msg.users as Record<string, any>)) {
          if (uid !== this.userId) this.updateAvatar(uid, user.position);
        }
        break;

      case 'GRID_UPDATE':
        this.despawnItem(msg.key);
        this.spawnItem(msg.key, msg.item);
        break;

      case 'GRID_CLEAR':
        this.despawnItem(msg.key);
        break;

      case 'GRID_CLEAR_ALL':
        for (const key of [...this.spawnedEntities.keys()]) this.despawnItem(key);
        break;

      case 'USER_JOIN':
        if (msg.userId !== this.userId) this.updateAvatar(msg.userId, msg.position);
        break;

      case 'USER_LEAVE': {
        const av = this.avatars.get(msg.userId);
        if (av) { this.disposeAvatar(av); this.avatars.delete(msg.userId); }
        break;
      }

      case 'PLAYER_POSITION':
        if (msg.userId !== this.userId) this.updateAvatar(msg.userId, msg.position);
        break;
    }
  }

  // ── Avatar management ─────────────────────────────────────
  private createAvatar(userId: string): AvatarRecord {
    const color = colorForUser(userId);
    const root = new Object3D();

    // Body — a capsule-like cylinder
    const body = new Mesh(
      new CylinderGeometry(0.15, 0.15, 0.6, 12),
      new MeshBasicMaterial({ color }),
    );
    body.position.y = 0.7;
    root.add(body);

    // Head — sphere
    const head = new Mesh(
      new SphereGeometry(0.2, 16, 16),
      new MeshBasicMaterial({ color }),
    );
    head.position.y = 1.2;
    root.add(head);

    // Emoji face — billboarded sprite above head
    const face = makeEmojiSprite('🧑', 0.5);
    face.position.y = 1.55;
    root.add(face);

    // Facing cone — extends forward from head so you can see where they look
    const cone = new Mesh(
      avatarConeGeom,
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    cone.position.y = 1.2;
    root.add(cone);

    const entity = this.world.createTransformEntity(root);
    return { root, cone, entity };
  }

  private disposeAvatar(av: AvatarRecord) {
    av.root.traverse((obj: any) => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose?.();
        obj.material.dispose?.();
      }
    });
    av.entity.dispose();
  }

  private updateAvatar(
    userId: string,
    pos: { x: number; z: number; heading?: number; pitch?: number },
  ) {
    if (!pos) return;
    let av = this.avatars.get(userId);
    if (!av) {
      av = this.createAvatar(userId);
      this.avatars.set(userId, av);
    }
    av.root.position.x = pos.x;
    av.root.position.z = pos.z;
    if (typeof pos.heading === 'number') {
      av.root.rotation.y = pos.heading;
    }
    if (typeof pos.pitch === 'number') {
      av.cone.rotation.x = -pos.pitch;
    }
  }

  private spawnItem(key: string, item: { type: string; icon: string }) {
    const [row, col] = key.split(',').map(Number);
    const [x, y, z] = gridToWorld(row, col);

    const sprite = makeEmojiSprite(item.icon, 1.1);
    sprite.position.set(x, y, z);

    const entity = this.world.createTransformEntity(sprite);
    this.spawnedEntities.set(key, { entity, sprite });
  }

  private despawnItem(key: string) {
    const record = this.spawnedEntities.get(key);
    if (!record) return;
    const mat = record.sprite.material as SpriteMaterial;
    if (mat.map) mat.map.dispose();
    mat.dispose();
    record.entity.dispose();
    this.spawnedEntities.delete(key);
  }

  update() {
    // Send VR player head position at ~10 Hz
    const now = performance.now();
    if (now - this.lastPosSend < 100) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.player.head.getWorldPosition(this.tempPos);
    this.posMsg.position.x = this.tempPos.x;
    this.posMsg.position.z = this.tempPos.z;
    this.player.head.getWorldDirection(this.tempFwd);
    this.posMsg.position.heading = Math.atan2(-this.tempFwd.x, -this.tempFwd.z);
    this.posMsg.position.pitch = -Math.asin(Math.max(-1, Math.min(1, this.tempFwd.y)));
    this.posMsg.spaceId = this.spaceId;
    this.ws.send(JSON.stringify(this.posMsg));
    this.lastPosSend = now;
  }
}
