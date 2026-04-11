#!/usr/bin/env node
// scripts/sim-user.js — spawn fake VR users that walk motion patterns and
// publish PLAYER_POSITION messages to the grid sync server. Use this to test
// multi-user presence locally without needing multiple Quest headsets.
//
// Usage:
//   node scripts/sim-user.js                         # 1 bot, circle pattern
//   node scripts/sim-user.js --count 3               # 3 bots around a circle
//   node scripts/sim-user.js --pattern figure8       # single figure-8 walker
//   node scripts/sim-user.js --pattern random        # random walker
//   node scripts/sim-user.js --pattern static --pos 3,1
//   node scripts/sim-user.js --name Alice --pattern circle
//
// Flags:
//   --count   N       number of bots spawned in this process (default 1)
//   --pattern X       circle | figure8 | random | static (default circle)
//   --name    X       base display name (suffixed with index when count>1)
//   --host    X       server host (default localhost)
//   --port    N       server port (default 3001)
//   --pos     x,z     static pos for --pattern static (default 0,0)
//   --radius  N       motion radius in meters (default 3)
//   --speed   N       motion speed multiplier (default 1)

import WebSocket from 'ws';

// ── CLI parsing ──────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}

const COUNT   = parseInt(arg('count', '1'), 10);
const PATTERN = arg('pattern', 'circle');
const NAME    = arg('name', 'Bot');
const HOST    = arg('host', 'localhost');
const PORT    = parseInt(arg('port', '3001'), 10);
const RADIUS  = parseFloat(arg('radius', '3'));
const SPEED   = parseFloat(arg('speed', '1'));
const [POSX, POSZ] = arg('pos', '0,0').split(',').map(Number);

const TICK_MS = 100; // 10 Hz to match real VR client

// ── Motion patterns ──────────────────────────────────────────
// Each returns { x, z, heading } given elapsed seconds and bot index.
// Grid bounds: x ∈ [-10, 10], z ∈ [-5, 5]. Patterns stay inside.
const randomStates = [];

const PATTERNS = {
  circle(t, i) {
    const phase = (i * Math.PI * 2) / COUNT;
    const a = t * SPEED * 0.5 + phase;
    return {
      x: Math.cos(a) * RADIUS,
      z: Math.sin(a) * RADIUS,
      // tangent direction (derivative of position)
      heading: Math.atan2(Math.cos(a), -Math.sin(a)),
    };
  },

  figure8(t, i) {
    const phase = (i * Math.PI * 2) / COUNT;
    const a = t * SPEED * 0.6 + phase;
    return {
      x: Math.sin(a) * RADIUS,
      z: Math.sin(a * 2) * (RADIUS / 2),
      heading: Math.atan2(Math.cos(a) * RADIUS, Math.cos(a * 2) * RADIUS),
    };
  },

  random(t, i) {
    let s = randomStates[i];
    if (!s) {
      s = randomStates[i] = {
        x: (Math.random() - 0.5) * RADIUS * 2,
        z: (Math.random() - 0.5) * RADIUS * 2,
        heading: Math.random() * Math.PI * 2,
      };
    }
    s.heading += (Math.random() - 0.5) * 0.3;
    const step = 0.05 * SPEED;
    s.x += Math.sin(s.heading) * step;
    s.z += Math.cos(s.heading) * step;
    if (s.x < -9)  { s.x = -9;  s.heading += Math.PI; }
    if (s.x >  9)  { s.x =  9;  s.heading += Math.PI; }
    if (s.z < -4)  { s.z = -4;  s.heading += Math.PI; }
    if (s.z >  4)  { s.z =  4;  s.heading += Math.PI; }
    return { x: s.x, z: s.z, heading: s.heading };
  },

  static(t, i) {
    return { x: POSX + i * 0.6, z: POSZ, heading: 0 };
  },
};

const motionFn = PATTERNS[PATTERN];
if (!motionFn) {
  console.error(`Unknown pattern "${PATTERN}". Valid: circle | figure8 | random | static`);
  process.exit(1);
}

// ── Bot factory ──────────────────────────────────────────────
function spawnBot(index) {
  const label = COUNT > 1 ? `${NAME}-${index + 1}` : NAME;
  const url = `ws://${HOST}:${PORT}`;
  const ws = new WebSocket(url);
  const t0 = Date.now();
  let ticker = null;

  ws.on('open', () => {
    console.log(`[${label}] connected → ${url}`);
    ticker = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const t = (Date.now() - t0) / 1000;
      const pos = motionFn(t, index);
      ws.send(JSON.stringify({
        type: 'PLAYER_POSITION',
        position: pos,
        spaceId: null,
      }));
    }, TICK_MS);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'WELCOME') {
        console.log(`[${label}] userId ${msg.userId.slice(0, 8)}`);
      }
    } catch {}
  });

  ws.on('close', () => {
    console.log(`[${label}] disconnected`);
    if (ticker) clearInterval(ticker);
  });

  ws.on('error', (err) => {
    console.error(`[${label}] error: ${err.message}`);
  });

  return ws;
}

// ── Spawn + clean shutdown ───────────────────────────────────
console.log(`Spawning ${COUNT} bot(s) · pattern=${PATTERN} · radius=${RADIUS} · speed=${SPEED}`);
const bots = Array.from({ length: COUNT }, (_, i) => spawnBot(i));

function shutdown() {
  console.log('\nShutting down bots…');
  for (const ws of bots) {
    try { ws.close(); } catch {}
  }
  setTimeout(() => process.exit(0), 200);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
