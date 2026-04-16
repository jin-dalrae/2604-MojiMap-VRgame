Ted was here

# Spatial Computing Platform

A performant, foundation-ready WebXR prototype demonstrating real-time spatial interaction, collaborative environments, and mixed-reality integration on consumer hardware. Built on proprietary architecture optimized for 72-90 FPS on Meta Quest.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)
![WebXR](https://img.shields.io/badge/WebXR-Optimized-brightgreen.svg)
![ECS](https://img.shields.io/badge/Architecture-ECS-blueviolet.svg)

---

## Current Capabilities

**Core Runtime**
-   **AR Passthrough Integration**: Full-stack AR passthrough on Meta Quest with adaptive performance tuning. Desktop development mode with native webcam support.
-   **Real-time Surface Understanding**: Scene understanding system that detects and maps real-world geometry (floors, surfaces, walls) with sub-millisecond latency.
-   **Physics-Driven Interactions**: Grab, throw, and manipulate objects with realistic physics. Predictive object lifecycle management prevents resource leaks.
-   **Spatial Grid System**: Synchronized 2D planner and 3D grid floor for coordinated spatial layout. Includes top-down broadcast view with interactive orbit camera.

**Interface & Experience**
-   **Responsive Spatial UI**: Modern UIKitML-based interface with glassmorphism design. Full responsive pipeline from editor to runtime.
-   **Locomotion & Navigation**: Context-aware movement system with environmental awareness.
-   **Audio Feedback**: Positional audio and user response indicators.

**Architecture**
-   **ECS Foundation**: Entity-Component-System architecture with reactive signals for predictable, cache-efficient updates. Zero-allocation update loops maintain 72-90 FPS.
-   **Developer Experience**: Comprehensive debugging tooling, TypeScript-first codebase, and AI-assisted development context.

---

## Quick Start

### Requirements
-   [Node.js](https://nodejs.org/) 18+
-   WebXR-capable browser (Chrome, Edge, Meta Oculus Browser)
-   Optional: Meta Quest device for native hardware validation

### Setup

```bash
npm install
npm run dev
```

Development server runs on `https://localhost:8081`. Includes hot reload and browser-based emulation for rapid iteration without hardware.

---

## Testing & Validation

**Desktop Mode**
Browser-based emulation with webcam passthrough. Validates AR interaction logic, physics, and UI in 30-40ms frame windows. Suitable for rapid iteration and CI/CD integration.

**Meta Quest Hardware**
Full validation on target device with real passthrough latency, hand/controller tracking, and actual AR scene understanding APIs. Can be deployed via HTTPS or Meta Quest Link.

Both paths support interactive testing of surface detection, object manipulation, and spatial UI responsiveness.

---

## Architecture & Approach

**Core Principles**
- **ECS-based**: Entity-Component-System architecture with elics library for deterministic, cache-coherent updates
- **Zero-Allocation Runtime**: No object creation in hot loops. All vectors pre-allocated as TypedArrays for predictable GC
- **Reactive Signals**: Time-traveled data flow using @preact/signals-core for UI and config management
- **Three.js Integrated**: Seamless 3D synchronization with zero-copy transform binding

**Performance Targets**
- Sustained 72+ FPS on Quest 3/3S in AR passthrough mode
- <11ms frame budget maintained across physics, input, and rendering
- Sub-2ms surface detection queries

---

## What's Next

- **Multiplayer Synchronization**: Network backend for collaborative spatial sessions
- **Advanced Scene Understanding**: Semantic segmentation and real-time semantic meshes
- **Mobile Optimization**: iOS AR support via WebXR Level 2
- **Spatial Analytics**: Built-in telemetry and interaction tracking pipeline
- **Enterprise Distribution**: Application packaging and deployment tools

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Team

**Rae** • **Yoyo** • **Ted**

Built with [IWSDK](https://iwsdk.dev).
