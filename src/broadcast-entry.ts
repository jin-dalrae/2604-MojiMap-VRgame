// Broadcast / spectator view.
//
// Re-uses the exact same World + PortalSystem pipeline as the VR scene,
// just with no XR session and `isSpectator` set on globals — that flag
// makes PortalSystem skip every gameplay tick and act as a pure
// renderer of authoritative state coming over the WebSocket.
//
// On top of PortalSystem, this entry adds:
//   - Orbit camera (mouse drag + scroll wheel)
//   - DOM HUD overlay (timer + leaderboard) read from globals signals
//   - Floor + grid mesh + lights so the spectator isn't staring into
//     a black void
//
// Result: walls scale, bird altitudes, player jumps, weapons, and any
// future gameplay visual all appear on the broadcast for free, because
// the same code paths render them.

import {
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  AmbientLight,
  DirectionalLight,
  World,
  Vector3,
  LineSegments,
  LineBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  EnvironmentType,
  LocomotionEnvironment,
} from "@iwsdk/core";
import { PortalSystem } from "./portal.js";
import { GameState, getPlayerStats, type PlayerStat } from "./game-state.js";

async function init() {
  const container = document.getElementById("scene-container") as HTMLDivElement;

  const world = await World.create(container, {
    xr: { offer: "none" },
    features: { locomotion: false, grabbing: false, physics: false },
  });

  // Mark spectator BEFORE registering systems — PortalSystem.init
  // peeks the flag to wire callbacks (and update() bails on it).
  const globals = world.globals as Record<string, unknown>;
  GameState.isSpectator(globals).value = true;

  world.registerSystem(PortalSystem);

  const { scene, camera } = world;

  // Lights so the wall MeshStandardMaterials aren't black.
  scene.add(new AmbientLight(0xffffff, 0.7));
  const sun = new DirectionalLight(0xffffff, 0.85);
  sun.position.set(8, 12, 6);
  scene.add(sun);

  // Visible floor + grid, matched to the VR scene's 20×10 stage.
  const floorGeom = new PlaneGeometry(20, 10);
  floorGeom.rotateX(-Math.PI / 2);
  const floorMesh = new Mesh(
    floorGeom,
    new MeshBasicMaterial({ color: 0x3f3f52 }),
  );
  // A LocomotionEnvironment isn't strictly needed (no locomotion in
  // spectator), but matching the VR scene keeps the visual identical.
  world.createTransformEntity(floorMesh)
    .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

  function makeRectGrid(cols: number, rows: number, cell = 1): LineSegments {
    const halfW = (cols * cell) / 2;
    const halfD = (rows * cell) / 2;
    const verts: number[] = [];
    for (let i = 0; i <= cols; i++) {
      const x = -halfW + i * cell;
      verts.push(x, 0, -halfD, x, 0, halfD);
    }
    for (let j = 0; j <= rows; j++) {
      const z = -halfD + j * cell;
      verts.push(-halfW, 0, z, halfW, 0, z);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(verts, 3));
    return new LineSegments(geo, new LineBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.8 }));
  }
  const gridLines = makeRectGrid(20, 10, 1);
  gridLines.position.y = 0.01;
  world.createTransformEntity(gridLines);

  // ── Spectator camera (orbit) ───────────────────────────────
  let alpha = Math.PI / 2;
  let beta = Math.PI / 3.5;
  let radius = 20;
  const target = new Vector3(0, 0.6, 0);

  function placeCamera() {
    beta = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, beta));
    camera.position.x = target.x + radius * Math.cos(alpha) * Math.cos(beta);
    camera.position.y = target.y + radius * Math.sin(beta);
    camera.position.z = target.z + radius * Math.sin(alpha) * Math.cos(beta);
    camera.lookAt(target);
  }
  placeCamera();

  let dragging = false;
  let lastX = 0, lastY = 0;
  container.addEventListener("mousedown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    alpha -= (e.clientX - lastX) * 0.01;
    beta  += (e.clientY - lastY) * 0.01;
    placeCamera();
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener("mouseup", () => { dragging = false; });
  container.addEventListener("wheel", (e) => {
    radius = Math.max(4, Math.min(60, radius + e.deltaY * 0.025));
    placeCamera();
  }, { passive: true });

  // ── HUD overlay ────────────────────────────────────────────
  const hud = document.getElementById("overlay")!;
  const USER_COLORS = [0x6366f1, 0xec4899, 0xf59e0b, 0x10b981, 0x3b82f6, 0xef4444, 0xa855f7, 0x14b8a6];
  function colorForUser(userId: string): number {
    let h = 0;
    for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
    return USER_COLORS[Math.abs(h) % USER_COLORS.length];
  }

  function renderHUD() {
    const running = GameState.roundRunning(globals).peek();
    const endsAt  = GameState.roundEndsAt(globals).peek();

    let timerHtml = '<span style="color:#71717a">— : —</span>';
    if (running && endsAt > 0) {
      const remaining = Math.max(0, (endsAt - Date.now()) / 1000);
      const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
      const ss = String(Math.floor(remaining % 60)).padStart(2, "0");
      const color = remaining <= 5 ? "#ef4444" : remaining <= 10 ? "#f59e0b" : "#10b981";
      timerHtml = `<span style="color:${color}">${mm}:${ss}</span>`;
    }

    const stats = getPlayerStats(globals);
    const ranked: Array<[string, PlayerStat]> = [...stats.entries()];
    ranked.sort((a, b) => {
      if (a[1].goalsCollected !== b[1].goalsCollected) return b[1].goalsCollected - a[1].goalsCollected;
      return b[1].score - a[1].score;
    });

    const rows = ranked.length === 0
      ? '<div style="color:#71717a;font-size:11px;font-style:italic;margin-top:6px">No VR players yet</div>'
      : ranked.map(([uid, s], i) => {
          const color = "#" + colorForUser(uid).toString(16).padStart(6, "0");
          const short = uid.slice(0, 6);
          const progress = s.goalsTotal > 0 ? `${s.goalsCollected}/${s.goalsTotal}` : String(s.score);
          const hp = Math.ceil(s.health);
          const hpCol = hp <= 25 ? "#ef4444" : hp <= 50 ? "#f59e0b" : "#a1a1aa";
          const dim = s.dead ? "opacity:0.4;text-decoration:line-through;" : "";
          const rank = i === 0 ? "color:#fbbf24;font-weight:700;" : "color:#f4f4f5;";
          return (
            `<div style="display:grid;grid-template-columns:10px 1fr auto auto;gap:8px;align-items:center;padding:3px 0;${dim}">` +
              `<span style="width:10px;height:10px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color};"></span>` +
              `<span style="font-family:ui-monospace,monospace;font-size:11px;${rank}">${short}</span>` +
              `<span style="color:#fbbf24;font-weight:700;font-family:ui-monospace,monospace">⭐ ${progress}</span>` +
              `<span style="color:${hpCol};font-size:10px;font-family:ui-monospace,monospace">❤ ${hp}</span>` +
            `</div>`
          );
        }).join("");

    hud.innerHTML =
      `<div style="font-size:11px;font-weight:bold;color:#6366f1">` +
        `<span style="display:inline-block;width:8px;height:8px;background:#ef4444;border-radius:50%;margin-right:5px;animation:pulse 1s infinite"></span> LIVE BROADCAST` +
      `</div>` +
      `<div style="font-size:10px;color:#a1a1aa;margin-top:4px">Spectator View — Drag to orbit</div>` +
      `<div style="margin-top:10px;text-align:center;font-family:ui-monospace,monospace;font-size:32px;font-weight:700">${timerHtml}</div>` +
      `<div style="margin-top:10px;border-top:1px solid #3f3f46;padding-top:8px;min-width:200px">${rows}</div>`;
  }

  function hudLoop() {
    renderHUD();
    setTimeout(hudLoop, 200);
  }
  hudLoop();

  console.log("Broadcast Mode Initialized (spectator)");
}

init();
