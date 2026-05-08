# 🌌 MojiMap — Game Manual

**A WebXR emoji arena built with the Immersive Web SDK.**
One player straps on a Quest. A designer drops emojis onto an 8×8 grid from a laptop. Phones in the audience throw attacks. A broadcast view streams the whole thing to a TV. You walk — physically — around your living room and try to survive long enough to collect every ⭐ on the map.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![WebXR](https://img.shields.io/badge/WebXR-Quest%203-brightgreen.svg)

---

## 🎯 Your goal

Collect every ⭐ on the board before the timer runs out — and stay alive while doing it.

You win the round when:
- **Every ⭐ is collected.** This is the primary win condition.

You lose the round when:
- **Your life points hit zero.** You become a spectator until the round ends.
- **The timer expires** with stars still on the board.
- **The host stops the round.**

---

## 🕹️ Getting in

1. The host (designer) drops a 🪑 chair somewhere on the grid and clicks **Start Round**.
2. Put on your Quest. Open the URL the host gives you. Tap **Enter VR**.
3. Walk physically to the chair. When you're standing on it, press the **right trigger (SELECT)**.
4. The timer starts. The board comes alive. Go.

> **No thumbstick movement, no teleport.** The whole game is sized to fit inside your room-scale Quest guardian. If you want to move, walk. If your guardian is set to "stationary" (a small circle), reset it to "room scale" before starting — otherwise the runtime will pin you to a 1m bubble.

---

## 🎮 Controls

| Input                      | Effect                                                                       |
| -------------------------- | ---------------------------------------------------------------------------- |
| **Walk physically**        | Move around the map. Only locomotion mode there is.                           |
| **Right trigger (SELECT)** | Confirm at chair → start round. After that: fire 🔫 water gun if equipped.    |
| **Left trigger**           | Swing 🗡️ sword / 🔨 hammer if equipped (you can also just swing your arm).    |
| **Empty hand swing (left)** | Bare-hands attack — 2 hits to kill instead of 1.                             |
| **Voice phrases**          | Trigger abilities you've unlocked (see *Voice Commands* below).               |
| **B key (desktop emulator)** | Throw 💩 bomb (debug shortcut for the voice trigger).                       |

---

## ❤ Life points

You start every round with **5 hearts** ❤❤❤❤❤.

| Damage source            | Hits cost |
| ------------------------ | --------- |
| Touched by an enemy      | -1 life   |
| Standing on a 🔥 fire tile | -1 / sec  |
| 💥 Bomb blast (yours or someone else's) | -1 life |

Damage has a **1.1 second cooldown** — you can't be combo-killed by walking through a clump of enemies. You'll see a red flash on the HUD and hear an *oof* sound when you take a hit.

### Mushroom shield

Picking up a 🍄 raises your **max hearts by 2** and fills them in. Hits with 🍄s in your stack don't damage you — they pop the tail mushroom off the conga line behind you instead. When the line is empty, hits go back to costing real life. Stack as many as you can find.

---

## 🎒 Pickups

Walk through any of these to grab them. Pickups are **shared** between players — first one to it wins.

| Emoji | Name        | What it does                                                               |
| ----- | ----------- | -------------------------------------------------------------------------- |
| ⭐    | Star        | +1 goal progress. Heals 1 life. Collect them all to win.                    |
| 🍌    | Banana      | +1 life (up to your current max).                                          |
| 🍄    | Mushroom    | +2 max life, fills new hearts, spawns a follower (Mario-style conga).      |
| 🪑    | Chair       | Spawn point. Walk to it pre-round and press SELECT to begin.                |
| 🗡️    | Sword       | Left-hand melee weapon. 1-hit kill on enemies.                              |
| 🔨    | Hammer      | Same as sword — different sticker, same swing.                              |
| 🔫    | Water gun   | Right-hand projectile weapon. 1-hit kill on enemies *and* flying birds.     |
| 💩    | Bomb item   | Unlocks the voice-bomb ability for the rest of the round (unlimited throws). |
| 🪶    | Feather     | Lifts you to **3 m** for 3 seconds. **Invulnerable** while flying.          |

---

## 🦴 Combat

| Tool      | Damage | Activation                                    |
| --------- | ------ | --------------------------------------------- |
| 🗡️ Sword / 🔨 hammer | 1-hit kill | Pick up. Swing your left arm fast, or hold the left trigger. |
| 🔫 Water gun         | 1-hit kill, including flying birds | Right trigger. Aim with your wrist. |
| 👊 Bare hands         | 2-hit kill | No pickup. Just swing an empty left hand fast. |
| 💩 Bomb              | AoE blast | Pick up 💩 once, then say *"poo poo doo doo"*.  |

> **Pro tip:** the water gun is the only weapon that can hit a 🦅 eagle in flight — and every eagle you down drops a 🪶 feather where it lands. Hunt them.

---

## 🦅 Enemies

| Emoji | Name     | Behaviour                                                              |
| ----- | -------- | ---------------------------------------------------------------------- |
| 🤖    | Robot    | Walks in a straight line until it bumps a wall, then turns.            |
| 👻    | Ghost    | Slow, relentless, **phases through walls**. Always heading for you.     |
| 💀    | Skull    | Orbits in circles around its spawn point. Switches targets occasionally. |
| ⛄    | Snowman  | Slowest on the board, light touch damage.                              |
| 🦅    | Eagle    | Flies high overhead. Drops a 🪶 when shot down.                         |

All enemies have **2 HP**, so the 1-hit / 2-hit weapon rule holds. The 🦅 eagle is special: you can only hit it with the 🔫 water gun (or a 💩 bomb caught in its AoE).

---

## 🎙️ Voice commands

The Quest mic is hot the moment you grant permission (first SELECT press). Three phrases trigger abilities — when one fires you'll see a comic-book sign pop up in front of you.

| Say…                                | Effect                                                                | Pre-req                |
| ----------------------------------- | --------------------------------------------------------------------- | ---------------------- |
| *"Poo poo doo doo"* (any "oo" chant) | Throw a 💩 bomb in front of you (AoE, ~1.5s fuse).                    | Picked up 💩 once.     |
| *"I'm a peacock … fly!"*            | Mega jump — you launch up to flight altitude, invulnerable while up.  | Picked up 🪶 once.     |
| *"Caw caw"* / *"kaka"* / *"gaga"*   | Every flying 🦅 on the board drops a 💩 bomb straight down on whoever's underneath. | None — always available. |

The matchers are loose on purpose so any imitation of the sound works. The bomb matcher counts "oo" sounds (3+ triggers it), so *"Foo-foo Boo-boo"*, *ププルル*, etc. all work.

---

## 🪶 Reward loop

Killing things is rewarding here, not just necessary:

- Down a 🦅 **with the water gun** → it falls, lands upside-down, and drops a 🪶 feather right where it crashed.
- A **+points** popup floats up from the kill site.
- A puff of feathers bursts outward.
- A **"BIRD KO!"** comic sign flashes in front of you.

Now you've got flight on demand. Use it to escape a corner, or to dodge a phone-attacker's incoming 💀.

---

## 📺 The five screens

This is a multi-screen, asymmetric game. One headset is the player; everyone else is involved through other screens.

| Screen             | URL              | Who's on it                                                                          |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------ |
| **VR**             | `/`              | The contestant in the Quest. The whole game-feel lives here.                          |
| **Portal**         | `/portal`        | The host on a laptop. Drags emojis onto the grid, tunes sliders, runs the round timer. |
| **Portal Mobile**  | `/portal-mobile` | Spectators on phones. Tap an emoji to drop an attack on a chosen cell (or a random one). |
| **Broadcast**      | `/broadcast`     | Read-only orbit camera + live leaderboard. Point this at a TV or projector.           |
| **Server**         | `:3001` (Node)   | Authoritative state — grid, timer, presence, voice token mint.                        |

All clients talk to the server over a single WebSocket. Each connection declares its role on open; only `vr` connections become "user characters" you see in the world.

---

## 🛠️ Hosting a session

### Quick start (local network)

```bash
npm install

# terminal 1 — state server
export OPENAI_API_KEY="sk-..."   # optional, only needed for voice triggers
node server.js

# terminal 2 — Vite dev server (HTTPS, HMR)
npm run dev
```

Then open:

- **VR**         → `https://<your-ip>:8081/`
- **Portal**     → `https://<your-ip>:8081/portal.html`
- **Mobile**     → `https://<your-ip>:8081/portal-mobile.html`
- **Broadcast**  → `https://<your-ip>:8081/broadcast.html`

The Quest needs HTTPS. Generate a self-signed cert under `.certs/` (Vite picks it up automatically) or tunnel with `ngrok` / `cloudflared`.

### Deploying

- **Server**: Railway hosts the WebSocket + token server. See `docs/deploy.md`.
- **Front-ends**: Vercel hosts the static pages (VR, portal, mobile, broadcast).
- `OPENAI_API_KEY` only needs to live on the Railway side — the browser fetches a short-lived token over `/api/realtime-token`.

---

## 🧪 Testing tips

- **Always type-check first**: `npx tsc --noEmit`. IWSDK init failures often look silent at runtime.
- **IWER emulator** lets you "play" without a headset on `https://localhost:8081`. WASD + mouse moves the fake head; the toolbar fires controllers.
- **Voice**: run the server with `OPENAI_API_KEY` set, grant mic permission on first interaction, then chant.
- **Multi-player**: open `/` on two headsets pointed at the same server. Both will show up on the portal leaderboard and broadcast view.
- **Stuck in a small circle?** Quest is using the seated/stationary reference space. Reset to room-scale guardian and re-enter VR.

---

## 📂 Project layout

```
src/
├── index.ts              # World.create() + system registration (VR + broadcast entry)
├── portal.ts             # PortalSystem — items, AI, combat, mushroom chain, bird kill loop
├── game-state.ts         # Shared signals, tuning constants, ItemRole enum
├── weapon-system.ts      # Sword/gun mesh attachment to controller grips
├── projectile-system.ts  # Water-gun bullets
├── bomb-system.ts        # 💩 bomb state machine (flying → blinking → exploding)
├── voice-system.ts       # OpenAI Realtime transcription + phrase matchers
├── sign-system.ts        # Comic signs, score popups, feather puffs
├── hud-system.ts         # Head-locked VR HUD (timer, score, hearts, banners)
└── game-fx.ts            # Haptic + WebAudio cues

portal.html               # Designer desktop — grid editor + round controls
portal-mobile.html        # Attacker phone — tap-to-place palette
broadcast.html            # Spectator orbit + leaderboard

server.js                 # WebSocket relay + round state + token mint + admin clear
public/textures/stickers/ # Hand-drawn sticker art
public/textures/          # Voice-trigger signs + non-sticker art
```

---

## 👥 Credits

Made for the **Prototyping** class at **CCA (California College of the Arts)**, Spring 2026.

- **Rae**
- **Yoyo**
- **Ted**

*Built with ❤️ on [IWSDK](https://iwsdk.dev).*
