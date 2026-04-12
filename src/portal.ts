import {
  createSystem,
  Vector3,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
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

// ── System ───────────────────────────────────────────────────
export class PortalSystem extends createSystem({}) {
  private ws: WebSocket | null = null;
  private spawnedEntities = new Map<
    string,
    { entity: { dispose(): void }; sprite: Sprite }
  >();
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
    position: { x: number; z: number; heading: number };
    spaceId: string | null;
  } = { type: 'PLAYER_POSITION', position: { x: 0, z: 0, heading: 0 }, spaceId: null };

  init() {
    this.tempPos = new Vector3();
    this.tempFwd = new Vector3();
    this.connectWS();
  }

  private connectWS() {
    const url = `ws://${window.location.hostname}:3001`;
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
        for (const key of [...this.spawnedEntities.keys()]) {
          this.despawnItem(key);
        }
        for (const [key, item] of Object.entries(msg.grid as Record<string, any>)) {
          this.spawnItem(key, item);
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
        for (const key of [...this.spawnedEntities.keys()]) {
          this.despawnItem(key);
        }
        break;
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
    this.posMsg.spaceId = this.spaceId;
    this.ws.send(JSON.stringify(this.posMsg));
    this.lastPosSend = now;
  }
}
