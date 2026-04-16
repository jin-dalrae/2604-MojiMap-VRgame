// VoiceSystem — OpenAI Realtime API transcription via WebRTC.
//
// Flow:
//   1. On first user gesture, fetch an ephemeral Realtime client_secret
//      from our server (/api/realtime-token). Server holds the real key.
//   2. Open a WebRTC peer connection to OpenAI, attach the mic track,
//      and exchange SDP via /v1/realtime/calls.
//   3. A data channel ("oai-events") streams Realtime events back —
//      we listen for input-audio-transcription events and trigger the
//      bomb when the transcript matches "poo poo doo doo" variants.
//
// Why WebRTC instead of WebSocket: browsers can't set Authorization
// headers on WS, and OpenAI's WS endpoint requires header auth. WebRTC
// uses SDP exchange via a regular HTTP POST that *can* carry headers.
//
// Why a server token endpoint: never ship the real OpenAI key to the
// browser. The ephemeral key is short-lived (~1 minute) and scoped.

import { createSystem } from "@iwsdk/core";
import { GameActions } from "./game-state.js";

// Whisper transcribes "poo poo doo doo" in dozens of forms — Foo-foo,
// Poo-poo, Boo-boo, ププルル, etc — so checking for the literal phrase
// is brittle. Instead: count "oo" sounds. A normal sentence has zero
// or one ("moon", "soon"); the bomb phrase chant produces 4+. Three is
// the threshold so partial transcripts ("poo poo doo …") still fire.
function matchesBombPhrase(text: string): boolean {
  const clean = text.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  const oo = (clean.match(/o{2,}/g) ?? []).length;
  return oo >= 3;
}

// Peacock mega-jump phrase: "I'm a peacock … fly". Accepts any number
// of words between "peacock" and "fly".
//
// After stripping apostrophes/punctuation, "I'm" becomes "i m" (with
// a space). Glue it back together before matching, then accept either
// "im a peacock" or "i am a peacock" as the opener.
function matchesPeacockPhrase(text: string): boolean {
  const clean = text
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bi m\b/g, "im")  // un-strip the apostrophe in "I'm"
    .trim();
  return /\b(im|i am)\s+a\s+peacock\b.*\bfly\b/.test(clean);
}

function tokenUrl(): string {
  const isLocal =
    location.hostname === "localhost" || location.hostname === "127.0.0.1";
  // Local: same-origin via Vite proxy → no mixed content / CORS.
  // Prod : direct to the Railway WS+HTTP server. CORS allowed there.
  return isLocal
    ? "/api/realtime-token"
    : "https://ar-app-ws-production.up.railway.app/api/realtime-token";
}

type RealtimeEvent = {
  type: string;
  transcript?: string;
  delta?: string;
  error?: { message?: string };
};

export class VoiceSystem extends createSystem({}) {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioStream: MediaStream | null = null;
  private connected = false;
  private connecting = false;
  private shutdown = false;
  // Track interim transcripts so the phrase can match before a final
  // chunk lands — keyword spotting feels much snappier this way.
  private interim = "";

  init() {
    this.cleanupFuncs.push(() => this.tearDown());

    // WebRTC + getUserMedia both require a user gesture in most browsers.
    // Wait for any first interaction (XR enter button, key press, click).
    const start = async () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      if (this.connected || this.connecting) return;
      try {
        await this.connect();
      } catch (e) {
        console.warn("[Voice] connect failed:", e);
      }
    };
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", start);
  }

  private async connect() {
    this.connecting = true;
    console.log("[Voice] requesting ephemeral token…");
    const tokenRes = await fetch(tokenUrl(), { method: "POST" });
    if (!tokenRes.ok) {
      this.connecting = false;
      const body = await tokenRes.text();
      throw new Error(`token mint ${tokenRes.status}: ${body}`);
    }
    const tokenData = await tokenRes.json();
    const ephemeralKey = (tokenData?.value ?? tokenData?.client_secret?.value);
    if (!ephemeralKey) {
      this.connecting = false;
      throw new Error("no ephemeral key in response: " + JSON.stringify(tokenData));
    }

    console.log("[Voice] opening WebRTC to OpenAI…");
    const pc = new RTCPeerConnection();
    this.pc = pc;

    // Data channel for Realtime events. Created BEFORE the offer so it
    // ends up in the SDP.
    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onopen = () => console.log("[Voice] data channel open");
    dc.onmessage = (e) => this.handleEvent(e.data);
    dc.onerror = (e) => console.warn("[Voice] dc error", e);

    // Mic capture — the simplest constraints work best for transcription.
    this.audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    for (const track of this.audioStream.getAudioTracks()) {
      pc.addTrack(track, this.audioStream);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Hand the SDP offer to OpenAI; they reply with an SDP answer.
    const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp",
      },
    });
    if (!sdpRes.ok) {
      this.connecting = false;
      throw new Error(`SDP exchange ${sdpRes.status}: ${await sdpRes.text()}`);
    }
    const answerSdp = await sdpRes.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    pc.onconnectionstatechange = () => {
      console.log("[Voice] pc state →", pc.connectionState);
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        this.connected = false;
        if (!this.shutdown) this.scheduleReconnect();
      }
    };

    this.connected = true;
    this.connecting = false;
    console.log("[Voice] ready — listening");
  }

  private handleEvent(raw: unknown) {
    let msg: RealtimeEvent;
    try { msg = JSON.parse(String(raw)); } catch { return; }

    // Streaming partial transcript. Used for snappy keyword detection.
    if (msg.type === "conversation.item.input_audio_transcription.delta" && msg.delta) {
      this.interim += msg.delta;
      this.checkPhrase(this.interim);
      return;
    }

    // Final chunk — clear the interim accumulator and double-check.
    if (msg.type === "conversation.item.input_audio_transcription.completed") {
      const finalText = msg.transcript ?? this.interim;
      this.interim = "";
      console.log('[Voice] transcript: "' + finalText + '"');
      this.checkPhrase(finalText);
      return;
    }

    if (msg.type === "error") {
      console.warn("[Voice] api error:", msg.error?.message ?? raw);
    }
  }

  private checkPhrase(text: string) {
    if (matchesBombPhrase(text)) {
      console.log('[Voice] bomb phrase matched');
      this.interim = ""; // don't double-trigger as the rest streams in
      const spawn = GameActions.spawnBomb(this.world.globals as Record<string, unknown>);
      spawn?.();
      return;
    }
    if (matchesPeacockPhrase(text)) {
      console.log('[Voice] peacock phrase matched');
      this.interim = "";
      const jump = GameActions.megaJump(this.world.globals as Record<string, unknown>);
      jump?.();
      return;
    }
  }

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleReconnect() {
    if (this.reconnectTimer || this.shutdown) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.tearDown();
      try { await this.connect(); }
      catch (e) { console.warn("[Voice] reconnect failed:", e); this.scheduleReconnect(); }
    }, 2000);
  }

  private tearDown() {
    this.shutdown = true;
    try { this.dc?.close(); } catch { /* noop */ }
    try { this.pc?.close(); } catch { /* noop */ }
    this.audioStream?.getTracks().forEach((t) => t.stop());
    this.dc = null;
    this.pc = null;
    this.audioStream = null;
    this.connected = false;
    this.connecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Allow a fresh connect after a manual tearDown (e.g. on signal).
    this.shutdown = false;
  }
}
