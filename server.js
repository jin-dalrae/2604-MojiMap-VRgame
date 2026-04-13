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

// ── Shared state ────────────────────────────────────────────
const gridState = new Map(); // "r,c" -> { type, icon, label }
const users = new Map();     // userId -> { position: {x, z, heading}, spaceId }

// ── Server setup ─────────────────────────────────────────────
const server = createServer();
const wss = new WebSocketServer({ server });

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

  // Initial state dump: grid + everyone currently present.
  ws.send(JSON.stringify({
    type: 'WELCOME',
    userId,
    grid: Object.fromEntries(gridState),
    users: Object.fromEntries(users),
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

      case 'PLAYER_POSITION': {
        const record = {
          position: msg.position,
          spaceId: msg.spaceId ?? null,
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
