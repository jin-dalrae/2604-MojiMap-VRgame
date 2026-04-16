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

### Files Changed

| File | Status | Description |
|------|--------|-------------|
| `README.md` | Modified | Added game rules, grid components, systems documentation |
| `src/index.ts` | Modified | Uses GlitchFloorSystem, removed old grid line rendering |
| `src/glitch-floor.ts` | **New** | Cyberpunk shader material and animation system |
| `src/grid-items.ts` | **New** | 3D model factory for all 13 grid item types |
| `src/portal.ts` | Modified | Spawns 3D models instead of emoji sprites |

---

### Commits

1. `ae9f99c` — Docs: Add game rules and win conditions
2. `357437e` — Add glitch/cyberpunk shader for grid floor
3. *(pending)* — Replace emoji sprites with 3D neon models for grid items
