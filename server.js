// Grid Sync Server — run with: node server.js
// Maintains shared grid state and relays per-user VR presence.
//
// Multi-user model:
//   - Every WebSocket connection is assigned a stable userId on connect.
//   - A client becomes "present" the first time it publishes a PLAYER_POSITION
//     (VR clients opt in; passive viewers/planners don't count as present).
//   - Presence is broadcast as USER_JOIN / USER_LEAVE / PLAYER_POSITION.
//
// Quest Shared Spaces readiness:
//   - Meta Quest Browser v39+ exposes an experimental WebXR "shared" feature
//     that produces an XRSharedReferenceSpace with a UUID. Two Quest headsets
//     in the same physical room can request the same shared origin.
//   - When a Quest client has that UUID, it passes it as `spaceId` on its
//     position messages. The server forwards it verbatim so other clients can
//     group users by physical room. No coord transforms happen here — the
//     Quest runtime handles colocation; we just relay per-user telemetry.

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { networkInterfaces } from 'os';
import { randomUUID } from 'crypto';

const PORT = process.env.PORT || 3001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Admin password required for destructive actions (currently just
// GRID_CLEAR_ALL). Defaults to "admin" for local dev; set ADMIN_PWD in
// the deployment env to use a real secret. Without this gate, anyone
// with the URL could wipe the board mid-round.
const ADMIN_PWD = process.env.ADMIN_PWD || 'admin';

// ── Shared state ────────────────────────────────────────────
const gridState = new Map(); // "r,c" -> { type, icon, label, role }
const users = new Map();     // userId -> { position: {x, z, heading}, spaceId }

// ── Default grid seed ───────────────────────────────────────
// Every process boot (== every deploy) starts with a fresh randomized
// 8×8 layout so the designer never walks into an empty grid. Exactly
// one chair 🪑 is placed, and GRID_PLACE enforces the same rule at
// runtime — you can't spawn a second one.
const GRID_COLS = 8;
const GRID_ROWS = 8;
const ITEM_CATALOG = {
  chair:        { icon: '🪑', label: 'Start Pt', role: 'spawn' },
  star:         { icon: '⭐', label: 'Star',     role: 'goal' },
  banana:       { icon: '🍌', label: 'Banana',   role: 'powerup' },
  mushroom:     { icon: '🍄', label: 'Mushroom', role: 'mushroom' },
  sword:        { icon: '🗡️', label: 'Sword',    role: 'weapon-sword' },
  hammer:       { icon: '🔨', label: 'Hammer',   role: 'weapon-sword' },
  gun:          { icon: '🔫', label: 'Squirt',   role: 'weapon-gun' },
  poopoodoodoo: { icon: '💩', label: 'Poo',      role: 'weapon-poo' },
  feather:      { icon: '🪶', label: 'Feather',  role: 'weapon-feather' },
  fire:         { icon: '🔥', label: 'Fire',     role: 'obstacle-damage' },
  robot:        { icon: '🤖', label: 'Robot',    role: 'enemy' },
  ghost:        { icon: '👻', label: 'Ghost',    role: 'enemy' },
  skull:        { icon: '💀', label: 'Skull',    role: 'enemy' },
  snowman:      { icon: '⛄', label: 'Snowman',  role: 'enemy' },
  bird:         { icon: '🦅', label: 'Eagle',    role: 'bird' },
  cube:         { icon: '🟦', label: 'Wall',     role: 'decor' },
  wood:         { icon: '🟫', label: 'Wood',     role: 'decor' },
};
// Counts sum to 64 — a completely full board.
const DEFAULT_DISTRIBUTION = [
  ['chair',        1],
  ['star',        10],
  ['banana',       3],
  ['mushroom',     3],
  ['sword',        1],
  ['hammer',       1],
  ['gun',          1],
  ['poopoodoodoo', 1],
  ['feather',      2],
  ['fire',         5],
  ['robot',        3],
  ['ghost',        2],
  ['skull',        2],
  ['snowman',      2],
  ['bird',         4],
  ['cube',        15],
  ['wood',         8],
];

function seedRandomGrid() {
  gridState.clear();
  const keys = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) keys.push(`${r},${c}`);
  }
  // Fisher-Yates shuffle.
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  let idx = 0;
  for (const [type, count] of DEFAULT_DISTRIBUTION) {
    const catalogEntry = ITEM_CATALOG[type];
    for (let i = 0; i < count; i++) {
      if (idx >= keys.length) break;
      gridState.set(keys[idx++], { type, ...catalogEntry });
    }
  }
  console.log(`[grid] seeded ${gridState.size} items (1 chair, random layout)`);
}

seedRandomGrid();

function hasChairElsewhere(excludeKey) {
  for (const [k, item] of gridState) {
    if (k === excludeKey) continue;
    if (item && item.type === 'chair') return k;
  }
  return null;
}

// Portal sliders — live on the server so every connecting client
// (VR + broadcast) adopts the same scales on WELCOME. Clamped to the
// same ranges the portal UI allows.
//   gridScale  — playable stage footprint
//   emojiScale — every sprite + hitbox
let gridScale = 1.0;  // 1m per cell — 8×8 = 8m × 8m playable area
let emojiScale = 1.0;
const GRID_SCALE_MIN = 0.4;
const GRID_SCALE_MAX = 2.0;
const EMOJI_SCALE_MIN = 0.4;
const EMOJI_SCALE_MAX = 2.0;

// Round state. endsAt === 0 means no round in progress.
// `pending` = portal has requested a round, waiting for a VR player to
// confirm readiness at the chair. Actual timer doesn't start until then.
// `snapshot` is a deep copy of gridState at ROUND_START — items the VR
// clients clear during the round are restored at ROUND_END so the
// designer's layout is authoritative across rounds.
const round = {
  endsAt: 0,
  duration: 0,
  timeout: null,
  snapshot: null,
  pending: false,
  pendingDuration: 0,
};

function cancelPending() {
  if (!round.pending) return;
  round.pending = false;
  round.pendingDuration = 0;
  broadcast({ type: 'ROUND_CANCEL' });
  console.log('[⏱] Round request cancelled');
}

function endRound(reason) {
  if (!round.endsAt) return;
  if (round.timeout) { clearTimeout(round.timeout); round.timeout = null; }
  round.endsAt = 0;
  round.duration = 0;
  // Restore the pre-round layout + push a full resync so every client
  // re-renders from the same authoritative snapshot.
  if (round.snapshot) {
    gridState.clear();
    for (const [k, v] of round.snapshot) gridState.set(k, v);
    round.snapshot = null;
  }
  console.log(`[⏱] Round ended (${reason})`);
  broadcast({ type: 'ROUND_END', reason });
  broadcast({ type: 'GRID_SYNC', grid: Object.fromEntries(gridState) });
}

function startRound(duration) {
  // Clamp to the same range the portal UI allows.
  const d = Math.max(5, Math.min(600, Math.round(duration)));
  if (round.timeout) clearTimeout(round.timeout);
  round.duration = d;
  round.endsAt = Date.now() + d * 1000;
  // Snapshot the layout so the designer's grid survives the round even
  // though individual clients GRID_CLEAR items as they pick them up.
  round.snapshot = new Map();
  for (const [k, v] of gridState) round.snapshot.set(k, { ...v });
  // Wipe cached player stats so the leaderboard doesn't show last round's
  // scores until a client sends its first PLAYER_POSITION. Actual truth
  // lives on the VR clients — this just normalizes initial display.
  for (const u of users.values()) {
    u.score = 0;
    u.health = 100;
    u.goalsCollected = 0;
    u.goalsTotal = 0;
    u.dead = false;
  }
  console.log(`[⏱] Round started (${d}s, snapshot=${round.snapshot.size} items)`);
  broadcast({ type: 'ROUND_START', duration: d, endsAt: round.endsAt });
  // Server is authoritative: auto-broadcast ROUND_END when the timer fires.
  round.timeout = setTimeout(() => endRound('timeout'), d * 1000);
}

// ── Server setup ─────────────────────────────────────────────
const server = createServer();
const wss = new WebSocketServer({ server });

// HTTP routes — currently only used to mint ephemeral tokens for the
// browser to open a Realtime API session. CORS is wide-open since the
// only sensitive thing this endpoint can do is consume the (minimal,
// rate-limited) Realtime quota; it never echoes the OPENAI_API_KEY.
server.on('request', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/api/realtime-token' && req.method === 'POST') {
    if (!OPENAI_API_KEY) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'OPENAI_API_KEY not set on server' }));
      return;
    }
    try {
      // Transcription-only session — cheapest realtime path. The GA
      // Realtime API nests transcription/VAD config under audio.input,
      // not at the top level (the older beta shape was different).
      const sessionConfig = {
        session: {
          type: 'transcription',
          audio: {
            input: {
              transcription: { model: 'gpt-4o-mini-transcribe' },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 200,
                silence_duration_ms: 250,
              },
            },
          },
        },
      };
      const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sessionConfig),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(text);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }

  if (req.url === '/api/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, hasOpenAIKey: !!OPENAI_API_KEY }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

function broadcast(msg, exclude = null) {
  const str = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client !== exclude && client.readyState === 1 /* OPEN */) {
      client.send(str);
    }
  }
}

wss.on('connection', (ws) => {
  const userId = randomUUID();
  ws.userId = userId;
  ws.isPresent = false;
  // role: 'vr' | 'portal' | 'mobile' | 'broadcast' | 'unknown'.
  // Only 'vr' connections can ever be promoted into the users map (and
  // therefore appear as avatars/leaderboard entries). Set by a HELLO
  // message the client sends on open.
  ws.role = 'unknown';

  const short = userId.slice(0, 8);
  console.log(`[+] Client connected ${short} (${wss.clients.size} total)`);

  // Initial state dump: grid + presence + any in-progress round.
  // `round.endsAt` is absolute ms epoch so new clients sync their countdown
  // to the same wall-clock moment other clients are already watching.
  ws.send(JSON.stringify({
    type: 'WELCOME',
    userId,
    grid: Object.fromEntries(gridState),
    users: Object.fromEntries(users),
    round: round.endsAt
      ? { endsAt: round.endsAt, duration: round.duration }
      : null,
    pendingRound: round.pending ? { duration: round.pendingDuration } : null,
    gridScale,
    emojiScale,
  }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'HELLO': {
        // Client declares what kind of page it is. Locks so a portal/mobile
        // page can never accidentally register as a user even if it sends
        // PLAYER_POSITION (e.g. during testing or a client-side bug).
        const r = msg.role;
        if (r === 'vr' || r === 'portal' || r === 'mobile' || r === 'broadcast') {
          ws.role = r;
          console.log(`[role] ${short} → ${r}`);
        }
        break;
      }

      case 'GRID_PLACE': {
        // Single-chair rule — server-side guard so portal/mobile/VR
        // can't accidentally create a second 🪑. Sender gets a
        // PLACE_REJECTED reply so they can clear the existing chair
        // first if they want to move it.
        if (msg.item && msg.item.type === 'chair') {
          const existing = hasChairElsewhere(msg.key);
          if (existing) {
            console.log(`[chair] rejected from ${short} — already at ${existing}`);
            ws.send(JSON.stringify({
              type: 'PLACE_REJECTED',
              key: msg.key,
              reason: 'chair-exists',
              existingKey: existing,
            }));
            break;
          }
        }
        gridState.set(msg.key, msg.item);
        broadcast({ type: 'GRID_UPDATE', key: msg.key, item: msg.item }, ws);
        break;
      }

      case 'GRID_CLEAR':
        gridState.delete(msg.key);
        broadcast({ type: 'GRID_CLEAR', key: msg.key }, ws);
        break;

      case 'GRID_CLEAR_ALL':
        // Admin-only. Client sends the password entered via prompt();
        // we only clear + broadcast if it matches.
        if (msg.pwd !== ADMIN_PWD) {
          console.log(`[admin] GRID_CLEAR_ALL rejected from ${short} (bad pwd)`);
          ws.send(JSON.stringify({ type: 'ADMIN_ERROR', reason: 'bad-password' }));
          break;
        }
        console.log(`[admin] GRID_CLEAR_ALL accepted from ${short}`);
        gridState.clear();
        broadcast({ type: 'GRID_CLEAR_ALL' });
        break;

      case 'ITEM_STATES':
        // Authoritative live positions of dynamic items (enemies + birds)
        // from a VR client. Server just relays — too transient to store
        // and not part of the persistent grid layout.
        broadcast({ type: 'ITEM_STATES', items: msg.items }, ws);
        break;

      case 'SET_GRID_SCALE': {
        // Portal slider. Clamp + store + broadcast to every client
        // (including sender so the slider snaps to the clamped value).
        const s = Number(msg.scale);
        if (!Number.isFinite(s)) break;
        gridScale = Math.max(GRID_SCALE_MIN, Math.min(GRID_SCALE_MAX, s));
        console.log(`[grid] scale set to ${gridScale.toFixed(2)}`);
        broadcast({ type: 'SET_GRID_SCALE', scale: gridScale });
        break;
      }

      case 'SET_EMOJI_SCALE': {
        const s = Number(msg.scale);
        if (!Number.isFinite(s)) break;
        emojiScale = Math.max(EMOJI_SCALE_MIN, Math.min(EMOJI_SCALE_MAX, s));
        console.log(`[emoji] scale set to ${emojiScale.toFixed(2)}`);
        broadcast({ type: 'SET_EMOJI_SCALE', scale: emojiScale });
        break;
      }

      case 'ROUND_START':
        // Legacy — straight-to-start path (kept for any client that
        // hasn't migrated to the pending flow).
        startRound(msg.duration);
        break;

      case 'ROUND_REQUEST': {
        // Portal asked to start; enter pending state. VR players must
        // walk to the chair + press SELECT to confirm → actual start.
        if (round.endsAt || round.pending) break;
        const d = Math.max(5, Math.min(600, Math.round(msg.duration || 30)));
        round.pending = true;
        round.pendingDuration = d;
        console.log(`[⏱] Round requested (${d}s) — waiting for VR ready`);
        broadcast({ type: 'ROUND_PENDING', duration: d });
        // If there are no VR players at all, auto-start so the portal
        // operator can still run solo tests.
        let vrPlayers = 0;
        for (const u of users.values()) vrPlayers++;
        if (vrPlayers === 0) {
          console.log('[⏱] No VR players connected — auto-starting');
          round.pending = false;
          startRound(d);
        }
        break;
      }

      case 'ROUND_READY':
        // First VR player to confirm kicks off the actual round.
        if (round.pending) {
          const d = round.pendingDuration;
          round.pending = false;
          round.pendingDuration = 0;
          startRound(d);
        }
        break;

      case 'ROUND_CANCEL':
        cancelPending();
        break;

      case 'ROUND_END':
        endRound(msg.reason || 'host-stopped');
        break;

      case 'PLAYER_POSITION': {
        // Only VR clients (the `/` page) can become user characters.
        // Portal/mobile/broadcast sockets are silently ignored here even
        // if they somehow send a position packet — keeps the users map
        // clean regardless of client-side bugs.
        if (ws.role !== 'vr') break;
        // Stats ride along with each position packet so observers can
        // render a live leaderboard without a separate message type.
        const record = {
          position: msg.position,
          spaceId: msg.spaceId ?? null,
          score: msg.score ?? 0,
          health: msg.health ?? 100,
          goalsCollected: msg.goalsCollected ?? 0,
          goalsTotal: msg.goalsTotal ?? 0,
          dead: !!msg.dead,
        };
        const firstTime = !ws.isPresent;
        ws.isPresent = true;
        users.set(userId, record);

        if (firstTime) {
          console.log(`[★] ${short} joined as VR user (${users.size} present)`);
          broadcast({
            type: 'USER_JOIN',
            userId,
            position: record.position,
            spaceId: record.spaceId,
          }, ws);
        }

        broadcast({
          type: 'PLAYER_POSITION',
          userId,
          position: record.position,
          spaceId: record.spaceId,
          score: record.score,
          health: record.health,
          goalsCollected: record.goalsCollected,
          goalsTotal: record.goalsTotal,
          dead: record.dead,
        }, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log(`[-] Client disconnected ${short} (${wss.clients.size - 1} remaining)`);
    if (ws.isPresent) {
      users.delete(userId);
      broadcast({ type: 'USER_LEAVE', userId });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔌 Grid Sync Server`);
  console.log(`   Local:   ws://localhost:${PORT}`);
  const nets = networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const iface of (ifaces ?? [])) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`   Network: ws://${iface.address}:${PORT}`);
      }
    }
  }
  console.log(`\n   Phones + Quest connect to the Network address above.\n`);
});
