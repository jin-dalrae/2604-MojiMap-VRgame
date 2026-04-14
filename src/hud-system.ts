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
import { GameState, MAX_HEALTH } from "./game-state.js";

const CANVAS_W = 512;
const CANVAS_H = 128;
const PANEL_W  = 0.5;  // meters
const PANEL_H  = 0.125;

export class HUDSystem extends createSystem({}) {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;
  private lastDraw = 0;

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
  }

  update(_delta: number, time: number) {
    // 10 Hz redraw — the seconds digit is the highest-frequency thing on
    // the panel. Anything faster wastes draw calls.
    if (time - this.lastDraw < 0.1) return;
    this.lastDraw = time;
    this.redraw(false);
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
}

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
