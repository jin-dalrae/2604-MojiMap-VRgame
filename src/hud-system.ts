// HUDSystem — head-locked status panel showing timer, score, health.
//
// Implementation: a plane mesh textured from a 2D canvas, followed by
// the player's head via the Follower component. Canvas redraws at 10 Hz
// (the timer's second resolution doesn't need 60 Hz updates).

import {
  createSystem,
  Mesh,
  PlaneGeometry,
  MeshBasicMaterial,
  CanvasTexture,
  Follower,
  FollowBehavior,
} from "@iwsdk/core";
import {
  GameState,
  MAX_HEALTH,
  type RoundResult,
  type RoundEndReason,
} from "./game-state.js";

const CANVAS_W = 512;
const CANVAS_H = 128;
const PANEL_W  = 0.5;  // meters
const PANEL_H  = 0.125;

// Result overlay — larger, centered further out so it dominates vision.
const RESULT_CANVAS_W = 1024;
const RESULT_CANVAS_H = 384;
const RESULT_PANEL_W  = 1.2;
const RESULT_PANEL_H  = 0.45;

export class HUDSystem extends createSystem({}) {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;
  private lastDraw = 0;

  // Result overlay — a separate mesh with its own follower so it can
  // sit further away without affecting HUD readability.
  private resultCanvas!: HTMLCanvasElement;
  private resultCtx!: CanvasRenderingContext2D;
  private resultTexture!: CanvasTexture;
  private resultMesh!: Mesh;

  init() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext("2d")!;

    this.texture = new CanvasTexture(this.canvas);
    const mat = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false, // always on top — HUD should never be occluded
    });
    const mesh = new Mesh(new PlaneGeometry(PANEL_W, PANEL_H), mat);
    mesh.renderOrder = 999; // pair with depthTest:false to force in-front

    // Persistent so it survives any future level changes. Follower does
    // the head-tracking, so we don't need to manually sync each frame.
    const entity = this.world.createTransformEntity(mesh, {
      parent: this.world.sceneEntity,
      persistent: true,
    });
    entity.addComponent(Follower, {
      target: this.player.head,
      offsetPosition: [0, 0.28, -0.9],
      behavior: FollowBehavior.PivotY,
      maxAngle: 35,
      tolerance: 0.2,
      speed: 6,
    });

    this.redraw(true);
    this.initResultPanel();
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

    const entity = this.world.createTransformEntity(this.resultMesh, {
      parent: this.world.sceneEntity,
      persistent: true,
    });
    entity.addComponent(Follower, {
      target: this.player.head,
      offsetPosition: [0, 0.05, -1.8],
      behavior: FollowBehavior.PivotY,
      maxAngle: 45,
      tolerance: 0.3,
      speed: 8,
    });

    const globals = this.world.globals as Record<string, unknown>;
    const result = GameState.roundResult(globals);

    // Show when a result lands, hide when cleared. Signal subscription
    // fires immediately with current value — we guard the null case so
    // we don't flash an empty panel on first frame.
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

  update(_delta: number, time: number) {
    // 10 Hz redraw — the seconds digit is the highest-frequency thing on
    // the panel. Anything faster wastes draw calls.
    if (time - this.lastDraw < 0.1) return;
    this.lastDraw = time;
    this.redraw(false);

    // Auto-retire the result panel. HUDSystem owns the lifetime; clearing
    // the signal drops the subscription back to the hidden state.
    const result = GameState.roundResult(this.world.globals as Record<string, unknown>);
    const r = result.peek();
    if (r && Date.now() >= r.expiresAt) {
      result.value = null;
    }
  }

  private redraw(_initial: boolean) {
    const g = this.world.globals as Record<string, unknown>;
    const running = GameState.roundRunning(g).peek();
    const endsAt  = GameState.roundEndsAt(g).peek();
    const score   = GameState.score(g).peek();
    const health  = GameState.playerHealth(g).peek();

    const remaining = running
      ? Math.max(0, (endsAt - Date.now()) / 1000)
      : 0;

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

    // Score
    ctx.fillStyle = "#fbbf24";
    ctx.font = 'bold 44px "Apple Color Emoji", system-ui, sans-serif';
    ctx.fillText("⭐", 210, 64);
    ctx.fillStyle = "#f4f4f5";
    ctx.font = 'bold 52px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(String(score), 260, 66);

    // Health bar
    const barX = 340, barY = 48, barW = 148, barH = 28;
    const pct = Math.max(0, Math.min(1, health / MAX_HEALTH));
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    roundedRect(ctx, barX, barY, barW, barH, 6);
    ctx.fill();
    const healthColor = pct > 0.5 ? "#10b981" : pct > 0.25 ? "#f59e0b" : "#ef4444";
    ctx.fillStyle = healthColor;
    roundedRect(ctx, barX, barY, barW * pct, barH, 6);
    ctx.fill();
    ctx.fillStyle = "#f4f4f5";
    ctx.font = 'bold 20px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = "center";
    ctx.fillText(`${Math.ceil(health)}`, barX + barW / 2, barY + barH / 2 + 1);

    this.texture.needsUpdate = true;
  }

  private drawResult(r: RoundResult) {
    const ctx = this.resultCtx;
    const W = RESULT_CANVAS_W, H = RESULT_CANVAS_H;
    ctx.clearRect(0, 0, W, H);

    const accent = RESULT_COLORS[r.reason] ?? "#71717a";

    // Backdrop
    ctx.fillStyle = "rgba(12,12,16,0.88)";
    roundedRect(ctx, 0, 0, W, H, 40);
    ctx.fill();

    // Accent border
    ctx.strokeStyle = accent;
    ctx.lineWidth = 8;
    roundedRect(ctx, 6, 6, W - 12, H - 12, 34);
    ctx.stroke();

    // Title
    ctx.fillStyle = accent;
    ctx.font = 'bold 136px system-ui, -apple-system, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(RESULT_TITLES[r.reason] ?? "ROUND OVER", W / 2, 140);

    // Score
    ctx.fillStyle = "#fbbf24";
    ctx.font = 'bold 72px "Apple Color Emoji", system-ui, sans-serif';
    ctx.fillText("⭐", W / 2 - 110, 290);
    ctx.fillStyle = "#f4f4f5";
    ctx.font = 'bold 92px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = "left";
    ctx.fillText(String(r.score), W / 2 - 50, 293);

    this.resultTexture.needsUpdate = true;
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
