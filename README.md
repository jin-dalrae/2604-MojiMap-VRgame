# 🌌 MojiMap — an AR emoji arena

An asymmetric, multi-screen WebXR party game built with the **Immersive Web SDK (IWSDK)**. One VR player steps into a Meta Quest headset, a designer drags emojis onto a grid from a laptop, phones join as attackers, and a broadcast view streams the whole thing to a crowd. Physical walking is the only locomotion — the map is sized to fit inside a room-scale Quest guardian.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![WebXR](https://img.shields.io/badge/WebXR-Quest%203-brightgreen.svg)

---

## 🎮 The five screens

| Screen                   | URL              | Who uses it                                                                                                 |
| ------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| **VR player**            | `/`              | Contestant in the Quest. Walks around, collects ⭐, fights enemies, dodges hazards.                          |
| **Portal (designer)**    | `/portal`        | Host on a laptop. Drags emojis onto an 8×8 grid, tunes sliders, starts/ends rounds, clears the board.       |
| **Portal Mobile**        | `/portal-mobile` | Spectators on phones. Tap an emoji to drop an attack (target a cell or opt into random mode).              |
| **Broadcast**            | `/broadcast`     | Read-only orbit camera + live leaderboard. What you point at a TV or projector for the audience.            |
| **Server**               | `:3001` (Node)   | Authoritative state: grid placements, round timer, user presence, admin password for destructive actions.   |

Clients talk to the server over one WebSocket. Every connection declares a role (`vr` / `portal` / `mobile` / `broadcast`) on open — only `vr` connections are ever promoted to "user characters" visible in the world and on the leaderboard.

---

## 🕹️ Game rules

### The round

1. Designer drags emojis onto the grid (weapons, goals, enemies, hazards, a spawn chair) and sets the round duration.
2. Clicks **Start Round** → server enters *pending* state.
3. The VR player walks to the chair 🪑 and presses SELECT → the timer starts.
4. Round ends on **all stars collected** (win), **player death** (game-over for that player — round continues for everyone else), **timer expiry**, or **host-stopped**.

### Life points

- 5 life points baseline, shown as a row of ❤ / ♡ hearts on the VR HUD.
- Getting touched by an enemy (within close range) → red flash + oof cue + -1 life, with a 1.1 s per-hit cooldown.
- Fire tiles 🔥 deal damage on the same cooldown while you stand on one.

### Combat

| Tool      | Effect                                                                              | Activation                                       |
| --------- | ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| 🗡️ Sword / 🔨 Hammer | 1-hit kill on any enemy. Left-hand melee, fast swing; contact detection uses tip velocity. | Pick up; swing your arm or press the left trigger. |
| 🔫 Water gun          | 1-hit kill. Right-hand projectile.                                                  | Pick up; right trigger.                          |
| Bare hands            | 2-hit kill (half a sword).                                                          | No pickup needed — just move an empty left hand fast. |
| 💩 Voice bomb         | Thrown AoE grenade. Unlimited once unlocked.                                        | Pick up 💩 once, then say *"poo poo doo doo"* (or press **B**). |
| 🦅 Bird poop          | Every flying bird drops a bomb straight down.                                       | Say *"kaka"*, *"gaga"*, or *"caw caw"*.          |
| 🪶 Feather flight     | Lifts you to 3 m for 3 s. **Invulnerable** while flying.                            | Pick up 🪶 — flight starts immediately. Also by saying *"I'm a peacock … fly"*. |

### Pickups

| Item       | Effect                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- |
| ⭐ Star     | +1 goal progress, +1 life (up to current max). Collect all stars to win the round.              |
| 🍌 Banana  | +1 life (up to current max).                                                                    |
| 🍄 Mushroom | **Raises your max by +2** and fills those lives. Every mushroom spawns a follower that trails you along your path — pick up three and you get a conga line. |
| 🪑 Chair   | Spawn point for the ready-check.                                                                |

### Mushroom economy (Mario-style)

- Picking up a 🍄 pushes you to 7/7 lives (5/5 → 7/7). Another one → 9/9, etc.
- Taking a hit **pops the tail mushroom** instead of reducing life: max shrinks by 2, you're clamped back to the new max. No actual life damage while you have 'shrooms.
- When the chain is empty, hits take real life.

### Enemies

| Emoji | Behaviour                                                                           |
| ----- | ----------------------------------------------------------------------------------- |
| 🤖 Robot   | Territorial — only chases within 3 m aggro range. Hits hard.                      |
| 👻 Ghost   | Slow, relentless, **phases through walls**.                                       |
| 💀 Skull   | Normal-speed stalker, occasionally switches targets.                              |
| ⛄ Snowman | Slowest on the board, light touch damage.                                          |
| 🦅 Eagle (bird) | Flies high, needs one gun shot to down.                                      |

All enemies have 2 HP so the 1-hit weapon / 2-hit fist rule holds.

---

## 🛠️ Movement model

Physical walking only. No thumbstick glide, no teleport ray, no snap turn. The map is scaled to fit inside a Quest guardian — default 6 m × 6 m (slider range 3.2 m – 16 m). Recentering is handled by the Meta button on the headset.

Programmatic position changes exist in two places (round-start spawn at the chair, and the 🪶 flight altitude hold); both write directly to the XROrigin transform and don't go through `LocomotionSystem`.

---

## 🎙️ Voice

VR clients open a WebRTC PeerConnection to OpenAI's Realtime API (transcription-only). The server exchanges the real key for a short-lived `client_secret`, so the browser never sees the long-lived credential. Phrase matchers in `src/voice-system.ts` listen for:

- `/o{2,}/ × 3+` → bomb throw (handles every *"poo poo doo doo"* variant, plus *ププルル*, *Boo-boo*, etc.)
- `/\b(im|i am)\s+a\s+peacock\b.*\bfly\b/` → feather flight
- `/\b([kgc]a{1,2}w?\s*){2,}\b/` → every flying bird drops a 💩 bomb

Voice requires `OPENAI_API_KEY` on the server. Keyboard fallbacks exist for every phrase (see `src/portal.ts:setupKeyboard`).

---

## 🏁 Getting started

### Prerequisites
- Node.js ≥ 18
- A Quest 2/3 (or any WebXR-capable headset) for the VR client
- A laptop and one or two phones for the other screens

### Install & run locally

```bash
npm install

# in one terminal — the state server (also serves /api/realtime-token)
export OPENAI_API_KEY="sk-..."   # optional, required for voice triggers
export ADMIN_PWD="changeme"      # optional, required for portal Clear
node server.js

# in another terminal — Vite dev server (HMR, HTTPS with self-signed cert)
npm run dev

# open:
#   VR          → https://<your-ip>:8081/
#   Portal      → https://<your-ip>:8081/portal.html
#   Mobile      → https://<your-ip>:8081/portal-mobile.html
#   Broadcast   → https://<your-ip>:8081/broadcast.html
```

The Quest needs HTTPS. Either generate a self-signed cert under `.certs/` (the Vite config picks it up) or use `ngrok` / `cloudflared` to tunnel.

### Production

Railway hosts the WebSocket + token server (see `docs/deploy.md`). Vercel hosts the static front-ends. `ADMIN_PWD` for the clear button is a Railway env var — defaults to `admin` if unset.

---

## 📂 Project layout

```
src/
├── index.ts                 # World.create() + system registration (VR + broadcast entry)
├── portal.ts                # PortalSystem — the 1.9k-line game loop (items, AI, combat, mushroom chain)
├── game-state.ts            # Shared signals, tuning constants, ItemRole enum
├── weapon-system.ts         # Sword/gun mesh attachment to controller grips
├── projectile-system.ts     # Water-gun bullets
├── bomb-system.ts           # 💩 bomb state machine (flying → blinking → exploding)
├── voice-system.ts          # OpenAI Realtime transcription + phrase matchers
├── hud-system.ts            # Head-locked VR HUD (timer, score, hearts, banners)
└── game-fx.ts               # Haptic + WebAudio cues

portal.html                  # Designer desktop + mobile strip (grid editor, round controls)
portal-mobile.html           # Attacker phone (7×2 palette, tap-to-place or random mode)
broadcast.html               # Spectator orbit view — loads src/index.ts in spectator mode

server.js                    # WS relay + round state + /api/realtime-token + admin clear
public/textures/stickers/    # Hand-drawn sticker art (Gun, Sword, Ghost, ...)
public/textures/             # Older Bird/Chair art + non-sticker items (Hammer, Snowman)
```

---

## 🧪 Testing tips

- **Always run `npx tsc --noEmit`** before claiming anything works. IWSDK bugs often manifest as silent init failures.
- **IWER emulator** (`https://localhost:8081` on desktop) uses your webcam as passthrough. Move the fake head with WASD + mouse; trigger controllers with the toolbar.
- **Voice**: run the server with `OPENAI_API_KEY` set, then grant mic permission on first SELECT press in VR.
- **Multi-player**: open `/` on two headsets pointed at the same server — both show up on the portal leaderboard and in the broadcast view.

---

## 👥 The team

- **Rae**
- **Yoyo**
- **Ted**

Made for the **Prototyping** class at **CCA (California College of the Arts)**, Spring 2026.

*Built with ❤️ on [IWSDK](https://iwsdk.dev).*
