# Research: AionUi Production Deployment

**Feature**: 002-k3s-prod-deploy | **Date**: 2026-06-29

---

## 1. Container Build Strategy

**Decision**: Multi-stage Dockerfile using `electron-vite build` for renderer + pre-built aioncore binary download + Bun runtime.

**Rationale**: The existing Dockerfile references `bun run build:renderer:web` and `scripts/build-server.mjs` — neither exists in the codebase. The validated working path (confirmed on this machine) is:
1. `node node_modules/.bin/electron-vite build --config packages/desktop/electron.vite.config.ts` → builds `out/renderer/`
2. `node scripts/prepareAioncore.js` → downloads aioncore binary for `linux-x64`
3. `AIONUI_NO_BUILD=1 bun scripts/webui.ts --remote` → serves the app headless

Bun's runtime cannot drive `electron-vite build` directly (crypto.getRandomValues incompatibility), so the build stage uses Node.js. The runtime stage uses Bun for the web server but also includes Node.js for agent CLIs (opencode).

**Alternatives considered**:
- Use existing Dockerfile as-is → ❌ broken (references non-existent scripts)
- Build a custom server bundle (`dist-server/server.mjs`) → ❌ not yet implemented in this codebase version
- Use Electron in headless mode with Xvfb (per `docs/guides/deploy-server.md`) → ❌ too heavy (Electron + Chromium + Xvfb ≈ 1.5GB image vs ~400MB headless)

---

## 2. K3s Ingress and TLS Configuration

**Decision**: Traefik IngressRoute (K3s default Ingress controller) + cert-manager with Let's Encrypt HTTP-01 challenge.

**Rationale**: K3s ships with Traefik pre-configured as the default Ingress controller. No need to install a separate Ingress controller. cert-manager is the standard K8s certificate manager and integrates natively with Traefik via the `tls.certResolver` annotation.

**Alternatives considered**:
- Nginx Ingress Controller → ❌ requires replacing K3s default, adds complexity
- Traefik with DNS-01 challenge → ⚠️ requires DNS provider API access, more complex setup; use HTTP-01 for simplicity (single domain)
- Manual TLS certs → ❌ violates FR-012 (automated provisioning and renewal)
- Caddy (auto-TLS built-in) → ❌ would require replacing Traefik; not worth the complexity on K3s

**Configuration notes**:
- Traefik IngressRoute CRD (`traefik.io/v1alpha1`) instead of standard K8s Ingress for full middleware support
- cert-manager ClusterIssuer with Let's Encrypt `HTTP-01` solver
- TLS redirect middleware: all HTTP → HTTPS (FR-001)

---

## 3. Authentication Gateway Selection

**Decision**: Authentik (open-source identity provider) with Traefik forward-auth middleware.

**Rationale**: Authentik is the only major open-source IdP that natively supports:
- **Twilio SMS** as a built-in authenticator stage (FR-010)
- **Forward-auth** integration with Traefik (transparent auth gateway)
- **OIDC/OAuth2** provider for future SSO
- **LDAP** user directory for centralized user management (FR-006)
- **K8s-native** deployment via official Helm chart
- **Flow-based auth** (password → MFA → session) configurable via UI

**Alternatives considered**:
- Authelia → ❌ no native Twilio SMS stage; would require custom auth backend
- OAuth2 Proxy → ❌ limited to OAuth/OIDC backends; no user management; no SMS
- Keycloak → ⚠️ heavy (Java/JVM, ~1GB RAM), complex to configure; overkill for 1-10 users
- Build custom auth gateway → ❌ violates security best practices (don't roll your own auth)
- AionUi's built-in auth only → ❌ no rate limiting, no MFA, no multi-user (per audit)

**Architecture**:
```
User → Traefik (TLS) → forwardAuth → Authentik → allow/deny
                                         ↓ allow
                                    AionUi instance
```

---

## 4. Multi-User Isolation Model

**Decision**: Instance-per-user — each user gets a dedicated K8s Deployment + PVC.

**Rationale**: AionUi is architecturally single-user (one SQLite DB, one admin account, one workspace per process). The cleanest isolation is to run one instance per user, each with its own PVC. This provides:
- Complete data isolation (FR-004) — separate SQLite, separate filesystem
- Independent restart/recovery (FR-008) — one user's crash doesn't affect others
- Per-user resource limits (memory, CPU, storage quotas)
- No application code changes needed

**Alternatives considered**:
- Single shared instance with application-level multi-tenancy → ❌ AionUi doesn't support multi-tenancy; would require major backend rewrites
- Single instance + namespace isolation → ❌ same process = shared SQLite = no isolation
- Helm release per user → ⚠️ equivalent to instance-per-user but adds Helm overhead for <10 users

**Provisioning approach**: Shell scripts (`provision-user.sh`, `revoke-user.sh`) wrapping `kubectl`. For <10 users, this is simpler than a K8s Operator. Each script:
1. Generates a unique port (internal ClusterIP, not exposed externally)
2. Creates Deployment from template with unique name + PVC reference
3. Adds Traefik IngressRoute path rule for the user
4. Registers the user in Authentik

---

## 5. Storage Strategy

**Decision**: K3s local-path provisioner with per-user PVC (10Gi default).

**Rationale**: On a single-node K3s cluster, networked storage (NFS, Ceph) adds unnecessary complexity. local-path-provisioner (K3s default) writes directly to the node's filesystem — simplest, fastest, no external dependencies (FR-014).

**Layout**:
```
/data/aionui-users/
├── user-alice/     → PVC mount: SQLite DB, conversations, workspace
├── user-bob/       → PVC mount: separate SQLite DB, conversations, workspace
└── user-carol/     → PVC mount: separate
```

**Alternatives considered**:
- Longhorn (distributed block storage) → ❌ overkill for single-node, adds complexity
- NFS provisioner → ❌ unnecessary network layer for a single node
- hostPath → ⚠️ not portable, but local-path-provisioner wraps hostPath with proper PV management
- SQLite over NFS → ❌ known corruption issues with SQLite over networked filesystems

---

## 6. Health Checks and Graceful Shutdown

**Decision**: K8s liveness/readiness probes hitting `/api/auth/status` + preStop hook with `SIGTERM` + 30s termination grace period.

**Rationale**: aioncore exposes `/api/auth/status` (returns HTTP 200 when ready). This endpoint is perfect for readiness checks since it confirms both the web server and aioncore backend are operational.

**Probe configuration**:
- **Readiness**: `GET /api/auth/status` → HTTP 200 (backend ready to serve)
- **Liveness**: `GET /api/auth/status` → HTTP 200 (backend healthy)
- **Startup**: `GET /api/auth/status` → HTTP 200 (initial boot complete; aioncore takes ~2s)

**Graceful shutdown**:
- `SIGTERM` → aioncore flushes SQLite WAL, closes connections (FR-008)
- `terminationGracePeriodSeconds: 30` — allows WAL flush + connection drain
- SQLite WAL mode (enabled in schema) prevents data corruption on crash

---

## 7. Secret Management

**Decision**: K8s Secrets for initial deployment, Sealed Secrets for GitOps-ready workflow.

**Rationale**: K8s Secrets are base64-encoded (not encrypted) at rest by default. For a single-node deployment managed via `kubectl`, this is acceptable for Phase 1. Sealed Secrets can be added later when moving to GitOps (ArgoCD/Flux).

**Secrets to manage**:
- `aionui-admin-password` — initial admin credentials per instance
- `model-provider-keys` — Z.ai, OpenRouter, DeepSeek API keys (per-user)
- `authentik-secret-key` — Authentik signing key
- `twilio-credentials` — Account SID, Auth Token, From number (Phase 3)

**Alternatives considered**:
- HashiCorp Vault → ❌ overkill for single-node, adds another service to manage
- External Secrets Operator → ⚠️ requires external secret store (AWS Secrets Manager, etc.)
- Plain ConfigMap → ❌ credentials in plaintext, violates FR-009

---

## 8. Rate Limiting Configuration

**Decision**: Traefik middleware `rateLimit` + `inFlightReq` at the Ingress level.

**Rationale**: Traefik provides built-in rate limiting middleware. Applied at the IngressRoute level, it protects all routes without application changes.

**Configuration**:
- Authentication endpoints: 5 requests/minute per IP (brute-force protection, FR-005)
- General application: 100 requests/second per IP (normal usage)
- Source identification: `X-Forwarded-For` header (Traefik respects this behind a load balancer)

**Alternatives considered**:
- Application-level rate limiting → ❌ AionUi has no rate limiting capability
- Authentik rate limiting → ⚠️ only protects auth flow, not the application itself
- Custom sidecar (Nginx rate-limit) → ❌ unnecessary; Traefik has native support

---

## 9. Security Headers

**Decision**: Traefik middleware `headers` with standard security header configuration.

**Rationale**: Traefik's headers middleware can inject security headers into all responses at the edge, satisfying FR-013 without application changes.

**Headers applied**:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (HSTS)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-XSS-Protection: 0` (modern browsers handle XSS natively; this header is deprecated)

---

## 10. Twilio SMS Integration Path (Future)

**Decision**: Authentik Twilio Authenticator Stage — zero application code changes.

**Rationale**: Authentik has a built-in "Twilio SMS Authenticator" stage that sends verification codes via Twilio. Configured entirely in the Authentik admin UI — no code changes to AionUi, no sidecar, no custom development.

**Flow**:
```
Login → Password correct → Authentik Flow → Twilio SMS Stage
  → User enters code → Verified → Session granted → Forward to AionUi
```

**Setup requirements**:
1. Twilio account (Account SID, Auth Token, From number)
2. Authentik: Settings → Providers → Twilio → configure credentials
3. Authentik: Flows → Add "Twilio SMS" stage after password stage
4. Bind flow to AionUi application in Authentik

**Timeline**: Can be added at any time after Phase 3 (Auth gateway deployed). No architectural prerequisites — the gateway already intercepts all traffic.
