# 🌌 The Prototyping Void

An asymmetric multiplayer VR game where one player in VR fights to survive against classmates attacking from their phones.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)
![Platform](https://img.shields.io/badge/Platform-Meta%20Quest%20%2B%20Web-brightgreen.svg)
![Status](https://img.shields.io/badge/Status-Foundation%20Ready-blueviolet.svg)

---

## 🎮 Game Rules

**Asymmetric VR vs Mobile Gameplay**

| Role | Platform | Objective |
|------|----------|-----------|
| **Survivor** | Meta Quest (VR) | Dodge attacks and survive for 30 seconds |
| **Attackers** | Phone/Tablet (Portal) | Hit the VR player with placed objects |

### Win Conditions

- **VR Player Wins**: Survive the full 30-second round without getting hit
- **Attackers Win**: Land a hit on the VR player before time runs out

### Placement Rules

- **One item on grid at a time** — placing a new item removes the previous one
- Items spawn instantly at the selected grid cell
- VR player sees items as 3D objects in their space

---

## 📦 Attack Components

Attackers drag-and-drop items from the portal onto the 20×10 grid:

| Category | Items |
|----------|-------|
| **Shapes** | 🟦 Cube, 🔵 Sphere, 🟤 Cylinder |
| **Furniture** | 🪑 Chair, 🪵 Table, 💡 Lamp, 🌿 Plant, 🖥️ Screen |
| **Effects** | 🔥 Fire, 🌀 Portal, ⭐ Star, 🎵 Music, 🤖 Robot |

---

## ✨ What's Built

### 🎮 Core Gameplay

**Mixed-Reality Integration**
- Full AR passthrough on Quest with real-world surface detection
- Environment raycasting for object placement on physical surfaces
- Hand tracking support

**Physics Sandbox**
- Dynamic physics balls with grab and throw
- Distance grabbable objects (point and pull with trigger)
- Auto-reset when objects fall out of bounds

**Spatial Grid System**
- 20×10 meter grid floor (1m cells)
- Real-time sync between 2D planner (phone/tablet) and 3D VR view
- WebSocket-based multi-user state with Cloud Run deployment

### 👥 Multi-User Architecture

- **Presence system**: VR users appear as colored avatars with facing indicators
- **Position streaming**: 10 Hz head tracking broadcast to all connected clients
- **Quest Shared Spaces ready**: `spaceId` field for physical room colocation (Quest Browser v39+)
- **Spectator view**: `broadcast.html` shows overhead camera of the shared space

### 🎨 Player Experience

- **Companion Robot**: Tracks player head position, plays audio on click
- **Spatial Audio**: Positional sound with chime feedback
- **Locomotion**: Teleport/thumbstick movement on virtual floor surfaces

### ⚙️ Technical Foundation

**ECS Architecture**
- Entity-Component-System via `elics` with zero-allocation update loops
- Reactive signals via `@preact/signals-core`
- Sustains 72-90 FPS on Quest hardware

**Systems**
| System | Purpose |
|--------|---------|
| `PortalSystem` | WebSocket sync, grid item spawning, avatar management |
| `SyncSystem` | BroadcastChannel sync between VR and spectator views |
| `BallSystem` | Physics ball lifecycle and reset logic |
| `RobotSystem` | Companion AI head tracking |
| `SurfaceSpawnSystem` | AR surface tap to spawn objects |

**Assets**
- 3D models: Robot companion, Sansevieria plant, Desk environment
- Audio: Chime feedback
- UI: Welcome panel, message display

**Cross-Platform**
- Desktop: Browser-based XR emulation with IWER
- Quest: Native AR passthrough, hand tracking, scene understanding
- Spectator: 2D planner (phone/tablet) + broadcast view

---

## 🚀 Getting Started

**Requirements:**
- Node.js 18+
- WebXR browser (Chrome, Edge, Oculus Browser)
- Optional: Meta Quest device

**Run it:**
```bash
npm install && npm run dev
```

Dev server at `https://localhost:8081`—includes hot reload and browser-based XR emulation for rapid iteration.

---

## 🎮 Play It

**On Desktop**
Browser-based XR emulation with webcam passthrough. Full gameplay loop in 30-40ms frame windows. Perfect for iteration without hardware.

**On Quest**
Native experience with real AR passthrough, hand tracking, and scene understanding. Deploy via HTTPS tunnel or Meta Quest Link.

---

## 🏗️ Built On

**Architecture**
- **ECS Runtime**: Deterministic, cache-coherent entity-component-system with zero allocations in update loops
- **Performance-First**: Sustains 72+ FPS on Quest with <11ms frame budget across physics, input, rendering
- **Native Integration**: Seamless three.js + XR APIs with zero-copy transform binding

**Why It Matters**
VR/AR demands 11-14ms per frame. Most engines can't hit that consistently. Our ECS foundation and zero-allocation design means we can scale gameplay complexity without dropping frames—critical for commercial releases.

---

## 🎯 Next: Full Game

**Near Term**
- 🎮 Level progression and mission design
- 👥 Multiplayer synchronization (collaborative + competitive modes)
- 🎨 Advanced spatial UI and HUD systems
- 📊 Analytics and telemetry pipeline

**Medium Term**
- 🍎 iOS AR support (WebXR Level 2)
- 📱 Mobile platforms (Android native)
- 🌐 Cloud save & cross-platform progression

**Long Term**
- 🏢 Publishing and distribution tooling
- 🎬 Spatial cinematic tools
- 🤖 Procedural content generation

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Team

**Rae** • **Yoyo** • **Ted** • **Shola**

Built with [IWSDK](https://iwsdk.dev).
