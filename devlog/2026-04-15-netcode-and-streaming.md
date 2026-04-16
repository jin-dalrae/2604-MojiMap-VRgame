# Netcode + Headset Video Streaming — Future Work

Captured 2026-04-15 during the broadcast-view refactor. Two unresolved
problems with options sketched out, so we can pick them up later
without re-deriving the whole tradeoff space.

---

## 1. Multiplayer Sync (the "Call of Duty Mobile" question)

### Today's architecture

Each VR client runs `tickEnemyAI` locally at frame rate. When a
GRID_SYNC arrives, every client calls `spawnItem()` and seeds enemy
state with its **own** `Math.random()` — heading, radius, omega, phase
all differ per client. VR clients ignore inbound `ITEM_STATES`.

Consequences:

- Player A's skull is at one spot, Player B's skull is at another.
- Robots wander different paths on each headset.
- Eagles fly different arcs.
- Hits/kills resolve locally — A killing a ghost doesn't despawn it on
  B's screen.
- Spectator broadcast renders whichever VR client most recently sent
  `ITEM_STATES` (last-writer-wins per item key, currently 10Hz).

This is fine for solo play but breaks the moment we have >1 VR player
in the same room.

### Reference tickrates from real games

| Game                       | Tickrate     |
| -------------------------- | ------------ |
| CoD Mobile                 | ~20 Hz       |
| CoD MW / Warzone (PC/PS5)  | ~22 Hz       |
| Apex Legends               | 20 Hz        |
| Fortnite                   | 30 Hz        |
| Overwatch 2                | 63 Hz        |
| Valorant                   | 128 Hz       |
| CS2                        | subtick (~64) |

Mobile shooters get away with 20 Hz by hiding it behind:

- **Client-side prediction** — your input renders locally now, server
  reconciles later.
- **Entity interpolation** — remote entities render ~100ms in the past,
  smoothly lerped between snapshots so 20 Hz looks 60fps-smooth.
- **Lag compensation (rewind)** — server rewinds world to the client's
  shot timestamp when validating hits.
- **Snapshot delta compression** — only changed fields per entity.

### Three options for our setup

1. **Server-authoritative AI** — move `tickEnemyAI` into `server.js`,
   broadcast positions at 20 Hz to all clients (VR included). Clients
   become renderers. Removes desync entirely.
2. **Host-elects** — first VR client to join is the host, runs AI +
   broadcasts `ITEM_STATES`. Others apply (drop the spectator-only
   gate). Needs host-migration on disconnect.
3. **Deterministic seed** — server picks a seed at `ROUND_START`, all
   clients use a seeded RNG (replace every `Math.random()`). AI stays
   client-side but identical. Cheapest fix; only works if AI has zero
   player-input branches — robot aggro + skull retarget make this
   hard. Not viable as-is.

**Recommendation:** Option 1. It's the path every real multiplayer
shooter takes and it lets us bolt on lag comp later when we need it.

### Implementation plan (when we do it)

Phased so each step is shippable on its own.

1. **Bump current broadcast tick to 20 Hz** — 1 line in
   `src/portal.ts` `tickItemStateBroadcast` (`100` → `50` ms). Free.
2. **Receiver interpolation** — buffer last 2 snapshots per item key,
   render at `now - 100ms`, lerp position between them. Replace the
   direct `position.set()` in the `ITEM_STATES` handler. ~1-2 hours.
   Turns 20 Hz into visually-60-Hz on the receiver.
3. **Server-authoritative enemy AI** — port `tickEnemyAI` and the
   enemy-side of `tickSwordContact` into `server.js`. Server already
   has: grid layout, player positions (`PLAYER_POSITION`), round
   state. Broadcast enemy snapshots at 20 Hz to **all** clients (VR
   too). Hit detection becomes server-side: client sends "I swung
   sword at time T from grip P", server validates. Delete
   `tickItemStateBroadcast` — server is the single source. ~4-6
   hours.
4. **Lag compensation** — server keeps last ~500ms of enemy positions,
   rewinds when validating hits so a player's shot resolves against
   what they actually saw on screen. ~3-4 hours plus tuning. Defer
   until players actually complain about ghost hits.

### Snappiness expectations after the rewrite

What stays instant (local):

- Your own movement (locomotor is local).
- Sword swing animation, projectile spawn, bomb throw arc, jump.
- Hit FX (flash + sound on the swing — fire-and-forget locally).
- Voice triggers, weapon equip, HUD updates.

What becomes slightly delayed (~50-150 ms):

- Enemy positions render 100ms behind server truth (interp buffer).
- Kill confirmation: enemy doesn't despawn until the server validates
  the hit. Localhost: ~10ms (invisible). LAN: ~30ms. WAN: 50-150ms.
- Enemy reactions to you (robot starts chasing) — visible lag.

Mitigation knobs if it feels bad:

- Drop interp buffer to 50 ms (snappier, more jitter risk on packet
  loss).
- Extrapolate remote entities forward from last snapshot (predict
  ~50 ms ahead — hides RTT but risks overshoot when AI changes
  direction).
- Bump tickrate to 30 Hz — server CPU is trivial here.

For solo play this is marginally less snappy than today (today is
zero-latency because there's no network in the loop). The cost buys a
coherent shared world, which is the whole point.

---

## 2. Streaming Headset Video to the Broadcast URL

Goal: spectators on `broadcast.html` see what the VR player actually
sees, not just our 3D reconstruction.

### Options surveyed

| Option | UX | Hosted? | Cost | Why we'd pick it |
| --- | --- | --- | --- | --- |
| **A. P2P WebRTC + getDisplayMedia + free Google STUN** | One Quest tap. Spectator URL auto-receives. | ✅ via existing Railway WS for signaling | $0 | Cheapest, fastest to ship, ~80% network success without TURN. |
| **B. Canvas captureStream + WebRTC** | Zero taps if it works. | ✅ | $0 | No permission popup, but in WebXR the WebGL canvas may render to the XR compositor swapchain, not the canvas — captured frames could be blank during immersive sessions. Needs Quest testing first. |
| **C. Cloudflare Realtime / LiveKit Cloud (SFU)** | Same one tap. | ✅ | Free tier (LiveKit: 50 conns + 50GB/mo) | Worth it only when we need >5 simultaneous spectators. Free tier covers a hobby project. |
| **D. RTMP → Twitch/YouTube embed** | One tap, free hosting | ✅ | $0 | Quest Browser can't push RTMP without a WebRTC↔RTMP gateway service. More moving parts than P2P. |
| **E. Cloudflare Stream Live / Mux** | Easy | ✅ | ~$1-5 / 1000 min | Pay for managed pipeline. Overkill. |
| **F. getDisplayMedia → MediaRecorder → WS chunks → MediaSource** | Auto, no WebRTC | ✅ | $0 | 1-3 second latency, choppy seek behavior, no real upside over A. |
| **G. Native Quest screencast → OBS** | Bad — spectator URL becomes "open OBS" | n/a | n/a | Defeats the purpose. |

### Recommendation

**Option A**: P2P WebRTC + `getDisplayMedia()` + Google STUN, signaling
piggybacked on the existing Railway WebSocket server.

Why it wins for our case:

- **UX** — single "📡 Broadcast" button on the VR HUD. Tap → permission
  popup → live. Spectator URL auto-receives, no friction.
- **Hosted** — works. Railway WS already handles every other realtime
  message; adding `WEBRTC_OFFER` / `WEBRTC_ANSWER` / `WEBRTC_ICE`
  relay is trivial.
- **Cheap** — $0 forever. Free Google STUN handles NAT traversal for
  ~80% of network combos. Add Cloudflare TURN (free up to 1TB/mo) only
  if we hit the 20% case.
- **Latency** — 100-200 ms. Better than HLS/Twitch (3-15 s).

### Implementation sketch

Roughly 150 LOC total, ~2-4 hours.

1. **VR HUD button** — small "📡 Broadcast" button. Tap calls
   `navigator.mediaDevices.getDisplayMedia()` (Quest prompts for
   mirror permission once per session; autoplay/auto-capture is
   blocked).
2. **WebRTC peer** — VR client opens `RTCPeerConnection`, attaches
   the captured `MediaStream`, creates an offer.
3. **Signaling over WS** — extend `server.js` with three relay-only
   message types:
   - `WEBRTC_OFFER` (broadcaster → server → all subscribers)
   - `WEBRTC_ANSWER` (subscriber → server → broadcaster)
   - `WEBRTC_ICE` (both ways)
   Server doesn't inspect SDP, just forwards.
4. **broadcast.html consumer** — opens `RTCPeerConnection`,
   `ontrack` → attach to a `<video>` element. Render as PiP overlay
   on top of the existing orbit-camera 3D view (or full-screen with
   the orbit view as the small inset).

### Caveats worth knowing before committing

- **Mirror view, not stereo** — Quest's `getDisplayMedia` captures the
  flat browser mirror. When in immersive XR, that mirror is typically
  the right-eye render. Looks fine, but no stereo.
- **Single broadcaster, multiple viewers** — pure P2P does one peer
  connection per viewer. Quest uploads ~3 Mbps × N viewers. Fine up to
  ~3, choky beyond. Move to SFU (Option C) when we hit that.
- **TURN fallback** — if 20% network failures become annoying, add
  Cloudflare TURN credentials. ~5-line config change, no infra.
- **Audio** — `getDisplayMedia` doesn't include system audio on Quest.
  If we want voice, add a separate mic track on the same peer
  connection.

---

## Decision summary

When we come back to this:

- **Multiplayer sync** → Option 1 (server-authoritative AI), in 4
  phases. Start with the 20 Hz tick bump + receiver interpolation;
  those are cheap and buy visible smoothness without blocking the
  bigger refactor.
- **Headset video streaming** → Option A (P2P WebRTC + getDisplayMedia
  + Google STUN, signaling on existing Railway WS). Pull in
  Cloudflare TURN only when networks force it.
