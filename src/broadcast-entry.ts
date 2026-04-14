// Broadcast — third-person spectator view of the live game.
//
// Mirrors the VR scene's rendering and AI so a TV/projector setup can
// show the action: walls pop up + flatten with the round, birds soar
// and flap, enemies actually move per their variant rules, the chair
// has a beacon, and an overlay HUD shows the round timer + per-player
// scoreboard.
//
// AI runs locally here — it's deterministic per item (same code as
// portal.ts), so the broadcast view shows believable motion even
// though enemy positions aren't synced from VR clients. That's
// acceptable for a passive spectator stream.

import {
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  ConeGeometry,
  CylinderGeometry,
  BoxGeometry,
  AmbientLight,
  DirectionalLight,
  AdditiveBlending,
  DoubleSide,
  World,
  Vector3,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  LineSegments,
  LineBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Object3D,
} from "@iwsdk/core";
import {
  BIRD_FLIGHT_HEIGHT,
  type ItemRole,
} from "./game-state.js";

// ── Shared constants (mirror portal.ts) ───────────────────────
const WALL_WIDTH  = 0.95;
const WALL_HEIGHT = 2.2;
const WALL_COLOR  = 0x3b82f6;
const WOOD_COLOR  = 0x7a3e12;
const WALL_IDLE_SCALE_Y = 0.02;
const CHAIR_BEACON_HEIGHT = 40;
const CHAIR_BEACON_RADIUS = 0.22;
const CHAIR_BEACON_COLOR  = 0x10b981;

const TYPE_TO_ROLE: Record<string, ItemRole> = {
  sword: 'weapon-sword', gun: 'weapon-gun', poopoodoodoo: 'weapon-poo',
  feather: 'weapon-feather', star: 'goal', fire: 'obstacle-damage',
  robot: 'enemy', ghost: 'enemy', skull: 'enemy', bird: 'bird',
  chair: 'spawn',
};

function gridToWorld(row: number, col: number): [number, number, number] {
  return [col - 9.5, 0.55, row - 4.5];
}

async function init() {
  const container = document.getElementById("scene-container") as HTMLDivElement;

  const world = await World.create(container, {
    xr: { offer: "none" },
    features: { locomotion: false, grabbing: false, physics: false },
  });

  const { scene, camera } = world;
  scene.fog = null;
  // MeshStandardMaterial wants light — broadcast scene has none by
  // default. Add an ambient + sun so walls aren't pitch black.
  scene.add(new AmbientLight(0xffffff, 0.7));
  const sun = new DirectionalLight(0xffffff, 0.8);
  sun.position.set(8, 12, 6);
  scene.add(sun);

  // ── Floor + grid lines ─────────────────────────────────────
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
    return new LineSegments(geo, new LineBasicMaterial({ color: 0x8b8fa8 }));
  }
  const gridLines = makeRectGrid(20, 10, 1);
  gridLines.position.y = 0.002;
  world.createTransformEntity(gridLines);

  const floor = new Mesh(
    new PlaneGeometry(20, 10).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0x3f3f52 }),
  );
  world.createTransformEntity(floor);

  // ── Camera orbit ───────────────────────────────────────────
  let alpha = Math.PI / 2;
  let beta = Math.PI / 3;
  let radius = 18;
  const target = new Vector3(0, 0, 0);
  const updateCamera = () => {
    beta = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, beta));
    camera.position.x = target.x + radius * Math.cos(alpha) * Math.cos(beta);
    camera.position.y = target.y + radius * Math.sin(beta);
    camera.position.z = target.z + radius * Math.sin(alpha) * Math.cos(beta);
    camera.lookAt(target);
  };
  updateCamera();
  let dragging = false; let lastX = 0; let lastY = 0;
  container.addEventListener("mousedown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    alpha -= (e.clientX - lastX) * 0.01;
    beta  += (e.clientY - lastY) * 0.01;
    updateCamera();
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener("mouseup", () => { dragging = false; });
  container.addEventListener("wheel", (e) => {
    radius = Math.max(4, Math.min(40, radius + e.deltaY * 0.02));
    updateCamera();
  }, { passive: true });

  // ── Emoji sprite factory ───────────────────────────────────
  function makeEmojiSprite(emoji: string, size = 1.1): Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '108px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 70);
    const tex = new CanvasTexture(canvas); tex.needsUpdate = true;
    const mat = new SpriteMaterial({ map: tex, transparent: true, depthWrite: true });
    const s = new Sprite(mat);
    s.scale.set(size, size, 1);
    return s;
  }

  // ── Player markers ─────────────────────────────────────────
  type PlayerMarker = {
    entity: ReturnType<typeof world.createTransformEntity>;
    root: Mesh;
    headingPivot: Mesh;
    cone: Mesh;
    materials: MeshBasicMaterial[];
    baseOpacities: number[];
    dead: boolean;
  };
  const USER_COLORS = [0x6366f1, 0xec4899, 0xf59e0b, 0x10b981, 0x3b82f6, 0xef4444, 0xa855f7, 0x14b8a6];
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
    const materials: MeshBasicMaterial[] = [];
    const baseOpacities: number[] = [];
    const tracked = (m: MeshBasicMaterial) => { m.transparent = true; materials.push(m); baseOpacities.push(m.opacity); return m; };

    const root = new Mesh(new SphereGeometry(0.2, 16, 16), tracked(new MeshBasicMaterial({ color })));
    root.position.set(0, 0.2, 0);
    const label = makeEmojiSprite('🧑', 0.8); label.position.y = 0.9; root.add(label);
    const ring = new Mesh(
      new PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
      tracked(new MeshBasicMaterial({ color, opacity: 0.35, depthWrite: false })),
    );
    ring.position.y = -0.19; root.add(ring);
    const headingPivot = new Mesh(new PlaneGeometry(0, 0), new MeshBasicMaterial({ visible: false }));
    root.add(headingPivot);
    const cone = new Mesh(
      sharedConeGeom,
      tracked(new MeshBasicMaterial({ color, opacity: 0.35, depthWrite: false, side: DoubleSide })),
    );
    cone.position.y = 0.9;
    headingPivot.add(cone);
    const entity = world.createTransformEntity(root);
    return { entity, root, headingPivot, cone, materials, baseOpacities, dead: false };
  }
  function setMarkerDead(m: PlayerMarker, dead: boolean) {
    if (m.dead === dead) return;
    m.dead = dead;
    for (let i = 0; i < m.materials.length; i++) {
      m.materials[i].opacity = dead ? m.baseOpacities[i] * 0.3 : m.baseOpacities[i];
    }
  }
  function disposePlayerMarker(m: PlayerMarker) {
    m.root.traverse((obj) => {
      const o = obj as Mesh;
      if (o.geometry && o.geometry !== sharedConeGeom) o.geometry.dispose?.();
      const mat = (o as Mesh).material as MeshBasicMaterial | undefined;
      if (mat) {
        if ((mat as MeshBasicMaterial).map) (mat as MeshBasicMaterial).map?.dispose?.();
        mat.dispose?.();
      }
    });
    m.entity.dispose();
  }
  const players = new Map<string, PlayerMarker>();
  const playerStats = new Map<string, {
    score: number; health: number; goalsCollected: number; goalsTotal: number; dead: boolean;
  }>();

  // ── Item rendering ─────────────────────────────────────────
  // Pure renderer — no AI, no per-item state beyond what's needed to
  // place / dispose / react to round transitions and incoming
  // ITEM_STATES messages from the authoritative VR client.
  type SpawnedItem = {
    object3D: Sprite | Mesh;
    kind: 'sprite' | 'wall';
    role: ItemRole;
    type: string;
    origin: [number, number, number];
    extra?: Mesh; // chair beacon (separately disposed)
  };
  const spawnedItems = new Map<string, SpawnedItem>();

  function spawnItem(key: string, item: { type: string; icon: string; role?: ItemRole }) {
    despawnItem(key);
    const [row, col] = key.split(',').map(Number);
    const [x, y, z] = gridToWorld(row, col);
    const type = item.type ?? 'decor';
    let role: ItemRole = item.role ?? 'decor';
    if (role === 'decor') role = TYPE_TO_ROLE[type] ?? 'decor';

    // 🟦 walls + 🟫 wood blocks
    if (type === 'cube' || type === 'wood') {
      const isWood = type === 'wood';
      const wall = new Mesh(
        new BoxGeometry(WALL_WIDTH, WALL_HEIGHT, WALL_WIDTH),
        new MeshStandardMaterial({
          color: isWood ? WOOD_COLOR : WALL_COLOR,
          roughness: isWood ? 0.95 : 0.7,
          metalness: isWood ? 0 : 0.1,
        }),
      );
      world.createTransformEntity(wall);
      const rec: SpawnedItem = {
        object3D: wall, kind: 'wall', role, type, origin: [x, y, z],
      };
      spawnedItems.set(key, rec);
      setWallState(rec, roundRunning);
      return;
    }

    // Sprites — start at origin (or BIRD_FLIGHT_HEIGHT for birds so
    // they aren't sitting on the floor before the first ITEM_STATES
    // arrives).
    const sprite = makeEmojiSprite(item.icon, 1.1);
    sprite.position.set(x, y, z);
    if (role === 'bird') sprite.position.y = BIRD_FLIGHT_HEIGHT;

    world.createTransformEntity(sprite);

    // 🪑 chairs get a glowing beacon pillar.
    let extra: Mesh | undefined;
    if (role === 'spawn' || type === 'chair') {
      extra = new Mesh(
        new CylinderGeometry(CHAIR_BEACON_RADIUS, CHAIR_BEACON_RADIUS, CHAIR_BEACON_HEIGHT, 20, 1, true),
        new MeshBasicMaterial({
          color: CHAIR_BEACON_COLOR, transparent: true, opacity: 0.35,
          blending: AdditiveBlending, side: DoubleSide, depthWrite: false,
        }),
      );
      extra.position.set(x, CHAIR_BEACON_HEIGHT / 2, z);
      scene.add(extra);
    }

    spawnedItems.set(key, {
      object3D: sprite, kind: 'sprite', role, type, origin: [x, y, z], extra,
    });
  }

  function despawnItem(key: string) {
    const it = spawnedItems.get(key);
    if (!it) return;
    if (it.kind === 'sprite') {
      const m = (it.object3D as Sprite).material as SpriteMaterial;
      if (m.map) m.map.dispose();
      m.dispose();
      it.object3D.parent?.remove(it.object3D);
    } else {
      const mesh = it.object3D as Mesh;
      mesh.geometry.dispose();
      const mt = mesh.material as MeshStandardMaterial;
      mt.dispose?.();
      mesh.parent?.remove(mesh);
    }
    if (it.extra) {
      scene.remove(it.extra);
      it.extra.geometry.dispose();
      (it.extra.material as MeshBasicMaterial).dispose();
    }
    spawnedItems.delete(key);
  }

  function setWallState(it: SpawnedItem, running: boolean) {
    if (it.kind !== 'wall') return;
    const mesh = it.object3D as Mesh;
    if (running) {
      mesh.scale.y = 1;
      mesh.position.set(it.origin[0], WALL_HEIGHT / 2, it.origin[2]);
    } else {
      mesh.scale.y = WALL_IDLE_SCALE_Y;
      mesh.position.set(it.origin[0], (WALL_HEIGHT * WALL_IDLE_SCALE_Y) / 2, it.origin[2]);
    }
  }

  // ── Round state ────────────────────────────────────────────
  // Broadcast is a pure passive renderer — no AI, no random motion.
  // Item positions only update when an authoritative VR client sends
  // ITEM_STATES. Anything else (round timing, scores, walls) comes
  // straight off the existing WebSocket message stream.
  let roundRunning = false;
  let roundEndsAt = 0;
  function setRoundRunning(v: boolean) {
    if (roundRunning === v) return;
    roundRunning = v;
    // Walls flatten / pop based on round state — that's the only
    // animation broadcast applies on its own. Item positions are
    // entirely driven by ITEM_STATES messages.
    for (const it of spawnedItems.values()) {
      if (it.kind === 'wall') setWallState(it, v);
    }
  }

  // No AI on the broadcast — random motion would diverge from VR
  // immediately and the spectator view would lie about positions.
  // Item positions only change when ITEM_STATES arrives over the WS.

  // ── HUD overlay ────────────────────────────────────────────
  const hud = document.getElementById('overlay')!;
  function renderHUD() {
    let timerHtml = '<span style="color:#71717a">— : —</span>';
    if (roundRunning && roundEndsAt > 0) {
      const remaining = Math.max(0, (roundEndsAt - Date.now()) / 1000);
      const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
      const ss = String(Math.floor(remaining % 60)).padStart(2, '0');
      const color = remaining <= 5 ? '#ef4444' : remaining <= 10 ? '#f59e0b' : '#10b981';
      timerHtml = `<span style="color:${color}">${mm}:${ss}</span>`;
    }
    const ranked = [...playerStats.entries()].sort((a, b) => {
      if (a[1].goalsCollected !== b[1].goalsCollected) return b[1].goalsCollected - a[1].goalsCollected;
      return b[1].score - a[1].score;
    });
    const rows = ranked.length === 0
      ? '<div style="color:#71717a;font-size:11px;font-style:italic;margin-top:6px">No VR players yet</div>'
      : ranked.map(([uid, s], i) => {
          const color = '#' + colorForUser(uid).toString(16).padStart(6, '0');
          const short = uid.slice(0, 6);
          const progress = s.goalsTotal > 0 ? `${s.goalsCollected}/${s.goalsTotal}` : String(s.score);
          const hp = Math.ceil(s.health);
          const hpCol = hp <= 25 ? '#ef4444' : hp <= 50 ? '#f59e0b' : '#a1a1aa';
          const dim = s.dead ? 'opacity:0.4;text-decoration:line-through;' : '';
          const rank = i === 0 ? 'color:#fbbf24;font-weight:700;' : 'color:#f4f4f5;';
          return (
            `<div style="display:grid;grid-template-columns:10px 1fr auto auto;gap:8px;align-items:center;padding:3px 0;${dim}">` +
              `<span style="width:10px;height:10px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color};"></span>` +
              `<span style="font-family:ui-monospace,monospace;font-size:11px;${rank}">${short}</span>` +
              `<span style="color:#fbbf24;font-weight:700;font-family:ui-monospace,monospace">⭐ ${progress}</span>` +
              `<span style="color:${hpCol};font-size:10px;font-family:ui-monospace,monospace">❤ ${hp}</span>` +
            `</div>`
          );
        }).join('');
    hud.innerHTML =
      `<div style="font-size:11px;font-weight:bold;color:#6366f1">` +
        `<span style="display:inline-block;width:8px;height:8px;background:#ef4444;border-radius:50%;margin-right:5px;animation:pulse 1s infinite"></span> LIVE BROADCAST` +
      `</div>` +
      `<div style="font-size:10px;color:#a1a1aa;margin-top:4px">Spectator View</div>` +
      `<div style="margin-top:10px;text-align:center;font-family:ui-monospace,monospace;font-size:32px;font-weight:700">${timerHtml}</div>` +
      `<div style="margin-top:10px;border-top:1px solid #3f3f46;padding-top:8px;min-width:200px">${rows}</div>`;
  }

  // ── WebSocket sync ─────────────────────────────────────────
  function connectWS() {
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const url = isLocal ? `ws://${location.hostname}:3001` : `wss://ar-app-ws-production.up.railway.app`;
    console.log(`[Broadcast] Connecting → ${url}`);
    const ws = new WebSocket(url);

    ws.onopen = () => console.log('[Broadcast] Connected');
    ws.onclose = () => { console.log('[Broadcast] Disconnected — retrying in 2s'); setTimeout(connectWS, 2000); };

    ws.onmessage = (e: MessageEvent) => {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.type) {
        case 'WELCOME':
          for (const key of [...spawnedItems.keys()]) despawnItem(key);
          for (const [key, item] of Object.entries(msg.grid as Record<string, any>)) spawnItem(key, item);
          for (const [, m] of players) disposePlayerMarker(m);
          players.clear();
          playerStats.clear();
          for (const [uid, user] of Object.entries(msg.users as Record<string, any>)) {
            updatePlayerMarker(uid, user.position, !!user.dead);
            updatePlayerStats(uid, user);
          }
          if (msg.round && msg.round.endsAt > Date.now()) {
            roundEndsAt = msg.round.endsAt;
            setRoundRunning(true);
          } else {
            roundEndsAt = 0;
            setRoundRunning(false);
          }
          break;
        case 'GRID_UPDATE': spawnItem(msg.key, msg.item); break;
        case 'GRID_SYNC':
          for (const key of [...spawnedItems.keys()]) despawnItem(key);
          for (const [key, item] of Object.entries(msg.grid as Record<string, any>)) spawnItem(key, item);
          break;
        case 'GRID_CLEAR': despawnItem(msg.key); break;
        case 'GRID_CLEAR_ALL': for (const key of [...spawnedItems.keys()]) despawnItem(key); break;
        case 'ITEM_STATES': {
          // Authoritative live positions from a VR client. Each entry:
          //   { key, x, y, z, birdState? }
          type StateEntry = { key: string; x: number; y: number; z: number; birdState?: string };
          for (const i of msg.items as StateEntry[]) {
            const it = spawnedItems.get(i.key);
            if (!it) continue;
            it.object3D.position.set(i.x, i.y, i.z);
            if (i.birdState && it.role === 'bird' && it.kind === 'sprite') {
              const mat = (it.object3D as Sprite).material as SpriteMaterial;
              mat.rotation = i.birdState === 'grounded' ? Math.PI : 0;
            }
          }
          break;
        }
        case 'USER_JOIN': updatePlayerMarker(msg.userId, msg.position, false); break;
        case 'USER_LEAVE': {
          const m = players.get(msg.userId);
          if (m) { disposePlayerMarker(m); players.delete(msg.userId); }
          playerStats.delete(msg.userId);
          break;
        }
        case 'PLAYER_POSITION':
          updatePlayerMarker(msg.userId, msg.position, !!msg.dead);
          updatePlayerStats(msg.userId, msg);
          break;
        case 'ROUND_START':
          roundEndsAt = msg.endsAt;
          setRoundRunning(true);
          // Reset cached scores so the leaderboard doesn't carry over.
          for (const s of playerStats.values()) {
            s.score = 0; s.goalsCollected = 0; s.goalsTotal = 0; s.health = 100; s.dead = false;
          }
          break;
        case 'ROUND_END':
          roundEndsAt = 0;
          setRoundRunning(false);
          break;
      }
    };
  }

  function updatePlayerMarker(
    userId: string,
    pos: { x: number; z: number; heading?: number; pitch?: number },
    dead: boolean,
  ) {
    let m = players.get(userId);
    if (!m) { m = createPlayerMarker(userId); players.set(userId, m); }
    setMarkerDead(m, dead);
    m.root.position.x = pos.x;
    m.root.position.z = pos.z;
    if (typeof pos.heading === 'number') m.headingPivot.rotation.y = pos.heading;
    if (typeof pos.pitch === 'number') m.cone.rotation.x = -pos.pitch;
  }

  function updatePlayerStats(userId: string, s: any) {
    if (s.score == null && s.health == null) return;
    playerStats.set(userId, {
      score: s.score ?? 0,
      health: s.health ?? 100,
      goalsCollected: s.goalsCollected ?? 0,
      goalsTotal: s.goalsTotal ?? 0,
      dead: !!s.dead,
    });
  }

  connectWS();

  // ── HUD loop (5 Hz) ────────────────────────────────────────
  // Only the HUD redraws periodically. Item motion is fully driven
  // by ITEM_STATES messages — no per-frame interpolation here.
  function loop() {
    renderHUD();
    setTimeout(loop, 200);
  }
  loop();

  console.log('Broadcast Mode Initialized');
}

init();
