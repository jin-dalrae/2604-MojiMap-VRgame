# Rae's Changes

## Session: April 16, 2026

### 1. Game Rules Documentation
Updated `README.md` with specific game mechanics: asymmetric gameplay (VR Survivor vs Mobile Attackers), 30-second rounds, and win conditions.

### 2. Glitch/Cyberpunk Floor Shader
Created `src/glitch-floor.ts`. Features cyan neon grids, magenta circuit traces with data packets, scanlines, and camera glitches. Re-integrated into the active level's gridScale subscriber.

### 3. Ultimate 3D Model Integration
Replaced ALL 2D emojis with high-fidelity, procedurally generated 3D neon models from `src/grid-items.ts`:
- **Enemies**: `robot` (boxy bot), `ghost` (glowing dome), `skull` (boxy head with red eyes).
- **Wildlife**: `bird` (faceted neon eagle with wings).
- **Weapons**: `sword` (neon blade + hilt), `gun` (neon barrel), `poo` (layered neon torus), `feather`.
- **Decor**: `cube`, `sphere`, `star`, `fire`, `portal`, `music`, `chair`, `lamp`, etc.

### 4. Continuous Wall System (VR & Portal)
- **VR Scene**: Walls now have a width of 1.0 (filling cells). A "Connection System" checks neighbors and spawns filler geometry between adjacent walls to create a seamless, solid block look.
- **2D Portal**: The 2D grid now removes borders between identical wall types, visually merging them into "continuous" structures to match the 3D reality.

### 5. Dedicated Mobile Portal (/portal-mobile)
- **Voxel Aesthetic**: Grid cells now use CSS 3D transforms and shadows to look like raised blocks.
- **Mobile Optimized**: Palette moved to the bottom as a horizontal scrollable strip. Large 50px cells for touch precision.
- **Horizontal Scroll**: The grid scales to accommodate 20x10 cells while remaining scrollable on mobile browsers.

### Files Changed
| File | Description |
|------|-------------|
| `src/portal.ts` | Complete logic overhaul for 3D models and continuous walls. |
| `src/grid-items.ts` | Expanded with 3D models for all 13+ palette items. |
| `portal-mobile.html` | New 3D/Voxel themed mobile attacker interface. |
| `rae_changes.md` | Log of all improvements. |

---

### Commits
1. `ae9f99c` — Docs: Add game rules and win conditions
2. `357437e` — Add glitch/cyberpunk shader for grid floor
3. `7e13cc5` — Merge origin/ted + re-integrate neon models & glitch floor
4. `f20e8fd` — Add dedicated /portal-mobile route and mobile-optimized UI
5. *(this commit)* — Full 3D model integration and continuous wall system
