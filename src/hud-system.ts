// HUDSystem — head-locked status HUD.
//
// The main HUD panel is parented directly to `player.head` so it tracks
// the head rig 1:1 with zero lag — a true fixed HUD rather than a
// follower-smoothed one. We position it below the viewing center so it
// doesn't block the play area.
//
// Result banner (end-of-round) and Game-Over banner (local death mid-
// round) are separate head-locked meshes toggled by signal subscriptions.

import {
  createSystem,
  Mesh,
  PlaneGeometry,
  MeshBasicMaterial,
  CanvasTexture,
  DoubleSide,
} from "@iwsdk/core";
import {
  GameState,
  MAX_HEALTH,
  DAMAGE_FLASH_MS,
  type RoundResult,
  type RoundEndReason,
} from "./game-state.js";

const CANVAS_W = 512;
const CANVAS_H = 128;
const PANEL_W  = 0.44;  // meters — trimmed so it sits unobtrusively at bottom
const PANEL_H  = 0.11;
// Bottom-center of the forward view. x=0 is center, y<0 is below the
// head's horizon plane, z<0 is forward.
const PANEL_OFFSET: [number, number, number] = [0, -0.32, -0.9];

const RESULT_CANVAS_W = 1024;
const RESULT_CANVAS_H = 384;
const RESULT_PANEL_W  = 1.2;
const RESULT_PANEL_H  = 0.45;
// Centered, eye-level, further out so the result panel reads big.
const RESULT_OFFSET: [number, number, number] = [0, 0.05, -1.8];

const DEAD_CANVAS_W = 1024;
const DEAD_CANVAS_H = 256;
const DEAD_PANEL_W  = 1.1;
const DEAD_PANEL_H  = 0.28;
const DEAD_OFFSET: [number, number, number] = [0, 0.12, -1.4];

// Ready-check banner — shown while the portal has requested a round
// and this VR client hasn't confirmed at the chair yet.
const READY_CANVAS_W = 1024;
const READY_CANVAS_H = 256;
const READY_PANEL_W  = 1.0;
const READY_PANEL_H  = 0.25;
const READY_OFFSET: [number, number, number] = [0, 0.1, -1.3];

export class HUDSystem extends createSystem({}) {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;
  private lastDraw = 0;

  private resultCanvas!: HTMLCanvasElement;
  private resultCtx!: CanvasRenderingContext2D;
  private resultTexture!: CanvasTexture;
  private resultMesh!: Mesh;

  private deadCanvas!: HTMLCanvasElement;
  private deadCtx!: CanvasRenderingContext2D;
  private deadTexture!: CanvasTexture;
  private deadMesh!: Mesh;

  private readyCanvas!: HTMLCanvasElement;
  private readyCtx!: CanvasRenderingContext2D;
  private readyTexture!: CanvasTexture;
  private readyMesh!: Mesh;

  // Full-view red flash when the player takes a hit. Just a large
  // quad close to the near-plane; opacity is animated per frame.
  private flashMesh!: Mesh;
  private flashMat!: MeshBasicMaterial;
  private flashStartAt = 0;

  // Screen shake — applied as a small damped-random roll (and tiny
  // head bob via pitch) on the XROrigin. Kept short + small so VR
  // doesn't nauseate the player.
  private shakeStartAt = 0;
  private shakeBaseZ = 0;
  private shakeBaseX = 0;
  private readonly SHAKE_MS = 260;

  init() {
    // ── Main HUD panel ───────────────────────────────────────────
    // Parented to player.head so it moves 1:1 with head tracking.
    // No Follower, no smoothing — a real fixed HUD.
    this.canvas = document.createElement("canvas");
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext("2d")!;

    this.texture = new CanvasTexture(this.canvas);
    const mat = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
    });
    const mesh = new Mesh(new PlaneGeometry(PANEL_W, PANEL_H), mat);
    mesh.renderOrder = 999;
    mesh.position.set(...PANEL_OFFSET);
    this.player.head.add(mesh);

    this.redraw();
    this.initResultPanel();
    this.initDeadPanel();
    this.initReadyPanel();
    this.initFlashPanel();
  }

  private initFlashPanel() {
    // Large quad close to the near plane — fills the view at z=-0.35.
    // DoubleSide so it renders whichever way the head is facing if the
    // plane ever flips. Transparent + depthTest off so it overlays
    // everything.
    this.flashMat = new MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0,
      depthTest: false,
      side: DoubleSide,
    });
    this.flashMesh = new Mesh(new PlaneGeometry(2.4, 1.8), this.flashMat);
    this.flashMesh.renderOrder = 1100;
    this.flashMesh.position.set(0, 0, -0.35);
    this.player.head.add(this.flashMesh);

    const lastDmg = GameState.lastDamageAt(this.world.globals as Record<string, unknown>);
    this.cleanupFuncs.push(
      lastDmg.subscribe((ms) => {
        if (ms <= 0) return;
        const now = performance.now();
        console.log(`[HUD] hit received — flash + shake`);
        this.flashStartAt = now;
        // Capture current XROrigin rotation so we can restore it post-shake
        // without clobbering any yaw the locomotion system may have set.
        if (this.shakeStartAt === 0) {
          this.shakeBaseZ = this.player.rotation.z;
          this.shakeBaseX = this.player.rotation.x;
        }
        this.shakeStartAt = now;
      }),
    );
  }

  // Per-frame flash fade — runs even between 10 Hz HUD redraws so the
  // animation looks smooth.
  private tickFlash() {
    if (this.flashStartAt === 0) {
      if (this.flashMat.opacity !== 0) this.flashMat.opacity = 0;
      return;
    }
    const t = (performance.now() - this.flashStartAt) / DAMAGE_FLASH_MS;
    if (t >= 1) {
      this.flashMat.opacity = 0;
      this.flashStartAt = 0;
      return;
    }
    // Peak 0.55 at t=0, fade to 0 with easing so the tail feels soft.
    this.flashMat.opacity = 0.55 * (1 - t) * (1 - t);
  }

  // Per-frame shake decay — damped random XZ roll on the XROrigin.
  // Max amplitude ~3° roll, ~2° pitch; short enough to read as "impact"
  // without triggering motion sickness.
  private tickShake() {
    if (this.shakeStartAt === 0) return;
    const elapsed = performance.now() - this.shakeStartAt;
    if (elapsed >= this.SHAKE_MS) {
      this.player.rotation.z = this.shakeBaseZ;
      this.player.rotation.x = this.shakeBaseX;
      this.shakeStartAt = 0;
      return;
    }
    const t = elapsed / this.SHAKE_MS;           // 0..1
    const damp = (1 - t) * (1 - t);              // ease-out
    const ampZ = 0.055 * damp;
    const ampX = 0.035 * damp;
    this.player.rotation.z = this.shakeBaseZ + (Math.random() - 0.5) * 2 * ampZ;
    this.player.rotation.x = this.shakeBaseX + (Math.random() - 0.5) * 2 * ampX;
  }

  private initResultPanel() {
    this.resultCanvas = document.createElement("canvas");
    this.resultCanvas.width = RESULT_CANVAS_W;
    this.resultCanvas.height = RESULT_CANVAS_H;
    this.resultCtx = this.resultCanvas.getContext("2d")!;
    this.resultTexture = new CanvasTexture(this.resultCanvas);

    const mat = new MeshBasicMaterial({
      map: this.resultTexture,
      transparent: true,
      depthTest: false,
    });
    this.resultMesh = new Mesh(
      new PlaneGeometry(RESULT_PANEL_W, RESULT_PANEL_H),
      mat,
    );
    this.resultMesh.renderOrder = 1000;
    this.resultMesh.visible = false;
    this.resultMesh.position.set(...RESULT_OFFSET);
    this.player.head.add(this.resultMesh);

    const globals = this.world.globals as Record<string, unknown>;
    const result = GameState.roundResult(globals);
    this.cleanupFuncs.push(
      result.subscribe((r) => {
        if (r) {
          this.drawResult(r);
          this.resultMesh.visible = true;
        } else {
          this.resultMesh.visible = false;
        }
      }),
    );
  }

  private initDeadPanel() {
    this.deadCanvas = document.createElement("canvas");
    this.deadCanvas.width = DEAD_CANVAS_W;
    this.deadCanvas.height = DEAD_CANVAS_H;
    this.deadCtx = this.deadCanvas.getContext("2d")!;
    this.deadTexture = new CanvasTexture(this.deadCanvas);

    const mat = new MeshBasicMaterial({
      map: this.deadTexture,
      transparent: true,
      depthTest: false,
    });
    this.deadMesh = new Mesh(
      new PlaneGeometry(DEAD_PANEL_W, DEAD_PANEL_H),
      mat,
    );
    this.deadMesh.renderOrder = 1001;
    this.deadMesh.visible = false;
    this.deadMesh.position.set(...DEAD_OFFSET);
    this.player.head.add(this.deadMesh);

    this.drawDead();

    const globals = this.world.globals as Record<string, unknown>;
    const isDead = GameState.isDead(globals);
    this.cleanupFuncs.push(
      isDead.subscribe((d) => {
        this.deadMesh.visible = d;
      }),
    );
  }

  private initReadyPanel() {
    this.readyCanvas = document.createElement("canvas");
    this.readyCanvas.width = READY_CANVAS_W;
    this.readyCanvas.height = READY_CANVAS_H;
    this.readyCtx = this.readyCanvas.getContext("2d")!;
    this.readyTexture = new CanvasTexture(this.readyCanvas);

    const mat = new MeshBasicMaterial({
      map: this.readyTexture,
      transparent: true,
      depthTest: false,
    });
    this.readyMesh = new Mesh(
      new PlaneGeometry(READY_PANEL_W, READY_PANEL_H),
      mat,
    );
    this.readyMesh.renderOrder = 1002;
    this.readyMesh.visible = false;
    this.readyMesh.position.set(...READY_OFFSET);
    this.player.head.add(this.readyMesh);

    this.drawReady();

    const globals = this.world.globals as Record<string, unknown>;
    const pending = GameState.roundPending(globals);
    this.cleanupFuncs.push(
      pending.subscribe((p) => {
        this.readyMesh.visible = p;
      }),
    );
  }

  private drawReady() {
    const ctx = this.readyCtx;
    const W = READY_CANVAS_W, H = READY_CANVAS_H;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = "rgba(12,12,16,0.88)";
    roundedRect(ctx, 0, 0, W, H, 32);
    ctx.fill();
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 6;
    roundedRect(ctx, 4, 4, W - 8, H - 8, 28);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fbbf24";
    ctx.font = 'bold 72px "Apple Color Emoji", system-ui, sans-serif';
    ctx.fillText("🪑 MOVE TO CHAIR", W / 2, 96);

    ctx.fillStyle = "#f4f4f5";
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.fillText("Pull TRIGGER to start round", W / 2, 180);

    this.readyTexture.needsUpdate = true;
  }

  update(_delta: number, time: number) {
    // Red flash + screen shake both run every frame for smooth motion.
    this.tickFlash();
    this.tickShake();

    // 10 Hz redraw — seconds digit is the highest-frequency thing.
    if (time - this.lastDraw < 0.1) return;
    this.lastDraw = time;
    this.redraw();

    // Auto-retire the result panel. HUDSystem owns lifetime; clearing
    // the signal drops the subscription back to the hidden state.
    const result = GameState.roundResult(this.world.globals as Record<string, unknown>);
    const r = result.peek();
    if (r && Date.now() >= r.expiresAt) {
      result.value = null;
    }
  }

  private redraw() {
    const g = this.world.globals as Record<string, unknown>;
    const running = GameState.roundRunning(g).peek();
    const endsAt  = GameState.roundEndsAt(g).peek();
    const score   = GameState.score(g).peek();
    const health     = GameState.playerHealth(g).peek();
    const maxHealth  = GameState.playerMaxHealth(g).peek();
    const goalsTotal     = GameState.goalsTotal(g).peek();
    const goalsCollected = GameState.goalsCollected(g).peek();

    const remaining = running ? Math.max(0, (endsAt - Date.now()) / 1000) : 0;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Rounded translucent background
    ctx.fillStyle = "rgba(12,12,16,0.72)";
    roundedRect(ctx, 0, 0, CANVAS_W, CANVAS_H, 24);
    ctx.fill();

    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    // Timer
    const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
    const ss = String(Math.floor(remaining % 60)).padStart(2, "0");
    const timerColor =
      !running ? "#71717a" :
      remaining <= 5 ? "#ef4444" :
      remaining <= 10 ? "#f59e0b" :
      "#10b981";
    ctx.fillStyle = timerColor;
    ctx.font = 'bold 64px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(`${mm}:${ss}`, 28, 66);

    // Score readout — goal progress when this round has goals, otherwise
    // raw score. Keeps the HUD from misleading on survival rounds.
    ctx.fillStyle = "#fbbf24";
    ctx.font = 'bold 44px "Apple Color Emoji", system-ui, sans-serif';
    ctx.fillText("⭐", 210, 64);
    ctx.fillStyle = "#f4f4f5";
    ctx.font = 'bold 52px ui-monospace, SFMono-Regular, Menlo, monospace';
    const scoreText = goalsTotal > 0 ? `${goalsCollected}/${goalsTotal}` : String(score);
    ctx.fillText(scoreText, 260, 66);

    // Discrete life hearts — one per life point. Filled ❤ up to
    // current health, empty 🤍 to the live max (which bumps up with
    // each 🍄 pickup). Drawn right-aligned so the row flexes with
    // mushroom pickups without reflowing the timer/score block.
    const livesRightEdge = CANVAS_W - 20;
    const heartStep = 30;                   // px between heart glyphs
    const heartY = 66;
    const lives = Math.max(0, Math.ceil(health));
    const cap   = Math.max(MAX_HEALTH, Math.ceil(maxHealth));
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = 'bold 26px "Apple Color Emoji", system-ui, sans-serif';
    for (let i = 0; i < cap; i++) {
      // i=0 is the rightmost heart; we walk leftward so the line stays
      // anchored to livesRightEdge.
      const x = livesRightEdge - i * heartStep;
      ctx.fillStyle = i < lives ? "#ef4444" : "rgba(200,200,200,0.35)";
      ctx.fillText(i < lives ? "❤" : "♡", x, heartY);
    }

    this.texture.needsUpdate = true;
  }

  private drawResult(r: RoundResult) {
    const ctx = this.resultCtx;
    const W = RESULT_CANVAS_W, H = RESULT_CANVAS_H;
    ctx.clearRect(0, 0, W, H);

    const accent = RESULT_COLORS[r.reason] ?? "#71717a";

    ctx.fillStyle = "rgba(12,12,16,0.88)";
    roundedRect(ctx, 0, 0, W, H, 40);
    ctx.fill();

    ctx.strokeStyle = accent;
    ctx.lineWidth = 8;
    roundedRect(ctx, 6, 6, W - 12, H - 12, 34);
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.font = 'bold 136px system-ui, -apple-system, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(RESULT_TITLES[r.reason] ?? "ROUND OVER", W / 2, 140);

    ctx.fillStyle = "#fbbf24";
    ctx.font = 'bold 72px "Apple Color Emoji", system-ui, sans-serif';
    ctx.fillText("⭐", W / 2 - 110, 290);
    ctx.fillStyle = "#f4f4f5";
    ctx.font = 'bold 92px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = "left";
    ctx.fillText(String(r.score), W / 2 - 50, 293);

    this.resultTexture.needsUpdate = true;
  }

  private drawDead() {
    const ctx = this.deadCtx;
    const W = DEAD_CANVAS_W, H = DEAD_CANVAS_H;
    ctx.clearRect(0, 0, W, H);

    // Dark red vignette backdrop so it reads as "bad outcome"
    ctx.fillStyle = "rgba(0,0,0,0.82)";
    roundedRect(ctx, 0, 0, W, H, 32);
    ctx.fill();
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 6;
    roundedRect(ctx, 4, 4, W - 8, H - 8, 28);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ef4444";
    ctx.font = 'bold 108px system-ui, -apple-system, sans-serif';
    ctx.fillText("GAME OVER", W / 2, 110);

    ctx.fillStyle = "#f4f4f5";
    ctx.font = 'italic 36px system-ui, sans-serif';
    ctx.fillText("Spectating · round continues", W / 2, 200);

    this.deadTexture.needsUpdate = true;
  }
}

const RESULT_TITLES: Record<RoundEndReason, string> = {
  completed: "VICTORY",
  died: "YOU DIED",
  timeout: "TIME'S UP",
  "host-stopped": "ROUND ENDED",
};

const RESULT_COLORS: Record<RoundEndReason, string> = {
  completed: "#10b981",
  died: "#ef4444",
  timeout: "#f59e0b",
  "host-stopped": "#a1a1aa",
};

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
