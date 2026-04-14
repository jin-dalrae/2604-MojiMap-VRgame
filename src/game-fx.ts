// Audio + haptic feedback helpers.
//
// Audio is synthesized via the Web Audio API so we don't need any asset
// files. Each cue is a short oscillator burst with an exponential decay
// envelope — cheap, punchy, and immune to the emulator's asset loader.
//
// Haptics hit the raw XRGamepad's hapticActuators[0].pulse(). Both APIs
// are wrapped in try/catch so cue failures never break gameplay.

import type { StatefulGamepad } from "@iwsdk/xr-input";

// Lazy — don't create AudioContext until first sound. Avoids browser
// autoplay warnings when the page loads without user gesture. Also
// explicitly resume() whenever the context is suspended so cues fire
// after the user has interacted with the page (some browsers keep the
// context suspended until a gesture even if it was created earlier).
let audioCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (!audioCtx) {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === "suspended") {
    // Fire-and-forget; resume is async but we don't need to wait for it.
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

type Waveform = "sine" | "square" | "sawtooth" | "triangle";

// Play a single oscillator burst. Frequency in Hz, duration in ms.
function beep(
  freq: number,
  duration: number,
  type: Waveform = "sine",
  volume = 0.2,
  freqSlide: number | null = null,
) {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (freqSlide !== null) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(40, freqSlide),
      now + duration / 1000,
    );
  }

  // ADSR-ish: quick attack, exponential decay — feels tight.
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration / 1000);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration / 1000 + 0.02);
}

// ── Haptics ──────────────────────────────────────────────────
export function pulse(gamepad: StatefulGamepad | undefined | null, intensity: number, ms: number) {
  if (!gamepad) return;
  try {
    const actuators = (gamepad.gamepad as any).hapticActuators as
      | { pulse?: (i: number, d: number) => Promise<unknown> }[]
      | undefined;
    actuators?.[0]?.pulse?.(Math.min(1, Math.max(0, intensity)), ms);
  } catch {
    /* WebXR occasionally throws on rapid pulses — ignore */
  }
}

// ── Cue palette ──────────────────────────────────────────────
// Each cue bundles a sound + (optional) haptic so callers don't have
// to know the recipe for a "pickup" feels-good moment.
export const FX = {
  pickupWeapon: (gamepad?: StatefulGamepad | null) => {
    beep(720, 120, "triangle", 0.22, 1080);
    pulse(gamepad, 0.9, 60);
  },
  pickupGoal: (gamepad?: StatefulGamepad | null) => {
    beep(880, 90, "triangle", 0.2);
    setTimeout(() => beep(1320, 110, "triangle", 0.2), 60);
    pulse(gamepad, 0.6, 40);
  },
  pickupPowerup: (gamepad?: StatefulGamepad | null) => {
    beep(520, 150, "sine", 0.2, 780);
    pulse(gamepad, 0.5, 50);
  },
  swordHit: (gamepad?: StatefulGamepad | null) => {
    beep(180, 90, "square", 0.25, 80);
    pulse(gamepad, 1.0, 80);
  },
  enemyKill: (gamepad?: StatefulGamepad | null) => {
    beep(140, 180, "sawtooth", 0.25, 50);
    pulse(gamepad, 1.0, 140);
  },
  gunFire: (gamepad?: StatefulGamepad | null) => {
    beep(1600, 60, "square", 0.15, 400);
    pulse(gamepad, 0.4, 30);
  },
  playerHurt: (gamepad?: StatefulGamepad | null) => {
    beep(220, 120, "sawtooth", 0.2, 140);
    pulse(gamepad, 0.8, 80);
  },
  oof: (gamepad?: StatefulGamepad | null) => {
    // Short grunt — descending sawtooth + a low square thunk layered in
    beep(200, 160, "sawtooth", 0.26, 110);
    setTimeout(() => beep(120, 200, "square", 0.18, 80), 45);
    pulse(gamepad, 1.0, 140);
  },
  warp: (gamepad?: StatefulGamepad | null) => {
    // Descending whoosh — two overlapping tones sliding down
    beep(1200, 260, "sine", 0.22, 220);
    setTimeout(() => beep(800, 320, "triangle", 0.18, 160), 40);
    pulse(gamepad, 1.0, 120);
  },
  roundStart: () => {
    beep(440, 80, "square", 0.2);
    setTimeout(() => beep(660, 120, "square", 0.2), 100);
  },
  roundWin: () => {
    beep(523, 100, "triangle", 0.22);                          // C5
    setTimeout(() => beep(659, 100, "triangle", 0.22), 110);   // E5
    setTimeout(() => beep(784, 180, "triangle", 0.22), 220);   // G5
  },
  roundLose: () => {
    beep(330, 180, "sawtooth", 0.22, 220);
    setTimeout(() => beep(220, 260, "sawtooth", 0.22, 110), 180);
  },
  roundTimeout: () => {
    beep(294, 200, "square", 0.18);
  },
};
