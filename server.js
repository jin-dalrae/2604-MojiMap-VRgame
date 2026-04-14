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

// ── Shared state ────────────────────────────────────────────
const gridState = new Map(); // "r,c" -> { type, icon, label, role }
const users = new Map();     // userId -> { position: {x, z, heading}, spaceId }

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
      // Transcription-only session: cheapest realtime path. We don't
      // want speech-to-speech, just keyword spotting.
      const sessionConfig = {
        session: {
          type: 'transcription',
          input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
          // VAD trims silence so we get faster, more accurate transcripts.
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 200,
            silence_duration_ms: 250,
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
  }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'GRID_PLACE':
        gridState.set(msg.key, msg.item);
        broadcast({ type: 'GRID_UPDATE', key: msg.key, item: msg.item }, ws);
        break;

      case 'GRID_CLEAR':
        gridState.delete(msg.key);
        broadcast({ type: 'GRID_CLEAR', key: msg.key }, ws);
        break;

      case 'GRID_CLEAR_ALL':
        gridState.clear();
        broadcast({ type: 'GRID_CLEAR_ALL' });
        break;

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
