# Container Contract: AionUi Production Image

**Feature**: 002-k3s-prod-deploy | **Date**: 2026-06-29

---

## Image Specification

| Property | Value |
|----------|-------|
| **Base image (builder)** | `node:22-slim` |
| **Base image (runtime)** | `oven/bun:latest` (or `node:22-slim` with Bun installed) |
| **Target architecture** | `linux/amd64` |
| **Image size target** | < 500MB (runtime layer) |
| **Registry** | [NEEDS CLARIFICATION: GHCR, Docker Hub, or local registry — user to decide] |

---

## Build Stage Contract

The builder stage MUST:

1. Install Bun (`npm install -g bun`)
2. `bun install --ignore-scripts` (dependencies without native rebuilds)
3. Copy full source tree
4. Build renderer: `node node_modules/.bin/electron-vite build --config packages/desktop/electron.vite.config.ts`
5. Download aioncore binary: `node scripts/prepareAioncore.js` (targets `linux-x64`)
6. Output artifacts:
   - `out/renderer/` — built SPA (HTML, JS, CSS, assets)
   - `resources/bundled-aioncore/linux-x64/aioncore` — Rust backend binary

**Build must NOT use**:
- ❌ `bun run build:renderer:web` (does not exist)
- ❌ `node scripts/build-server.mjs` (does not exist)
- ❌ `bun run package` directly in Docker (Bun crypto bug; use `node` to invoke electron-vite)

---

## Runtime Stage Contract

The runtime stage MUST provide:

### Binaries
| Binary | Purpose | Source |
|--------|---------|--------|
| `bun` | WebUI server runtime | `npm install -g bun` |
| `node` | Agent CLI runtime (opencode, nvm) | Base image |
| `npm` / `npx` | Package management for agents | Base image |
| `opencode` | OpenCode agent | `npm install -g opencode-ai` |
| `git` | Version control (agent tool) | `apt-get install git` |
| `openssh-client` | SSH for git operations | `apt-get install openssh-client` |
| `aioncore` | Rust backend binary | Copied from builder |

### Environment Variables (required at runtime)

| Variable | Value | Description |
|----------|-------|-------------|
| `AIONUI_NO_BUILD` | `1` | Skip renderer rebuild (already built in image) |
| `AIONUI_HOST` | `0.0.0.0` | Bind to all interfaces (behind Ingress) |
| `AIONUI_DATA_DIR` | `/data` | Persistent data directory (PVC mount) |
| `AIONUI_LOG_DIR` | `/data/logs` | Log directory inside PVC |
| `NODE_ENV` | `production` | Node.js production mode |
| `PORT` | `25808` | HTTP listen port |

### Volumes

| Mount | Purpose |
|-------|---------|
| `/data` | PVC — SQLite database, conversations, workspace, logs |

### Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| `25808` | HTTP | WebUI server (Traefik routes here) |

### Health Check Contract

| Check | Endpoint | Expected Response | Timeout |
|-------|----------|-------------------|---------|
| **Readiness** | `GET /api/auth/status` | HTTP 200, JSON body | 5s |
| **Liveness** | `GET /api/auth/status` | HTTP 200 | 10s |
| **Startup** | `GET /api/auth/status` | HTTP 200 (after ~3s boot) | 30s |

### Startup Command

```bash
bun scripts/webui.ts --no-build --remote
```

The command launches:
1. aioncore backend (Rust) — SQLite, auth, ACP agent management
2. Web-host static server — serves SPA + reverse-proxies API to aioncore

---

## Image Labels (OCI standard)

```dockerfile
LABEL org.opencontainers.image.title="AionUi WebUI"
LABEL org.opencontainers.image.description="AionUi headless WebUI for container deployment"
LABEL org.opencontainers.image.version="${AIONUI_VERSION}"
LABEL org.opencontainers.image.source="https://github.com/iOfficeAI/AionUi"
LABEL org.opencontainers.image.licenses="Apache-2.0"
```

---

## Validation Checklist

- [ ] Image builds successfully: `docker build -t aionui:test .`
- [ ] Container starts: `docker run -p 25808:25808 -v aionui-data:/data aionui:test`
- [ ] Health check passes: `curl http://localhost:25808/api/auth/status` returns 200
- [ ] SPA loads: `curl http://localhost:25808/` returns HTML
- [ ] aioncore boots: logs show "health ready on port XXXXX"
- [ ] opencode available: `docker exec <container> opencode --version` succeeds
- [ ] Data persists: restart container → previous data intact
