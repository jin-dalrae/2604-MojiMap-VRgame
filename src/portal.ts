import {
  createSystem,
  Vector3,
  Mesh,
  MeshStandardMaterial,
  BoxGeometry,
  SphereGeometry,
  CylinderGeometry,
  TorusGeometry,
  Color,
} from "@iwsdk/core";

// ── Grid coordinate mapping ──────────────────────────────────
// Portal grid: 20 cols × 10 rows
// Cell (row r, col c) center → world: x = c - 9.5, y = 0.4, z = r - 4.5
function gridToWorld(row: number, col: number): [number, number, number] {
  return [col - 9.5, 0.4, row - 4.5];
}

// ── Mesh factory ─────────────────────────────────────────────
const ITEM_CONFIGS: Record<string, { geo: () => any; color: number }> = {
  cube:     { geo: () => new BoxGeometry(0.55, 0.55, 0.55),          color: 0x6366f1 },
  sphere:   { geo: () => new SphereGeometry(0.32, 16, 16),           color: 0x3b82f6 },
  cylinder: { geo: () => new CylinderGeometry(0.2, 0.2, 0.55, 16),  color: 0x92400e },
  chair:    { geo: () => new BoxGeometry(0.35, 0.45, 0.35),          color: 0x78350f },
  table:    { geo: () => new BoxGeometry(0.65, 0.07, 0.45),          color: 0xa16207 },
  lamp:     { geo: () => new SphereGeometry(0.18, 12, 12),           color: 0xfbbf24 },
  plant:    { geo: () => new CylinderGeometry(0.12, 0.18, 0.45, 12), color: 0x16a34a },
  screen:   { geo: () => new BoxGeometry(0.65, 0.38, 0.05),          color: 0x312e81 },
  fire:     { geo: () => new SphereGeometry(0.22, 10, 10),           color: 0xef4444 },
  portal:   { geo: () => new TorusGeometry(0.32, 0.06, 12, 32),      color: 0x8b5cf6 },
  star:     { geo: () => new SphereGeometry(0.28, 12, 12),           color: 0xfbbf24 },
  music:    { geo: () => new SphereGeometry(0.18, 10, 10),           color: 0xec4899 },
  robot:    { geo: () => new BoxGeometry(0.28, 0.48, 0.22),          color: 0x6366f1 },
};

function buildMesh(type: string): Mesh {
  const cfg = ITEM_CONFIGS[type] ?? ITEM_CONFIGS.cube;
  const mat = new MeshStandardMaterial({
    color: new Color(cfg.color),
    roughness: 0.4,
    metalness: 0.2,
    emissive: new Color(cfg.color),
    emissiveIntensity: 0.15,
  });
  return new Mesh(cfg.geo(), mat);
}

// ── System ───────────────────────────────────────────────────
export class PortalSystem extends createSystem({}) {
  private ws: WebSocket | null = null;
  private spawnedEntities = new Map<string, ReturnType<typeof this.world.createTransformEntity>>();
  private lastPosSend = 0;
  private tempPos!: Vector3;
  // Pre-allocated to avoid update() allocations
  private posMsg = { type: 'PLAYER_POSITION', position: { x: 0, z: 0 } };

  init() {
    this.tempPos = new Vector3();
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
      case 'INIT':
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

  private spawnItem(key: string, item: { type: string }) {
    const [row, col] = key.split(',').map(Number);
    const [x, y, z] = gridToWorld(row, col);

    const mesh = buildMesh(item.type);
    mesh.position.set(x, y, z);

    const entity = this.world.createTransformEntity(mesh);
    this.spawnedEntities.set(key, entity);
  }

  private despawnItem(key: string) {
    const entity = this.spawnedEntities.get(key);
    if (entity) {
      entity.dispose();
      this.spawnedEntities.delete(key);
    }
  }

  update() {
    // Send VR player head position at ~10 Hz
    const now = performance.now();
    if (now - this.lastPosSend < 100) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.player.head.getWorldPosition(this.tempPos);
    this.posMsg.position.x = this.tempPos.x;
    this.posMsg.position.z = this.tempPos.z;
    this.ws.send(JSON.stringify(this.posMsg));
    this.lastPosSend = now;
  }
}
