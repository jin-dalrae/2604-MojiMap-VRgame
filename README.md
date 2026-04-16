# 🌌 The Prototyping Void

A high-fidelity spatial sandbox game for Meta Quest. Real-time AR, physics-driven gameplay, and a responsive spatial UI built on a performant ECS architecture. Demonstrating next-gen mixed-reality experiences on consumer hardware.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)
![Platform](https://img.shields.io/badge/Platform-Meta%20Quest%20%2B%20Web-brightgreen.svg)
![Status](https://img.shields.io/badge/Status-Foundation%20Ready-blueviolet.svg)

---

## ✨ What's Built

🎮 **Core Gameplay**
- **Mixed-Reality Integration**: Full AR passthrough on Quest with real-world surface detection and object placement
- **Physics Sandbox**: Grab, throw, and manipulate objects with realistic physics simulation
- **Spatial Grid System**: 2D planner and synchronized 3D grid environment with broadcast/spectator view

🎨 **Player Experience**
- **Responsive Spatial UI**: Modern, glassmorphic interface with smooth animations
- **Spatial Audio**: Positional sound design for immersive feedback
- **Companion AI**: Context-aware robot that tracks player movement and provides live feedback

⚙️ **Technical Foundation**
- **ECS Architecture**: Entity-Component-System with zero-allocation update loops, sustains 72-90 FPS on Quest
- **Cross-Platform**: Desktop development mode with webcam emulation, full-featured on Meta Quest hardware
- **Developer-First**: Comprehensive debugging tools, AI-assisted development context, hot reload

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
