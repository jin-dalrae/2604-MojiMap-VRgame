import { iwsdkDev } from "@iwsdk/vite-plugin-dev";

import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

// Self-signed cert for local HTTPS dev. Only loaded if .certs/ exists (it's
// gitignored, so Vercel/CI won't have it — that's fine, server.https is
// only used by `vite dev`, not `vite build`).
const CERT_DIR = path.resolve(__dirname, ".certs");
const certsExist =
  fs.existsSync(path.join(CERT_DIR, "key.pem")) &&
  fs.existsSync(path.join(CERT_DIR, "cert.pem"));

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
    // Proxy /api/* to the local WS+HTTP server so the browser fetches a
    // same-origin URL. Avoids mixed-content (https page → http server)
    // blocks during local dev.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
    ...(certsExist
      ? {
          https: {
            key:  fs.readFileSync(path.join(CERT_DIR, "key.pem")),
            cert: fs.readFileSync(path.join(CERT_DIR, "cert.pem")),
          },
        }
      : {}),
  },
  build: {
    outDir: "dist",
    sourcemap: process.env.NODE_ENV !== "production",
    target: "esnext",
    rollupOptions: {
      input: {
        main: "./index.html",
        play: "./play.html",
        portal: "./portal.html",
        "portal-mobile": "./portal-mobile.html",
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
