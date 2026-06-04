# Vibecoding Guide

A cheat-sheet for asking Claude (or any LLM) to change things in this project
without knowing every file. If you can describe *what part of the system* you
want to touch, the AI can find the right file.

---

## The 2-minute mental model

There are **four user-facing surfaces** and **one server**
in the middle that glues them together.

```
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │ Landing      │  │ VR Headset   │  │ Portal       │  │ Broadcast    │
   │ /            │  │ /play.html   │  │ /portal      │  │ /broadcast   │
   │ role picker  │  │ Quest in XR  │  │ planner      │  │ 3D spectator │
   └──────────────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                            │                 │                 │
                 ┌──────────┴─────────────────┴─────────────────┘
                 │
          ┌──────▼──────┐
          │  server.js  │
          │ port 3001   │
          │ grid state  │
          │ + presence  │
          └──────▲──────┘
                 │
          ┌──────┴───────┐
          │ Portal Mobile│
          │ /portal-mobile
          │ phone attack │
          └──────────────┘
```

- **Landing** — `index.html`, a role picker with links to VR, portal, mobile,
  and broadcast.
- **VR Headset** — `play.html` + `src/index.ts`, real Quest 3 user inside the
  immersive AR scene.
- **Portal planner** — `portal.html`, desktop grid editor and round controls.
- **Portal Mobile** — `portal-mobile.html`, phone-sized tap-to-place attacker
  interface.
- **Broadcast view** — `broadcast.html`, spectator orbit camera + leaderboard.
  It loads the same `src/index.ts` scene in spectator mode.

The server keeps **two pieces of state**:
1. `gridState` — which items are in which cells. Shared by everyone.
2. `users` — a map of `userId → { position, spaceId, score, health, ... }` for
   VR clients that publish `PLAYER_POSITION`.

Passive viewers (`portal`, `mobile`, `broadcast`) are connected but are not in
`users`. They only observe and/or place grid items.

For local development, you need **both**:

```bash
npm run server  # WebSocket + shared state on :3001
npm run dev     # Vite pages on :8081
```

If portal placements do not appear in XR, or broadcast does not show players,
check the `npm run server` terminal first. Vite by itself cannot sync clients.

---

## Bots vs. users — know the difference

This is the biggest source of confusion, so it gets its own section.

| | **Sim-bot** (`scripts/sim-user.js`) | **User** (real VR) |
|---|---|---|
| What it is | Node.js script running fake motion patterns | Real person in a Quest |
| Where it runs | Terminal (`npm run sim`) | Quest headset / browser running `play.html` |
| What the server sees | Identical — both send `PLAYER_POSITION` messages | Identical |
| Appearance in views | Colored marker + facing cone | Colored marker + facing cone |
| Purpose | Load-testing, rehearsing multi-user scenes without hardware | Actual multiplayer participation |
| Can place grid items | ❌ no (bots only move) | ❌ no (VR users don't place either — only the **portal planner** places items) |
| Disappears when | You hit Ctrl+C | You close the page / take off the headset |

**Key thing to internalize:** bots and real users are **the same thing to the
server**. The server has no concept of "test" vs "production" — it just tracks
connections that publish positions. This means anything you build to support
real multiplayer (name tags, proximity chat, etc.) will automatically work for
the bots too, and vice versa.

**Bots are for testing your multi-user code without needing N headsets.**
**Users are the actual gameplay.**

---

## Objects in the system you can talk about

When asking for changes, name one of these and say what you want changed.
Claude will find the right file.

### Grid and item palette

- **Grid dimensions** — 8 cols × 8 rows. Lives in `portal.html`,
  `portal-mobile.html`, `src/index.ts` (floor), `src/portal.ts`
  (`gridToWorld`), and `server.js` seed constants.
- **Item palette** — the draggable icons in the portal planner. Defined in
  `portal.html` as `<div class="item" data-type="..." data-icon="..." ...>`.
- **Item PNGs / stickers** — what items look like in portal, mobile, XR, and
  broadcast. Paths live in `src/portal.ts` (`ITEM_TEXTURES`,
  `MUSHROOM_TEXTURES`), `portal.html` (`STICKERS`), and
  `portal-mobile.html` (`STICKERS`).
- **Item 3D wall meshes** — `cube` and `wood` become wall blocks in
  `src/portal.ts`; they intentionally remain glyphs in the planner.

### Players (users + bots)

- **Player marker** — full-body `Person.png` sticker + facing cone in XR and
  broadcast. `src/portal.ts` → `createAvatar` / `updateAvatar`.
- **Planner dot + cone** — tiny CSS version of the above on the 2D grid.
  `portal.html` and `portal-mobile.html` → `ensurePlayer`, `updatePlayer`.
- **Color palette** — 8 colors assigned by hashing `userId`. Same palette in
  the XR/broadcast avatar code and portal player overlays. Keep
  `src/portal.ts`, `portal.html`, `portal-mobile.html`, and `src/index.ts`
  aligned when changing it.
- **Facing cone** — the wedge showing which way a player looks. Geometry +
  size in `src/portal.ts` (`avatarConeGeom`); CSS triangles in
  `portal.html` and `portal-mobile.html` (`.player-cone::before` where present).

### Motion, input, sync

- **VR player position sender** — sends head world position, pitch/yaw, score,
  health, and round stats at 10 Hz.
  `src/portal.ts` → `PortalSystem.update()`.
- **Sim-bot motion patterns** — `circle`, `figure8`, `random`, `static`.
  `scripts/sim-user.js` → `PATTERNS` map.
- **Position send rate** — currently 10 Hz. Change `TICK_MS` in
  `sim-user.js` and the `this.lastPosSend` throttle in `src/portal.ts`.

### Server + protocol

- **WebSocket server** — `server.js`. Handles grid state, per-user presence,
  join/leave broadcasts. Listens on port `3001`.
- **Message types** — the JSON protocol between client and server:
  - `WELCOME` — server → client on connect, with `userId`, full `grid`, all
    present `users`.
  - `GRID_PLACE` / `GRID_UPDATE` / `GRID_CLEAR` / `GRID_CLEAR_ALL` — item
    placement sync.
  - `PLAYER_POSITION` — 10 Hz position + heading update. Server tags with
    `userId` before rebroadcasting.
  - `USER_JOIN` / `USER_LEAVE` — presence events (broadcast to others only).
- **`spaceId` field** — reserved slot on user records for Meta Quest Shared
  Spaces room UUIDs. Currently always `null`. When wired up, VR users in the
  same physical room will share one.

### VR scene

- **World setup / floor / spectator camera** — `src/index.ts`.
- **Grid items, stickers, enemies, pickups, player avatars** — `src/portal.ts`.
- **Weapons** — `src/weapon-system.ts`, `src/projectile-system.ts`,
  `src/bomb-system.ts`.
- **Voice triggers** — `src/voice-system.ts`.
- **HUD and feedback** — `src/hud-system.ts`, `src/sign-system.ts`,
  `src/game-fx.ts`.

---

## Example prompts

Copy these, tweak the bits in `[brackets]`, and paste into Claude.

### Adding / changing grid items

> "Add a **[pumpkin 🎃]** item to the palette. Use a PNG billboard in XR,
> portal, mobile, and broadcast."

> "Swap the hammer art for a **[disco hammer]**. Change the sticker path in
> XR, desktop portal, and mobile portal."

> "Make the fire items **[pulse between red and orange]** in XR and broadcast."

> "Add a new section **[Nature]** to the palette with **[tree, rock, flower,
> mushroom]**."

### Visual tweaks

> "Make the facing cone **[narrower and longer]** in the broadcast view."

> "Give each user a **[floating name label]** above their player marker in
> the broadcast view. For now just use `userId.slice(0, 6)` as the name."

> "Change the grid color from **[indigo]** to **[teal]** in all three views
> (VR, broadcast, planner)."

> "The player sticker is floating. Ground its feet while keeping jump/fly
> height visible."

### Motion and behavior

> "Add a new sim-bot pattern called **[zigzag]** that **[bounces back and
> forth across the grid]**."

> "When a VR user stops moving for **[2 seconds]**, **[fade their facing
> cone to half opacity]**."

> "Bump the position update rate from **[10 Hz to 20 Hz]** everywhere."

### Multi-user / presence

> "Show a list of currently-online users in the footer of **[portal.html]**,
> with their color swatch and a short ID."

> "Play a **[soft chime]** sound in the broadcast view when a new user
> joins."

> "When a user disconnects, **[keep their marker visible for 2 seconds with
> a fading effect]** before removing it."

> "Add a **[name prompt]** on first visit to `play.html`. Save to localStorage.
> Send the name in the existing `HELLO` message."

### Testing helpers

> "Add a **[--heading 90]** flag to `sim-user.js` for static bots so I can
> set the direction they face."

> "Make `npm run sim` launch **[3 circle bots and 2 random walkers]** in one
> command."

> "Add a **[reset all grid items]** button to `portal.html` for quick demo
> cleanup."

### Server and protocol

> "Add a **[HELLO]** message so clients can tell the server their display
> name and role. Forward it in `USER_JOIN` broadcasts."

> "When the server gets a **[CLEAR_USER]** message with a userId, disconnect
> that user. (admin override for stuck test bots)"

> "Log every **[GRID_PLACE]** event to a file **[grid-log.jsonl]** so I can
> replay sessions."

---

## How to run everything

```bash
# Terminal 1 — sync server (WebSocket, grid + presence)
npm run server       # ws://localhost:3001

# Terminal 2 — dev server (Vite, serves landing, VR, portal, mobile, broadcast)
npm run dev          # http://localhost:8081 unless .certs/ enables HTTPS

# Terminal 3 — sim bots for testing (optional)
npm run sim -- --count 3 --pattern circle
npm run sim -- --pattern figure8
npm run sim -- --pattern static --pos 4,-2 --name Parked
```

Then open whichever surfaces you want:

- Landing: `http://localhost:8081/`
- VR app: `http://localhost:8081/play.html`
- Broadcast: `http://localhost:8081/broadcast.html`
- Portal planner: `http://localhost:8081/portal.html`
- Mobile attacker: `http://localhost:8081/portal-mobile.html`

All game surfaces connect to the same sync server, so placements, round state,
players, and broadcast data stay in sync.

---

## When Claude asks "which file?" — reply with one of

- **"the VR scene"** → `src/index.ts`
- **"the grid sync on the VR side"** → `src/portal.ts`
- **"the 3D broadcast view"** → `broadcast.html` + `src/index.ts` + `src/portal.ts`
- **"the desktop planner"** → `portal.html`
- **"the phone attacker"** → `portal-mobile.html`
- **"the server / sync protocol"** → `server.js`
- **"the bots"** → `scripts/sim-user.js`
- **"the weapons"** → `src/weapon-system.ts`, `src/projectile-system.ts`,
  `src/bomb-system.ts`
- **"the voice commands"** → `src/voice-system.ts`
- **"the welcome UI panel"** → `ui/welcome.uikitml` + `public/ui/welcome.json`

You rarely need to touch more than 2 of these for a single feature.
