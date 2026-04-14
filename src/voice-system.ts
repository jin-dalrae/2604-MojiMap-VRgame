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
  private started = false;
  private shutdown = false;

  init() {
    const Ctor =
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (!Ctor) {
      console.log("[Voice] SpeechRecognition not supported — voice triggers disabled");
      return;
    }

    type RecCtor = new () => SpeechRecognitionLike;
    this.rec = new (Ctor as RecCtor)();
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.rec.lang = "en-US";

    this.rec.onresult = (e: unknown) => {
      // SpeechRecognitionResult lists aren't plain arrays but behave
      // array-ish with `length` and indexed access. Cast pragmatically.
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
      const err = (e as { error?: string }).error ?? "unknown";
      console.log("[Voice] error:", err);
    };

    // Chromium closes the recognition after a stretch of silence. Keep
    // it alive by restarting on `end` until the system is torn down.
    this.rec.onend = () => {
      if (this.shutdown || !this.rec) return;
      try { this.rec.start(); } catch { /* start() throws if already running */ }
    };

    // Start — needs a user gesture. XR session enter qualifies, so we
    // try once here and silently ignore the NotAllowed error if it
    // fires before any gesture happens. The restart-on-end loop picks
    // it up once the user does something.
    try {
      this.rec.start();
      this.started = true;
    } catch {
      /* ignore; will retry from onend */
    }

    this.cleanupFuncs.push(() => {
      this.shutdown = true;
      try { this.rec?.abort(); } catch { /* noop */ }
    });

    // As a safety net, nudge the recognition to start again the first
    // time the window actually gets user interaction (some browsers
    // don't count the XR-enter click for mic permissions).
    const kick = () => {
      if (!this.started && this.rec) {
        try { this.rec.start(); this.started = true; } catch { /* noop */ }
      }
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
    window.addEventListener("pointerdown", kick, { once: true });
    window.addEventListener("keydown", kick, { once: true });
  }
}
