// VoiceSystem — listens for voice commands via the browser's Web Speech
// API and dispatches game actions when a keyword is recognized.
//
// Starts with "poo poo doo doo" → spawnBomb.  We match liberally because
// SpeechRecognition is eager to "correct" nonsense syllables; anything
// with "poo" + "doo" / "do" counts.
//
// Web Speech is free, cross-browser-ish (Chromium + Quest Browser work,
// Safari doesn't), and requires a user gesture to request mic access.
// The user entering XR counts as that gesture. If the API isn't present
// we just no-op — keyboard shortcuts still let players test the feature.

import { createSystem } from "@iwsdk/core";
import { GameActions } from "./game-state.js";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: ((e: unknown) => void) | null;
};

// Keep phrase matching lax — Web Speech loves to hear real words where
// there are none. Both "do" and "doo" show up in normal transcripts.
function matchesBombPhrase(text: string): boolean {
  const t = text.toLowerCase().replace(/[^a-z ]/g, "");
  return (
    t.includes("poo poo") &&
    (t.includes("doo doo") || t.includes("do do") || t.includes("do doo") || t.includes("doo do"))
  );
}

export class VoiceSystem extends createSystem({}) {
  private rec: SpeechRecognitionLike | null = null;
  private RecCtor: (new () => SpeechRecognitionLike) | null = null;
  private running = false;       // true between start() success and onend
  private shutdown = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastEventAt = 0;

  init() {
    const Ctor =
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (!Ctor) {
      console.log("[Voice] SpeechRecognition not supported — voice triggers disabled");
      return;
    }
    this.RecCtor = Ctor as new () => SpeechRecognitionLike;

    this.installRecognizer();

    // Health watchdog: if no event has fired for a while, recognition is
    // probably wedged. Tear it down and rebuild from scratch. Cheap.
    this.healthTimer = setInterval(() => {
      if (this.shutdown) return;
      const idle = performance.now() - this.lastEventAt;
      if (this.lastEventAt > 0 && idle > 25000) {
        console.log(`[Voice] no events for ${(idle / 1000).toFixed(1)}s — recreating recognizer`);
        this.recreate();
      }
    }, 5000);

    this.cleanupFuncs.push(() => {
      this.shutdown = true;
      if (this.restartTimer) clearTimeout(this.restartTimer);
      if (this.healthTimer) clearInterval(this.healthTimer);
      try { this.rec?.abort(); } catch { /* noop */ }
    });

    // Some browsers don't count the XR-enter click as a gesture for mic
    // access — kick a start on the first user interaction too.
    const kick = () => {
      if (!this.running) this.scheduleRestart(0);
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
    window.addEventListener("pointerdown", kick, { once: true });
    window.addEventListener("keydown", kick, { once: true });
  }

  private installRecognizer() {
    if (!this.RecCtor) return;
    this.rec = new this.RecCtor();
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.rec.lang = "en-US";

    this.rec.onresult = (e: unknown) => {
      this.lastEventAt = performance.now();
      const results = (e as { results: ArrayLike<ArrayLike<{ transcript: string }>> }).results;
      const last = results[results.length - 1];
      if (!last) return;
      const transcript = (last[0]?.transcript ?? "").trim();
      if (!transcript) return;
      if (matchesBombPhrase(transcript)) {
        console.log('[Voice] bomb phrase → "' + transcript + '"');
        const spawn = GameActions.spawnBomb(this.world.globals as Record<string, unknown>);
        spawn?.();
      }
    };

    this.rec.onerror = (e: unknown) => {
      this.lastEventAt = performance.now();
      const err = (e as { error?: string }).error ?? "unknown";
      // 'no-speech' / 'aborted' are routine — the watchdog handles real
      // breakage. 'audio-capture' or 'network' usually mean we need to
      // rebuild the recognizer; do so on the next tick.
      console.log("[Voice] error:", err);
      if (err === "audio-capture" || err === "network" || err === "service-not-allowed") {
        this.scheduleRestart(800);
      }
    };

    this.rec.onend = () => {
      this.lastEventAt = performance.now();
      this.running = false;
      if (this.shutdown) return;
      // Small debounce — Chromium throws InvalidStateError if start()
      // is called too soon after end fires.
      this.scheduleRestart(150);
    };

    this.tryStart();
  }

  private tryStart() {
    if (!this.rec || this.shutdown) return;
    try {
      this.rec.start();
      this.running = true;
      this.lastEventAt = performance.now();
    } catch (e) {
      // start() throws InvalidStateError when already running, NotAllowedError
      // when mic permission missing. Either way: try again with backoff.
      const msg = (e as { name?: string; message?: string })?.message ?? String(e);
      console.log("[Voice] start() threw:", msg);
      this.scheduleRestart(1000);
    }
  }

  private scheduleRestart(delayMs: number) {
    if (this.shutdown) return;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.running) this.tryStart();
    }, delayMs);
  }

  // Hard reset — used by the health watchdog when the recognizer goes
  // unresponsive. Cleanly aborts the old instance and builds a new one.
  private recreate() {
    if (this.shutdown) return;
    try { this.rec?.abort(); } catch { /* noop */ }
    this.rec = null;
    this.running = false;
    this.lastEventAt = performance.now(); // arm the watchdog window
    this.installRecognizer();
  }
}
