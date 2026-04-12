import { iwsdkDev } from "@iwsdk/vite-plugin-dev";

import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

// Self-signed cert generated via `openssl req -x509 ... -addext "subjectAltName=..."`.
// mkcert would be nicer but its -install step needs sudo and can't be automated.
// Chrome will warn on first visit; click "Advanced → Proceed" once and it remembers.
const CERT_DIR = path.resolve(__dirname, ".certs");

export default defineConfig({
  plugins: [
    iwsdkDev({
      emulator: {
        device: "metaQuest3",
        background: "webcam",
      },
      ai: { tools: ["claude", "cursor", "copilot", "codex"] },
      verbose: true,
    }),

    compileUIKit({ sourceDir: "ui", outputDir: "public/ui", verbose: true }),
  ],
  server: {
    host: "0.0.0.0",
    port: 8081,
    open: false,
    https: {
      key:  fs.readFileSync(path.join(CERT_DIR, "key.pem")),
      cert: fs.readFileSync(path.join(CERT_DIR, "cert.pem")),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: process.env.NODE_ENV !== "production",
    target: "esnext",
    rollupOptions: {
      input: {
        main: "./index.html",
        portal: "./portal.html",
        broadcast: "./broadcast.html",
      },
    },
  },
  esbuild: { target: "esnext" },
  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
    esbuildOptions: { target: "esnext" },
  },
  publicDir: "public",
});
