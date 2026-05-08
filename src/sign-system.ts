// SignSystem — pure visual feedback layer.
//
// Owns three flavors of ephemeral 2D effects so callers don't each
// reinvent the same canvas + sprite + lifetime dance:
//
//   1. flashSign(text|url, color?)  — head-locked comic-book sign that
//      pops up in front of the player for ~1.2s. Used by voice triggers
//      ("POOPOO DOODOO", "PEACOCK FLY!", "CAW CAW!", "BIRD KO!").
//   2. popupAt(pos, text, color)    — world-anchored score float ("+5")
//      that drifts up and fades. Used on bird kills.
//   3. featherPuffAt(pos)           — burst of small white feathers that
//      scatter outward and fade. Cosmetic only.
//
// All three live as plain Three.js sprites in the scene; the system
// owns the per-frame animation tick so callers just fire-and-forget.

import {
  createSystem,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  TextureLoader,
  SRGBColorSpace,
  Vector3,
} from "@iwsdk/core";
import { GameActions } from "./game-state.js";

// ── Tuning ───────────────────────────────────────────────────
const SIGN_DURATION_MS = 1200;
const SIGN_DISTANCE = 0.8;          // m in front of the player's head
const POPUP_DURATION_MS = 1100;
const POPUP_RISE = 0.7;              // m the popup floats up over its life
const PUFF_DURATION_MS = 900;
const PUFF_PARTICLE_COUNT = 8;

// ── Internal types ───────────────────────────────────────────
type ActiveSign = {
  sprite: Sprite;
  bornAt: number;
  durationMs: number;
  baseScale: [number, number];
};

type ActivePopup = {
  sprite: Sprite;
  bornAt: number;
  basePos: Vector3;
};

type ActivePuff = {
  sprite: Sprite;
  bornAt: number;
  basePos: Vector3;
  velocity: Vector3;
};

// ── Texture cache (one per URL) ──────────────────────────────
const textureLoader = new TextureLoader();
const textureCache = new Map<string, ReturnType<TextureLoader["load"]>>();
function loadTexture(url: string) {
  const hit = textureCache.get(url);
  if (hit) return hit;
  const tex = textureLoader.load(url);
  tex.colorSpace = SRGBColorSpace;
  textureCache.set(url, tex);
  return tex;
}

// ── Canvas builders ──────────────────────────────────────────
// Comic-book hand-lettered text on a starburst-ish blob. Renders to a
// 1024×512 canvas, returns it as a CanvasTexture. Single-shot — caller
// owns disposal.
function makeComicCanvas(text: string, color: string): CanvasTexture {
  const W = 1024, H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Starburst background — black-bordered jagged shape behind the text.
  ctx.translate(W / 2, H / 2);
  ctx.beginPath();
  const spikes = 16;
  const outerR = 230;
  const innerR = 165;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const x = Math.cos(a) * r * 1.6;
    const y = Math.sin(a) * r * 0.85;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = "#0b0b0b";
  ctx.stroke();
  ctx.translate(-W / 2, -H / 2);

  // Bold outlined text — split into up to two lines if it has a newline.
  const lines = text.split("\n");
  const fontSize = lines.length > 1 ? 150 : 200;
  ctx.font = `900 ${fontSize}px "Impact", "Arial Black", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 18;
  ctx.strokeStyle = "#0b0b0b";
  ctx.fillStyle = "#ffffff";
  const lineH = fontSize * 1.05;
  const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineH;
    ctx.strokeText(lines[i], W / 2, y);
    ctx.fillText(lines[i], W / 2, y);
  }

  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Floating "+5" / "+10" / "BIRD KO!" canvas — transparent background,
// thick black-stroked + white-filled text so it reads at any distance.
function makePopupCanvas(text: string, color: string): CanvasTexture {
  const W = 512, H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.font = '900 130px "Impact", "Arial Black", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 14;
  ctx.strokeStyle = "#0b0b0b";
  ctx.fillStyle = color;
  ctx.strokeText(text, W / 2, H / 2);
  ctx.fillText(text, W / 2, H / 2);
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Tiny white feather/cotton-puff particle. One canvas, reused as a
// shared texture across all puff sprites in a burst.
let puffTexture: CanvasTexture | null = null;
function getPuffTexture(): CanvasTexture {
  if (puffTexture) return puffTexture;
  const S = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  puffTexture = new CanvasTexture(canvas);
  puffTexture.needsUpdate = true;
  return puffTexture;
}

// ── Sign options ─────────────────────────────────────────────
export type SignFlash = {
  // Either provide a URL to use a pre-rendered PNG (e.g. POOPOO DOODOO),
  // or text + color to render a comic-style sign on the fly.
  url?: string;
  text?: string;
  color?: string;
  // Defaults to SIGN_DURATION_MS.
  durationMs?: number;
  // Aspect ratio hint when using `url`. For `text`, the sign uses a
  // 2:1 aspect to match the canvas.
  aspect?: number;
};

export class SignSystem extends createSystem({}) {
  private signs: ActiveSign[] = [];
  private popups: ActivePopup[] = [];
  private puffs: ActivePuff[] = [];

  init() {
    const g = this.world.globals as Record<string, unknown>;
    GameActions.setFlashSign(g, (opts: SignFlash) => this.flashSign(opts));
    GameActions.setPopupAt(
      g,
      (x: number, y: number, z: number, text: string, color: string) =>
        this.popupAt(x, y, z, text, color),
    );
    GameActions.setFeatherPuffAt(
      g,
      (x: number, y: number, z: number) => this.featherPuffAt(x, y, z),
    );
  }

  // ── Public API (also exposed via GameActions) ─────────────
  flashSign(opts: SignFlash) {
    const aspect = opts.aspect ?? 2; // 2:1 default
    const heightM = 0.45;
    const widthM = heightM * aspect;

    let mat: SpriteMaterial;
    if (opts.url) {
      mat = new SpriteMaterial({
        map: loadTexture(opts.url),
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
    } else {
      const tex = makeComicCanvas(
        opts.text ?? "?!?!",
        opts.color ?? "#fde047",
      );
      mat = new SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
    }
    const sprite = new Sprite(mat);
    sprite.scale.set(widthM, heightM, 1);
    sprite.renderOrder = 999;

    // Anchor in front of the player's head, slightly above eye line.
    const head = this.player.head;
    const headPos = new Vector3();
    head.getWorldPosition(headPos);
    const forward = new Vector3();
    head.getWorldDirection(forward);
    forward.negate();              // head Object3D's forward is +Z out the back
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();

    sprite.position.copy(headPos).addScaledVector(forward, SIGN_DISTANCE);
    sprite.position.y += 0.05;
    this.scene.add(sprite);

    this.signs.push({
      sprite,
      bornAt: performance.now(),
      durationMs: opts.durationMs ?? SIGN_DURATION_MS,
      baseScale: [widthM, heightM],
    });
  }

  popupAt(x: number, y: number, z: number, text: string, color: string) {
    const tex = makePopupCanvas(text, color);
    const mat = new SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new Sprite(mat);
    sprite.scale.set(0.7, 0.35, 1);
    sprite.renderOrder = 998;
    sprite.position.set(x, y, z);
    this.scene.add(sprite);
    this.popups.push({
      sprite,
      bornAt: performance.now(),
      basePos: new Vector3(x, y, z),
    });
  }

  featherPuffAt(x: number, y: number, z: number) {
    const now = performance.now();
    const tex = getPuffTexture();
    for (let i = 0; i < PUFF_PARTICLE_COUNT; i++) {
      const mat = new SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
      });
      const sprite = new Sprite(mat);
      const size = 0.18 + Math.random() * 0.12;
      sprite.scale.set(size, size, 1);
      sprite.position.set(x, y, z);
      this.scene.add(sprite);

      // Random outward velocity — slightly upward bias so the puff
      // looks lifted, not blasted.
      const a = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 0.7;
      const vy = 0.2 + Math.random() * 0.5;
      const velocity = new Vector3(
        Math.cos(a) * speed,
        vy,
        Math.sin(a) * speed,
      );
      this.puffs.push({
        sprite,
        bornAt: now,
        basePos: new Vector3(x, y, z),
        velocity,
      });
    }
  }

  // ── Per-frame tick ────────────────────────────────────────
  update(_delta: number) {
    this.tickSigns();
    this.tickPopups();
    this.tickPuffs();
  }

  private tickSigns() {
    if (this.signs.length === 0) return;
    const now = performance.now();
    for (let i = this.signs.length - 1; i >= 0; i--) {
      const s = this.signs[i];
      const t = (now - s.bornAt) / s.durationMs;
      if (t >= 1) {
        this.disposeSprite(s.sprite);
        this.signs.splice(i, 1);
        continue;
      }
      // Pop-in (0-15%) → hold (15-75%) → fade-out (75-100%).
      const mat = s.sprite.material as SpriteMaterial;
      let opacity = 1;
      let scale = 1;
      if (t < 0.15) {
        const k = t / 0.15;
        scale = 0.6 + 0.55 * k;       // overshoots to 1.15 then settles
        opacity = k;
      } else if (t < 0.25) {
        scale = 1.15 - (t - 0.15) / 0.1 * 0.15;
      } else if (t > 0.75) {
        opacity = 1 - (t - 0.75) / 0.25;
      }
      mat.opacity = opacity;
      s.sprite.scale.set(s.baseScale[0] * scale, s.baseScale[1] * scale, 1);
    }
  }

  private tickPopups() {
    if (this.popups.length === 0) return;
    const now = performance.now();
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      const t = (now - p.bornAt) / POPUP_DURATION_MS;
      if (t >= 1) {
        this.disposeSprite(p.sprite);
        this.popups.splice(i, 1);
        continue;
      }
      // Float up + fade out. Slight ease so it pops and decays.
      p.sprite.position.set(
        p.basePos.x,
        p.basePos.y + POPUP_RISE * t,
        p.basePos.z,
      );
      const mat = p.sprite.material as SpriteMaterial;
      mat.opacity = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
    }
  }

  private tickPuffs() {
    if (this.puffs.length === 0) return;
    const now = performance.now();
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      const t = (now - p.bornAt) / PUFF_DURATION_MS;
      if (t >= 1) {
        this.disposeSprite(p.sprite);
        this.puffs.splice(i, 1);
        continue;
      }
      // Linear drift in the chosen direction, gravity pulls Y back down.
      const dt = t * (PUFF_DURATION_MS / 1000);
      p.sprite.position.set(
        p.basePos.x + p.velocity.x * dt,
        p.basePos.y + p.velocity.y * dt - 0.9 * dt * dt,
        p.basePos.z + p.velocity.z * dt,
      );
      const mat = p.sprite.material as SpriteMaterial;
      mat.opacity = 1 - t;
    }
  }

  private disposeSprite(sprite: Sprite) {
    this.scene.remove(sprite);
    const mat = sprite.material as SpriteMaterial;
    // The puff texture is shared — only canvas-text textures need
    // disposing per-sprite. Heuristic: if the map was loaded via the
    // shared TextureLoader (URL textures), don't dispose; otherwise do.
    if (mat.map && mat.map !== puffTexture) {
      // A texture from textureCache (loaded by URL) has its source URL
      // stored on the underlying image; canvas textures don't. Skip
      // disposal for cached URL textures so other sprites can keep
      // using them.
      const isCached = mat.map.image instanceof HTMLImageElement;
      if (!isCached) mat.map.dispose();
    }
    mat.dispose();
  }
}
