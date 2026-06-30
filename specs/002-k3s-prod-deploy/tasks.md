# Tasks: AionUi Production Deployment with Secure Authentication

**Input**: Design documents from `/specs/002-k3s-prod-deploy/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/

## Execution Flow (main)

```
1. Load plan.md from feature directory
   → Extract: tech stack, libraries, structure
2. Load optional design documents:
   → data-model.md: Extract entities → deployment tasks
   → contracts/: Each file → infrastructure tasks
   → research.md: Extract decisions → setup tasks
3. Generate tasks by category:
   → Setup: directory structure
   → Foundational: container image (blocks all stories)
   → User Stories: secure access, persistence, isolation, protection, administration
   → Polish: end-to-end validation, documentation
4. Apply task rules:
   → Different files = mark [P] for parallel
   → Same file = sequential (no [P])
5. Number tasks sequentially (T001, T002...)
6. Generate dependency graph
7. Create parallel execution examples
8. Validate task completeness
9. Return: SUCCESS (tasks ready for execution)
```

## Format: `- [ ] [ID] [P?] [Story?] Description with file path`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[USx]**: User story phase label
- Include exact file paths in descriptions

## Path Conventions

- Container build: `docker/` at repository root
- K8s manifests: `deploy/k8s/` at repository root
- Auth config: `deploy/auth/` at repository root
- Provisioning scripts: `deploy/scripts/` at repository root

---

## Phase 1: Setup

- [ ] T001 Create deployment directory structure: `docker/`, `deploy/k8s/`, `deploy/auth/`, `deploy/scripts/` at repository root

---

## Phase 2: Foundational (Container Image — blocks all stories)

_The existing Dockerfile is broken (references non-existent scripts). Everything depends on a working container image._

- [ ] T002 Rewrite Dockerfile as multi-stage build in `docker/Dockerfile` — builder stage uses `node:22-slim` with `electron-vite build` + `prepareAioncore.js`; runtime stage uses `oven/bun:latest` with Node.js 22, opencode-ai, git, openssh-client, libicu-dev
- [ ] T003 [P] Create `.dockerignore` in `docker/.dockerignore` — exclude `node_modules/`, `.git/`, `out/`, `resources/bundled-aioncore/`, `specs/`, `.specify/`, test files
- [ ] T004 Build container image locally: `docker build -f docker/Dockerfile -t aionui:v2.1.23 .` and verify it starts with `docker run -p 25808:25808 -v aionui-test:/data aionui:v2.1.23`
- [ ] T005 Verify container health and agent availability: `curl http://localhost:25808/api/auth/status` returns 200; `docker exec <container> opencode --version` succeeds; `docker exec <container> bun --version` succeeds

---

## Phase 3: US1 — Secure HTTPS Access + Authentication Gate

**Goal**: Users navigate to deployment URL over HTTPS, see login page, authenticate via Authentik before reaching AionUi.
**Independent test**: Unauthenticated `curl https://ai.example.com/` redirects to Authentik login; authenticated browser session loads AionUi WebUI.

- [ ] T006 [P] [US1] Create K8s namespace manifest in `deploy/k8s/namespace.yaml` — namespace `aionui` with labels for NetworkPolicy
- [ ] T007 [P] [US1] Create ConfigMap in `deploy/k8s/configmap.yaml` — non-secret env vars: `AIONUI_NO_BUILD=1`, `AIONUI_HOST=0.0.0.0`, `AIONUI_DATA_DIR=/data`, `NODE_ENV=production`, `PORT=25808`
- [ ] T008 [P] [US1] Create Secret template in `deploy/k8s/secret.yaml` — placeholder for model provider API keys (Z.ai, OpenRouter, DeepSeek) base64-encoded, with `.example` suffix for GitOps
- [ ] T009 [P] [US1] Create cert-manager ClusterIssuer manifest in `deploy/k8s/cert-manager.yaml` — Let's Encrypt HTTP-01 solver with Traefik ingress class, configurable admin email
- [ ] T010 [P] [US1] Create security middleware in `deploy/k8s/middleware.yaml` — Traefik Middleware CRDs: `tls-redirect` (HTTP→HTTPS 301), `security-headers` (HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy)
- [ ] T011 [US1] Create base Deployment template in `deploy/k8s/deployment.yaml` — image `aionui:v2.1.23`, port 25808, envFrom ConfigMap, resources (500m/2Gi request, 2000m/4Gi limit), strategy Recreate, label `app: aionui`
- [ ] T012 [P] [US1] Create Service template in `deploy/k8s/service.yaml` — ClusterIP, port 25808, selector `app: aionui`
- [ ] T013 [US1] Create IngressRoute with TLS in `deploy/k8s/ingress.yaml` — Traefik IngressRoute CRD, entryPoint websecure, Host match, certResolver letsencrypt, middlewares: tls-redirect + security-headers, backend service on port 25808
- [ ] T014 [US1] Create Authentik Helm values in `deploy/auth/authentik-values.yaml` — server/worker resources, PostgreSQL + Redis enabled, ingress for Authentik admin UI, secret key, admin email/password placeholders
- [ ] T015 [US1] Deploy Authentik via Helm: `helm install authentik authentik/authentik -f deploy/auth/authentik-values.yaml -n authentik` and verify pods are ready
- [ ] T016 [P] [US1] Create Authentik forward-auth middleware in `deploy/k8s/middleware-authentik.yaml` — Traefik forwardAuth pointing to `authentik-server.authentik.svc.cluster.local:9000/outpost.goauthentik.io/auth/traefik`, trustForwardHeader, authResponseHeaders (X-authentik-username, X-authentik-email)
- [ ] T017 [US1] Configure Authentik application: create Application (slug `aionui`), Proxy Provider (forward-auth for Traefik), Proxy Outpost deployed to `authentik` namespace, bind to application
- [ ] T018 [US1] Apply all manifests to cluster: `kubectl apply -f deploy/k8s/` and verify IngressRoute serves HTTPS with valid TLS cert (no browser warnings)
- [ ] T019 [US1] Verify end-to-end auth flow: unauthenticated `curl -L https://ai.example.com/` redirects to Authentik login; after browser auth, AionUi WebUI loads fully

---

## Phase 4: US2 — Data Persistence Across Restarts

**Goal**: User data (conversations, settings, workspaces) survives pod crashes and restarts with zero loss.
**Independent test**: Create a conversation → `kubectl delete pod` → pod recreates → conversation and data intact.

- [ ] T020 [P] [US2] Create PVC template in `deploy/k8s/pvc.yaml` — PersistentVolumeClaim, storageClassName `local-path`, accessMode `ReadWriteOnce`, size `10Gi`, name pattern `pvc-{username}`
- [ ] T021 [US2] Update Deployment template in `deploy/k8s/deployment.yaml` — add PVC volume mount at `/data`, add readiness/liveness/startup probes (`GET /api/auth/status`), add preStop hook (`kill -TERM 1`), set `terminationGracePeriodSeconds: 30`
- [ ] T022 [US2] Test persistence: deploy instance → create conversation via UI → `kubectl delete pod -l app=aionui` → wait for recreation → verify conversation and SQLite data intact at `/data/aionui-backend.db`

---

## Phase 5: US3 — Per-User Data Isolation

**Goal**: Each user gets their own AionUi instance with separate SQLite DB, workspace, and PVC. No user can access another's data.
**Independent test**: Deploy two user instances → verify each only sees its own conversations, and pod-to-pod traffic is blocked.

- [ ] T023 [P] [US3] Create NetworkPolicy in `deploy/k8s/networkpolicy.yaml` — deny all ingress between AionUi pods, allow ingress only from Traefik (kube-system namespace) on port 25808
- [ ] T024 [US3] Verify isolation: deploy two instances (`aionui-alice`, `aionui-bob`) → create distinct conversations in each → confirm Alice cannot reach Bob's service (`kubectl exec aionui-alice -- curl svc-bob:25808` fails) → confirm conversations are in separate SQLite databases

---

## Phase 6: US4 — Brute-Force Protection

**Goal**: Sustained credential-guessing attempts are detected and blocked within 10 seconds.
**Independent test**: Send 6+ failed login attempts in rapid succession → confirm rate limiting blocks subsequent attempts.

- [ ] T025 [P] [US4] Create rate-limit middleware in `deploy/k8s/middleware-ratelimit.yaml` — Traefik Middleware: `rate-limit-auth` (5 req/min average, burst 3, per-IP) for auth endpoints, `rate-limit-app` (100 req/s average, burst 50) for application routes
- [ ] T026 [US4] Update IngressRoute in `deploy/k8s/ingress.yaml` — add `rate-limit-auth` to Authentik auth paths, `rate-limit-app` to AionUi application paths
- [ ] T027 [US4] Test brute-force protection: send 6 rapid failed login attempts via `curl` → confirm 429 response on 6th attempt → wait 60s → confirm lockout clears and legitimate login works

---

## Phase 7: US5 — User Administration

**Goal**: Administrator can provision and revoke user access in under 1 minute with no downtime.
**Independent test**: Run `provision-user.sh alice` → Alice can access within 60s → run `revoke-user.sh alice` → Alice's access is removed.

- [ ] T028 [US5] Create provision-user script in `deploy/scripts/provision-user.sh` — accepts username arg, generates random admin password (K8s Secret), creates PVC (10Gi), creates Deployment from template, creates Service (ClusterIP), creates IngressRoute (path-prefix routing), outputs credentials
- [ ] T029 [P] [US5] Create revoke-user script in `deploy/scripts/revoke-user.sh` — accepts username arg with optional `--keep-data` flag, deletes IngressRoute, scales Deployment to 0, deletes Service, optionally deletes PVC, deactivates user in Authentik via API
- [ ] T030 [US5] Test provisioning flow: run `provision-user.sh alice` → verify pod running, PVC bound, IngressRoute created → access `https://ai.example.com/alice` after Authentik auth → run `revoke-user.sh alice` → verify access removed, PVC optionally preserved

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T031 Run full quickstart.md validation: execute all 10 steps from `specs/002-k3s-prod-deploy/quickstart.md` against the cluster — verify every checklist item passes
- [ ] T032 [P] Update AGENTS.md at repository root with deployment section: container build command, K3s deploy commands, provisioning workflow reference
- [ ] T033 [P] Create deployment README in `deploy/README.md` — quick reference: architecture diagram (text), file layout, common commands (build, deploy, provision, revoke, debug)
- [ ] T034 Verify resource budget: confirm Authentik + 2 AionUi instances fit within node resources (check `kubectl top nodes` and `kubectl top pods -A`), adjust resource requests if needed

---

## Dependencies

```
Phase 1 (Setup):
  T001 (directory structure)
    ↓
Phase 2 (Foundational — blocks everything):
  T002 (Dockerfile) → T004 (build) → T005 (verify)
  T003 (.dockerignore) — parallel with T002
    ↓
Phase 3 (US1 — Secure Access):
  T006-T010 (manifests) — parallel, no deps between them
  T011 (deployment) depends on T007 (configmap)
  T012 (service) — parallel after T011
  T013 (ingress) depends on T010 (middleware) + T012 (service)
  T014-T015 (Authentik deploy) — sequential
  T016 (forward-auth middleware) — parallel with T014
  T017 (Authentik config) depends on T015
  T018 (apply all) depends on T006-T013
  T019 (verify) depends on T017 + T018
    ↓
Phase 4 (US2 — Persistence):
  T020 (PVC) — parallel
  T021 (update deployment) depends on T011 + T020
  T022 (persistence test) depends on T021
    ↓
Phase 5 (US3 — Isolation):
  T023 (NetworkPolicy) — parallel
  T024 (isolation test) depends on T022 + T023
    ↓
Phase 6 (US4 — Brute-force):
  T025 (rate-limit middleware) — parallel
  T026 (update ingress) depends on T013 + T025
  T027 (brute-force test) depends on T026
    ↓
Phase 7 (US5 — Administration):
  T028 (provision script) depends on T021 (deployment template)
  T029 (revoke script) — parallel with T028
  T030 (provisioning test) depends on T028 + T029
    ↓
Phase 8 (Polish):
  T031 (quickstart validation) depends on all prior
  T032-T034 — parallel with each other, after T030
```

## Parallel Execution Examples

### Batch 1: Setup + Foundational manifests (after T002-T005)

```
# These 5 manifest files are independent — create simultaneously:
Task T006: "Create namespace.yaml in deploy/k8s/"
Task T007: "Create configmap.yaml in deploy/k8s/"
Task T008: "Create secret.yaml template in deploy/k8s/"
Task T009: "Create cert-manager.yaml in deploy/k8s/"
Task T010: "Create middleware.yaml (TLS + headers) in deploy/k8s/"
```

### Batch 2: US2 + US3 infrastructure (after Phase 3)

```
# PVC and NetworkPolicy are independent files:
Task T020: "Create pvc.yaml in deploy/k8s/"
Task T023: "Create networkpolicy.yaml in deploy/k8s/"
```

### Batch 3: Rate limiting + Provisioning scripts (after Phase 5)

```
# Rate-limit middleware and provisioning scripts are independent:
Task T025: "Create middleware-ratelimit.yaml in deploy/k8s/"
Task T028: "Create provision-user.sh in deploy/scripts/"
Task T029: "Create revoke-user.sh in deploy/scripts/"
```

### Batch 4: Polish (after Phase 7)

```
# Documentation tasks are independent files:
Task T032: "Update AGENTS.md with deployment section"
Task T033: "Create deploy/README.md"
```

## Implementation Strategy

**MVP scope**: Phase 1 + Phase 2 + Phase 3 (US1) = working HTTPS + auth-gated single instance. This alone satisfies FR-001, FR-002, FR-012, FR-013.

**Incremental delivery**:
1. **MVP** (Phases 1-3): One secure instance behind Authentik — immediately useful for a single user
2. **Persistence** (+ Phase 4): Data survives restarts — production-safe for daily use
3. **Multi-user** (+ Phases 5-6): Isolation + rate limiting — ready for team use
4. **Self-service** (+ Phase 7): Admin can provision/revoke without manual kubectl
5. **Polish** (+ Phase 8): Documentation + resource tuning — production-ready

## Notes

- [P] tasks = different files, no dependencies — safe to parallelize
- Container image (Phase 2) is the critical path — everything is blocked until it builds
- Authentik deployment takes 1-2 minutes for PostgreSQL initialization on first install
- All K8s manifests use Traefik CRDs (`traefik.io/v1alpha1`) not standard K8s Ingress
- PVC uses `local-path` storage class (K3s default) — no NFS or distributed storage needed
- Commit after each phase completion

## Validation Checklist

_GATE: Checked before returning_

- [x] All contracts (container, k8s, network, storage) have corresponding tasks
- [x] All spec entities (Deployment Instance, PVC, Ingress Route, Auth Event) have tasks
- [x] All 14 functional requirements covered by at least one task
- [x] Parallel tasks truly independent (different files, no shared dependencies)
- [x] Each task specifies exact file path
- [x] No task modifies same file as another [P] task in the same batch
- [x] User stories are independently testable
- [x] MVP scope defined (Phases 1-3)
