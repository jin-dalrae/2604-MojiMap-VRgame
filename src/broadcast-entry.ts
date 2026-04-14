// Broadcast / spectator view.
//
// This is intentionally a *copy* of index.ts (the VR scene). Same World
// setup, same systems, same floor + grid. The only differences:
//
//   1. No XR session offered — there's no headset on the broadcast page.
//   2. globals.isSpectator = true BEFORE registering systems, so
//      PortalSystem and friends bail out of every gameplay tick — they
//      become passive renderers of state coming over the WebSocket.
//   3. HUDSystem and VoiceSystem are skipped — the head-locked HUD has
//      no head to attach to here, and we don't want the broadcast to
//      open a microphone.
//   4. An orbit camera + DOM HUD overlay are layered on top.
//
// Net effect: walls, birds, weapons, players, jumps, the chair beacon
// — anything the VR scene draws — appear here automatically because
// the same code paths render them.

import {
  Mesh,
  PlaneGeometry,
  World,
  LineSegments,
  LineBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  MeshStandardMaterial,
  AmbientLight,
  DirectionalLight,
  Vector3,
} from "@iwsdk/core";

import { PortalSystem } from "./portal.js";
import { SyncSystem } from "./sync.js";
import { WeaponSystem } from "./weapon-system.js";
import { ProjectileSystem } from "./projectile-system.js";
import { BombSystem } from "./bomb-system.js";
import { GameState, getPlayerStats, type PlayerStat } from "./game-state.js";

World.create(document.getElementById("scene-container") as HTMLDivElement, {
  // No XR session — broadcast renders flat. `offer: 'none'` ensures the
  // "Enter XR" button never appears.
  xr: { offer: "none" },
  features: {
    locomotion: false,
    grabbing: false,
    physics: false,
  },
}).then((world) => {
  const { scene, camera } = world;
  const globals = world.globals as Record<string, unknown>;

  // Mark this client as a spectator BEFORE registering systems —
  // PortalSystem.update() bails on this flag and the ITEM_STATES handler
  // only runs in spectator mode.
  GameState.isSpectator(globals).value = true;

  world
    .registerSystem(PortalSystem)
    .registerSystem(SyncSystem)
    .registerSystem(WeaponSystem)
    .registerSystem(ProjectileSystem)
    .registerSystem(BombSystem);
  // VoiceSystem skipped: no mic for spectator.
  // HUDSystem  skipped: head-locked HUD has nothing to attach to.

  // Lights so MeshStandardMaterial walls aren't pitch black on flat view.
  scene.add(new AmbientLight(0xffffff, 0.7));
  const sun = new DirectionalLight(0xffffff, 0.85);
  sun.position.set(8, 12, 6);
  scene.add(sun);

  // ── Same grid + floor as index.ts ──────────────────────────
  {
    const cols = 20, rows = 10, cell = 1;
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
    const mat = new LineBasicMaterial({
      color: 0x6366f1, transparent: true, opacity: 0.8,
    });
    const gridLines = new LineSegments(geo, mat);
    gridLines.position.y = 0.01;
    world.createTransformEntity(gridLines);
  }

  const floorGeom = new PlaneGeometry(20, 10);
  floorGeom.rotateX(-Math.PI / 2);
  const floorMat = new MeshStandardMaterial({
    color: 0x09090b, transparent: true, opacity: 0.35, roughness: 1.0,
  });
  const floorMesh = new Mesh(floorGeom, floorMat);
  world.createTransformEntity(floorMesh);

  // ── Spectator orbit camera (overrides default after a frame) ──
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

  let dragging = false; let lastX = 0, lastY = 0;
  const container = document.getElementById("scene-container") as HTMLDivElement;
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

    const ranked: Array<[string, PlayerStat]> = [...getPlayerStats(globals).entries()];
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
  function hudLoop() { renderHUD(); setTimeout(hudLoop, 200); }
  hudLoop();

  console.log("Broadcast initialized — spectator");
});
