# Deployment Guide

## Overview

| Service | What it runs | URL |
|---------|-------------|-----|
| Vercel | Frontend (portal, portal-mobile, broadcast, index) | https://ar-app-jade.vercel.app |
| Railway | WebSocket server (`server.js`) | https://ar-app-ws-production.up.railway.app |

---

## Vercel (Frontend)

Vercel hosts all HTML pages. Pushing to `main` does **not** auto-trigger a deploy — you must run the CLI manually.

### Deploy steps

```bash
# 1. Make sure you're on main and it has the code you want to ship
git checkout main

# 2. Merge a feature branch (e.g. Apr22) into main
git fetch origin Apr22
git merge FETCH_HEAD --no-edit

# 3. Push main to GitHub
git push origin main

# 4. Deploy to Vercel production
vercel --prod --scope team_xyfUAtuLKxtiTJWiYeoX24XW
```

### Routes

Defined in `vercel.json`. Current rewrites:

| URL | File |
|-----|------|
| `/portal` | `portal.html` |
| `/portal-mobile` | `portal-mobile.html` |
| `/broadcast` | `broadcast.html` |
| `/puppet` | `puppet.html` |

To add a new route, add an entry to the `rewrites` array in `vercel.json` and redeploy.

---

## Railway (WebSocket Server)

Railway runs `server.js` via Docker (`Dockerfile` at project root). Deploys are triggered manually with the Railway CLI.

### Deploy steps

```bash
# Deploy current working directory to Railway production
railway up --detach
```

The `--detach` flag returns immediately and lets the build run in the background. Build logs are printed to the terminal.

### Linked project

- Project: `ar-app-ws`
- Environment: `production`
- Service: `ar-app-ws`

If `railway up` fails with a `ProtocolVersion` error, upgrade the CLI:

```bash
brew upgrade railway
```

---

## Full deploy (both services)

```bash
git checkout main
git fetch origin <branch>
git merge FETCH_HEAD --no-edit
git push origin main
vercel --prod --scope team_xyfUAtuLKxtiTJWiYeoX24XW
railway up --detach
```
