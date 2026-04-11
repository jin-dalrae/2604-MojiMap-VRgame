# 🌌 The Prototyping Void: Quest AR Playground

A premium, high-performance WebXR prototype built with the **Immersive Web SDK (IWSDK)**. This project demonstrates advanced spatial features like AR passthrough, environment hit-testing, and complex physics-driven interactions within a modern ECS architecture.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-0.1.0-orange.svg)
![WebXR](https://img.shields.io/badge/WebXR-Tested-brightgreen.svg)

---

## 🚀 Features

-   **🔀 Immersive AR Passthrough**: Optimized for Meta Quest passthrough, with native desktop webcam support for local iteration.
-   **🎯 Surface Spawner System**: A custom system that detects real-world surfaces (floors, tables, walls) and provides a visual hit-test reticle.
-   **☄️ Physics Playground**: Grab, throw, and interact with physics-enabled objects. Balls automatically reset if they fall out of the workspace.
-   **🎨 Premium Spatial UI**: A modern, glassmorphism-inspired UI built with UIKitML, featuring indigo accents and responsive animations.
-   **🤖 Context-Aware Robot**: A helpful spatial companion that tracks user head movement and provides audio feedback.
-   **🛠️ AI-Optimized**: Pre-configured with rich context (AGENTS.md) for AI coding assistants to help you build faster.

---

## 🏁 Getting Started

### Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or higher)
-   A WebXR-capable browser (Chrome, Edge, or Oculus Browser)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/jin-dalrae/2604-quest-prototyping.git
   cd 2604-quest-prototyping
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Local Development

Start the Vite development server:
```bash
npm run dev
```

The application will be available at `http://localhost:8081`.

---

## 🧪 How to Test

### 1. Desktop (Emulated AR)
This project is configured to use your **webcam** as the passthrough background for fast development. 
- Open `http://localhost:8081` in your browser.
- Click **"Initialize XR Space"**.
- Grant camera permissions to see the 3D objects overlaid on your room.
- **Controls**:
  - `Click/Space`: Trigger right controller (Spawns a ball at the reticle).
  - `WASD`: Move around.
  - `Mouse`: Look around.

### 2. Meta Quest (Native AR)
To experience the full power of native passthrough:
- Use [Meta Quest Link](https://www.meta.com/quest/setup/) or serve the project over HTTPS (using tools like `ngrok` or a local tunnel).
- Access the URL via the **Oculus Browser**.
- Click **"Initialize XR Space"** to enter passthrough AR.

---

## 📂 Project Structure

```text
├── src/
│   ├── index.ts        # World entry point & system registration
│   ├── ball.ts         # Physics ball system & factory
│   ├── spawn.ts        # AR surface detection & spawning logic
│   ├── robot.ts        # Robot behaviors & tracking
│   └── panel.ts        # UI logic & XR session management
├── ui/                 # UIKitML source files (Spatial UI)
├── public/             # Static assets (3D models, audio, textures)
└── AGENTS.md           # Developer guidelines for AI assistants
```

---

## 📖 Development Guidelines

-   **ECS First**: Always use EliCS systems and components for game logic.
-   **Zero Allocation**: Avoid objects creation in `update()` loops to maintain 72-90 FPS in XR.
-   **UI Changes**: Edit files in `ui/*.uikitml`. Changes are automatically compiled to JSON in `public/ui/`.

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

*Built with ❤️ using [IWSDK](https://iwsdk.dev) by jin-dalrae.*
