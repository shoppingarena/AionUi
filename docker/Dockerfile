# =============================================================================
# AionUi WebUI — Multi-stage Container Image
# Branch: 002-k3s-prod-deploy | Version: v2.1.23
# =============================================================================
#
# Builder stage:  Compiles the React SPA (electron-vite build) and downloads
#                 the aioncore Rust binary.
# Runtime stage:  Thin layer with Bun + Node + opencode + git for headless
#                 WebUI server operation.
#
# Validated build path (the existing root Dockerfile is broken — it references
# `build:renderer:web` and `scripts/build-server.mjs` which do not exist):
#   1.  electron-vite build  →  out/renderer/   (built SPA)
#   2.  prepareAioncore.js   →  resources/bundled-aioncore/linux-x64/aioncore
#   3.  bun scripts/webui.ts →  serves SPA + proxies API to aioncore
#
# IMPORTANT: `electron-vite build` MUST be invoked with `node`, NOT `bun`.
# Bun's runtime has a crypto import bug that breaks Vite's dependency chain.
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Builder
# ---------------------------------------------------------------------------
FROM node:22-slim AS builder

WORKDIR /app

# Install Bun in the builder (needed for `bun install` lockfile resolution).
# Install wget (needed by prepareAioncore.js to download the aioncore binary).
RUN apt-get update && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g bun

# Copy full source tree. Bun workspaces (packages/*) must be present before
# install — bun resolves workspace:* deps from local package.json files.
# The .dockerignore excludes node_modules/, out/, .git/ etc. to keep context small.
COPY . .

# Install all dependencies (including devDeps needed for electron-vite).
# --ignore-scripts avoids native rebuilds that fail in a headless container.
RUN bun install --ignore-scripts

# Build the renderer SPA using electron-vite.
# MUST use `node` to invoke electron-vite — Bun triggers a crypto import bug.
RUN node node_modules/.bin/electron-vite build --config packages/desktop/electron.vite.config.ts

# The aioncore binary is pre-downloaded and included via COPY . .
# (prepareAioncore.js would delete and re-download, which fails in
# rootless Docker due to network namespace restrictions).
# Verify the binary exists from the source tree copy.
RUN test -f resources/bundled-aioncore/linux-x64/aioncore \
    && chmod +x resources/bundled-aioncore/linux-x64/aioncore \
    && echo "✓ aioncore binary verified"

# Verify build artifacts exist before proceeding to runtime stage.
RUN test -f out/renderer/index.html || (echo "ERROR: out/renderer/index.html not found" && exit 1)
RUN test -f resources/bundled-aioncore/linux-x64/aioncore || (echo "ERROR: aioncore binary not found" && exit 1)


# ---------------------------------------------------------------------------
# Stage 2: Runtime
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime

# OCI standard labels
LABEL org.opencontainers.image.title="AionUi WebUI"
LABEL org.opencontainers.image.description="AionUi headless WebUI for container deployment"
LABEL org.opencontainers.image.version="2.1.23"
LABEL org.opencontainers.image.source="https://github.com/iOfficeAI/AionUi"
LABEL org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app

# Install system dependencies:
#   git, openssh-client  — agent tool operations (clone, push)
#   libicu-dev           — required by officecli (.NET binary used by Office preview)
#   ca-certificates      — TLS certificate validation for HTTPS API calls
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        openssh-client \
        libicu-dev \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Bun (runtime for webui.ts) and opencode-ai (agent CLI).
RUN npm install -g bun opencode-ai

# Copy root package.json (needed for workspace resolution at runtime).
COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/patches/ ./patches/

# Copy workspace package directories (bun resolves workspace:* from these).
COPY --from=builder /app/packages/web-host/ ./packages/web-host/
COPY --from=builder /app/packages/web-cli/ ./packages/web-cli/
COPY --from=builder /app/packages/shared-scripts/ ./packages/shared-scripts/

# Copy node_modules from builder (pre-resolved, includes workspace symlinks).
COPY --from=builder /app/node_modules/ ./node_modules/

# Copy runtime scripts.
COPY --from=builder /app/scripts/ ./scripts/

# Copy build artifacts from builder stage.
COPY --from=builder /app/out/renderer/ ./out/renderer/
COPY --from=builder /app/resources/bundled-aioncore/ ./resources/bundled-aioncore/

# Runtime environment variables.
ENV AIONUI_NO_BUILD=1 \
    AIONUI_HOST=0.0.0.0 \
    AIONUI_DATA_DIR=/data \
    AIONUI_LOG_DIR=/data/logs \
    NODE_ENV=production \
    PORT=25808

# Persistent data volume — SQLite database, conversations, workspaces, logs.
VOLUME ["/data"]

# WebUI HTTP port (Traefik routes here).
EXPOSE 25808

# Health check: aioncore exposes /api/auth/status which returns 200 when ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:25808/api/auth/status || exit 1

# Start the WebUI server (aioncore backend + static SPA server).
CMD ["bun", "scripts/webui.ts", "--no-build", "--remote"]
