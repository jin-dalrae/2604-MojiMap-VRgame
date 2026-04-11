# Vibecoding Guide

A cheat-sheet for asking Claude (or any LLM) to change things in this project
without knowing every file. If you can describe *what part of the system* you
want to touch, the AI can find the right file.

---

## The 2-minute mental model

There are **four surfaces** users (or bots) can show up on, and **one server**
in the middle that glues them together.

```
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │ VR Headset   │  │ Broadcast    │  │ Portal       │  │ Puppet       │
   │ (Quest in XR)│  │ (3D birdseye)│  │ (2D planner) │  │ (fake VR)    │
   │              │  │              │  │              │  │              │
   │ src/index.ts │  │ broadcast-   │  │ portal.html  │  │ puppet.html  │
   │ src/portal.ts│  │ entry.ts     │  │              │  │              │
   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
          │                 │                 │                 │
          └─────────────────┴────── WebSocket ┴─────────────────┘
                                     │
                              ┌──────▼──────┐
                              │  server.js  │
                              │ port 3001   │
                              │ grid state  │
                              │ + presence  │
                              └─────────────┘
```

- **VR Headset** — real Quest 3 user inside the immersive AR scene.
- **Broadcast view** — anyone on a laptop/TV watching the scene from above in
  3D. Doesn't place items, doesn't control anyone. Pure spectator.
- **Portal planner** — phone/tablet grid planner where audience members tap
  to place items. No 3D, no avatar.
- **Puppet** — development tool. A laptop browser pretending to be a VR user,
  moved with WASD + mouse. Looks identical to a real VR user on the server.

The server keeps **two pieces of state**:
1. `gridState` — which items are in which cells. Shared by everyone.
2. `users` — a map of `userId → { position, spaceId }` for anyone who
   publishes a position (real VR users + puppets + sim-bots).

Passive viewers (broadcast + portal) are connected but aren't in `users` — they
only observe.

---

## Bots vs. users — know the difference

This is the biggest source of confusion, so it gets its own section.

| | **Sim-bot** (`scripts/sim-user.js`) | **User** (real VR / puppet) |
|---|---|---|
| What it is | Node.js script running fake motion patterns | Real person in a Quest or controlling `puppet.html` |
| Where it runs | Terminal (`npm run sim`) | Quest headset or laptop browser |
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

- **Grid dimensions** — 20 cols × 10 rows, 1m cells. Lives in `portal.html`
  (`COLS`, `ROWS`), `broadcast-entry.ts` (grid rendering), `src/index.ts` (VR
  floor), `src/portal.ts` (coord mapping).
- **Item palette** — the draggable icons in the portal planner. Defined in
  `portal.html` as `<div class="item" data-type="..." data-icon="..." ...>`.
- **Item 3D shapes** — what items look like inside VR. Lives in
  `src/portal.ts` under `ITEM_CONFIGS`.
- **Item 2.5D sprites** — what items look like in the broadcast 3D view.
  Lives in `src/broadcast-entry.ts` in `makeEmojiSprite` + `spawnGridItem`.

### Players (users + bots)

- **Player marker** — sphere + emoji head + ring + facing cone on the
  broadcast view. `src/broadcast-entry.ts` → `createPlayerMarker`.
- **Planner dot + cone** — tiny CSS version of the above on the 2D grid.
  `portal.html` → `ensurePlayer`, `updatePlayer`.
- **Self-marker** — the puppet's own pulsing dot. `puppet.html` → `self-dot`
  / `self-cone` styles + `renderSelf` logic.
- **Color palette** — 8 colors assigned by hashing `userId`. Same palette in
  three places, kept in sync by convention: `broadcast-entry.ts` `USER_COLORS`,
  `portal.html` `PALETTE`, `puppet.html` `PALETTE`.
- **Facing cone** — the wedge showing which way a player looks. Geometry +
  size in `broadcast-entry.ts` (`sharedConeGeom`); CSS triangle in
  `portal.html` + `puppet.html` (`.player-cone::before`).

### Motion, input, sync

- **VR player position sender** — sends head world position + yaw at 10 Hz.
  `src/portal.ts` → `PortalSystem.update()`.
- **Sim-bot motion patterns** — `circle`, `figure8`, `random`, `static`.
  `scripts/sim-user.js` → `PATTERNS` map.
- **Puppet input** — WASD walk, mouse aim, click teleport. `puppet.html`
  main loop + event listeners.
- **Position send rate** — currently 10 Hz everywhere. Change `TICK_MS` in
  `sim-user.js`, `this.lastPosSend` throttle in `portal.ts`, `lastSent`
  interval in `puppet.html`.

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

### VR scene (separate from the grid)

Unrelated to multi-user, but useful to know for feature requests:

- **Environment model** — `environmentDesk.gltf` loaded in `src/index.ts`.
- **Robot** — `robot.gltf` with the `Robot` component. `src/robot.ts`.
- **Plant** — `plantSansevieria.gltf`, distance-grabbable. `src/index.ts`.
- **Physics balls** — `BallSystem` in `src/ball.ts`, spawned in `index.ts`.
- **Welcome panel** — UIKITML panel from `/ui/welcome.json`. `PanelSystem`.
- **Audio** — chime sound on robot tap. `src/robot.ts` + `AudioSource`.

---

## Example prompts

Copy these, tweak the bits in `[brackets]`, and paste into Claude.

### Adding / changing grid items

> "Add a **[pumpkin 🎃]** item to the palette. In the VR scene make it a
> small **[orange sphere]**, and in the broadcast view use the emoji."

> "Swap the lamp for a **[disco ball]**. Change the icon, the VR shape, and
> give it a **[pink]** color."

> "Make the fire items **[pulse between red and orange]** in VR. Leave the
> broadcast view alone."

> "Add a new section **[Nature]** to the palette with **[tree, rock, flower,
> mushroom]**."

### Visual tweaks

> "Make the facing cone **[narrower and longer]** in the broadcast view."

> "Give each user a **[floating name label]** above their player marker in
> the broadcast view. For now just use `userId.slice(0, 6)` as the name."

> "Change the grid color from **[indigo]** to **[teal]** in all three views
> (VR, broadcast, planner)."

> "The puppet's self-marker is too subtle. Make it **[bigger, with a double
> ring and a white arrow in the middle]**."

### Motion and behavior

> "Add a new sim-bot pattern called **[zigzag]** that **[bounces back and
> forth across the grid]**."

> "Make the puppet **[rotate smoothly toward mouse over 200ms]** instead of
> snapping."

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

> "Add a **[name prompt]** on first visit to puppet.html. Save to
> localStorage. Send the name in the HELLO message." *(requires adding HELLO
> message type to server.js)*

### Testing helpers

> "Add a **[--heading 90]** flag to `sim-user.js` for static bots so I can
> set the direction they face."

> "Make `npm run sim` launch **[3 circle bots and 2 random walkers]** in one
> command."

> "Add a **[reset all grid items]** button to puppet.html for quick demo
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
# Terminal 1 — dev server (Vite, serves VR app + portal + broadcast + puppet)
npm run dev          # https://localhost:8081

# Terminal 2 — sync server (WebSocket, grid + presence)
npm run server       # ws://localhost:3001

# Terminal 3 — sim bots for testing (optional)
npm run sim -- --count 3 --pattern circle
npm run sim -- --pattern figure8
npm run sim -- --pattern static --pos 4,-2 --name Parked
```

Then open whichever surfaces you want:

- VR app: `https://localhost:8081` (open in Quest 3)
- Broadcast: `https://localhost:8081/broadcast.html`
- Portal planner: `https://localhost:8081/portal.html`
- **Puppet (new)**: `https://localhost:8081/puppet.html`

All four surfaces connect to the same sync server, so changes in one show up
in the others instantly.

---

## When Claude asks "which file?" — reply with one of

- **"the VR scene"** → `src/index.ts`
- **"the grid sync on the VR side"** → `src/portal.ts`
- **"the 3D broadcast view"** → `src/broadcast-entry.ts`
- **"the 2D planner"** → `portal.html`
- **"the puppet"** → `puppet.html`
- **"the server / sync protocol"** → `server.js`
- **"the bots"** → `scripts/sim-user.js`
- **"the robot behavior"** → `src/robot.ts`
- **"the physics balls"** → `src/ball.ts`
- **"the welcome UI panel"** → `ui/welcome.uikitml` + `public/ui/welcome.json`

You rarely need to touch more than 2 of these for a single feature.
