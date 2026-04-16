# Rae's Changes

## Session: April 16, 2026

### 1. Game Rules Documentation

Updated `README.md` with specific game mechanics:

- **Asymmetric gameplay**: VR player (Survivor) vs Phone/Tablet users (Attackers)
- **30-second rounds**: Survivor must dodge attacks and survive the timer
- **Win conditions**:
  - VR Player wins by surviving the full 30 seconds
  - Attackers win by landing a hit before time runs out
- **Placement rules**: Only one item on grid at a time — new placement removes previous

---

### 2. Glitch/Cyberpunk Floor Shader

Created `src/glitch-floor.ts` — custom ShaderMaterial with animated effects:

**Visual Effects:**
- Cyan neon grid lines with RGB chromatic aberration
- Magenta circuit traces with traveling "data packets"
- Scrolling horizontal scanlines
- Random glitch block distortions
- Digital noise texture overlay
- Edge glow effect
- Occasional screen flash glitches

**Technical:**
- `GlitchFloorMaterial` — ShaderMaterial with GLSL vertex/fragment shaders
- `GlitchFloorSystem` — Updates `uTime` uniform each frame for animation
- Configurable uniforms: colors, scanline speed, glitch intensity

---

### 3. 3D Neon Models for Grid Items

Created `src/grid-items.ts` — procedural 3D geometry replacing emoji sprites:

**13 Item Types:**

| Category | Items | Colors |
|----------|-------|--------|
| **Shapes** | Cube, Sphere, Cylinder | Cyan, Blue, Orange |
| **Furniture** | Chair, Table, Lamp, Plant, Screen | Magenta, Green, Yellow |
| **Effects** | Fire, Portal, Star, Music, Robot | Red/Orange, Magenta/Cyan, Yellow |

**Design:**
- Neon materials with emissive glow (MeshStandardMaterial)
- Additive blend glow halos (MeshBasicMaterial)
- Cyberpunk color palette matching the floor shader
- All items are procedural Three.js geometry (no external model downloads)

**Updated `src/portal.ts`:**
- Imports `createGridItem()` from grid-items.ts
- Spawns 3D models at grid positions instead of emoji sprites
- Proper disposal of geometry and materials on despawn

---

### 4. Merge with Ted's Branch (origin/ted)

Merged Ted's game systems into `rae_apr16` while preserving Rae's custom features:

**Integrated from Ted:**
- `src/weapon-system.ts` — Sword attack mechanics
- `src/projectile-system.ts` — Projectile logic
- `src/bomb-system.ts` — Bomb placement/detonation
- `src/hud-system.ts` — Head-locked VR HUD
- `src/voice-system.ts` — Voice transcription system
- `src/game-state.ts` — Centralized game state (rounds, health, scoring)
- `src/game-fx.ts` — Visual effects (pulse, flash)
- Spectator/broadcast view merged into `src/index.ts` (deleted `src/broadcast-entry.ts`)
- Scalable grid floor (responds to gridScale slider)
- Enemy AI (robots, skulls, birds) with hitboxes and damage
- Round system with pending/start/end lifecycle

**Adapted for Rae's deployment:**
- WS URL → `wss://questproto-725835663363.us-west1.run.app` (Cloud Run)
- Removed OpenAI API key and `/api/realtime-token` endpoint from `server.js`
- Dockerfile rebuilt for Cloud Run (Node 20, port 8080, ws only)

**Preserved from Rae:**
- `src/glitch-floor.ts` — Cyberpunk shader floor (re-integrated into gridScale subscriber)
- `src/grid-items.ts` — 3D neon models (re-integrated into `spawnItem` with model/sprite fallback)

---

### Files Changed

| File | Status | Description |
|------|--------|-------------|
| `README.md` | Modified | Added game rules, grid components, systems documentation |
| `src/index.ts` | Modified | GlitchFloorSystem + Ted's game systems + scalable glitch floor |
| `src/portal.ts` | Modified | 3D neon models (kind='model') + Ted's full game logic |
| `src/glitch-floor.ts` | **New** | Cyberpunk shader material and animation system |
| `src/grid-items.ts` | **New** | 3D model factory for all 13 grid item types |
| `src/weapon-system.ts` | **New** (from Ted) | Sword attack mechanics |
| `src/projectile-system.ts` | **New** (from Ted) | Projectile system |
| `src/bomb-system.ts` | **New** (from Ted) | Bomb system |
| `src/hud-system.ts` | **New** (from Ted) | VR HUD overlay |
| `src/voice-system.ts` | **New** (from Ted) | Voice transcription |
| `src/game-state.ts` | **New** (from Ted) | Game state management |
| `src/game-fx.ts` | **New** (from Ted) | Visual FX utilities |
| `src/broadcast-entry.ts` | **Deleted** | Merged into index.ts |
| `server.js` | Modified | Removed OpenAI, kept round/grid sync |
| `Dockerfile` | Modified | Cloud Run (Node 20, port 8080) |
| `portal.html` | Modified | Rae's WS URL |
| `puppet.html` | Modified | Rae's WS URL |

---

### Commits

1. `ae9f99c` — Docs: Add game rules and win conditions
2. `357437e` — Add glitch/cyberpunk shader for grid floor
3. *(this commit)* — Merge origin/ted + re-integrate neon models & glitch floor
