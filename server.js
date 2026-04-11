// Grid Sync Server — run with: node server.js
// Maintains shared grid state and relays VR player position to all clients.

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { networkInterfaces } from 'os';

const PORT = 3001;

// ── Shared state ────────────────────────────────────────────
const gridState = new Map(); // "r,c" -> {type, icon, label}
let playerPosition = null;   // {x, z} in VR world coords

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
  console.log(`[+] Client connected  (${wss.clients.size} total)`);

  // Send full current state immediately on connect
  ws.send(JSON.stringify({
    type: 'INIT',
    grid: Object.fromEntries(gridState),
    playerPosition,
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
        broadcast({ type: 'GRID_CLEAR_ALL' }, ws);
        break;

      case 'PLAYER_POSITION':
        playerPosition = msg.position;
        broadcast({ type: 'PLAYER_POSITION', position: msg.position }, ws);
        break;
    }
  });

  ws.on('close', () => {
    console.log(`[-] Client disconnected (${wss.clients.size} remaining)`);
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
