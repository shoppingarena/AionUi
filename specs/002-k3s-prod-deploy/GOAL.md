# GOAL: AionUi Production Deployment on K3s

**Branch**: `002-k3s-prod-deploy`
**Created**: 2026-06-30
**Source**: Derived from `tasks.md` (34 tasks, 8 phases)
**Loop**: Combined #035 (Goal Forge) + #027 (autonomy-loop)

---

## Objective

Deploy AionUi as a containerized headless WebUI on single-node K3s with:
- TLS-terminated Traefik Ingress (HTTPS)
- Authentik forward-auth gateway (centralized authentication)
- Per-user instance isolation (separate pod + PVC per user)
- Rate-limiting and security headers
- Shell-script user provisioning/revoke workflow
- Target: 1–10 concurrent users, 99.5% uptime, <60s restart recovery

## Authority Boundaries

- **Autonomous** (no approval needed): File creation in `docker/`, `deploy/`, specs
- **Autonomous**: Local `docker build` and container testing
- **Circuit breaker** (park for human): `kubectl apply` to live cluster, `helm install`, DNS changes, any destructive K8s operation
- **Circuit breaker**: Any change to `packages/` application source code

## Database Decision

PostgreSQL evaluated and rejected for AionUi application data:
- aioncore (Rust binary) compiled with `sqlx-sqlite` only — no PostgreSQL driver linked
- Node.js layer in WebUI mode uses no database (pure reverse proxy to aioncore)
- PostgreSQL IS used for Authentik (auth gateway) as planned
- SQLite with WAL mode is production-safe for 1-10 users on single node with per-user PVC isolation

## done_when Checks (Observable Evidence)

### Phase 1-2: Container Image (MVP Foundation)

- [ ] `docker/` directory exists with `Dockerfile` and `.dockerignore`
- [ ] `docker build -f docker/Dockerfile -t aionui:v2.1.23 .` succeeds with exit code 0
- [ ] `docker run -p 25808:25808 -v aionui-test:/data aionui:v2.1.23` starts and serves HTTP
- [ ] `curl http://localhost:25808/api/auth/status` returns HTTP 200
- [ ] `curl http://localhost:25808/` returns HTML (SPA loads)
- [ ] `docker exec <container> opencode --version` succeeds
- [ ] Container image < 500MB runtime layer

### Phase 3: Secure HTTPS Access + Authentication Gate

- [ ] All K8s manifests exist in `deploy/k8s/` (namespace, configmap, secret, cert-manager, middleware, deployment, service, ingress)
- [ ] Authentik Helm values exist in `deploy/auth/authentik-values.yaml`
- [ ] `kubectl get pods -n aionui` shows running pod
- [ ] `curl -k https://<host>/` returns redirect to Authentik login (unauthenticated)
- [ ] Browser auth → AionUi WebUI loads fully
- [ ] TLS cert is valid (no browser warnings)

### Phase 4: Data Persistence

- [ ] PVC template exists in `deploy/k8s/pvc.yaml`
- [ ] Deployment has readiness/liveness/startup probes on `/api/auth/status`
- [ ] Create conversation → `kubectl delete pod` → conversation data intact

### Phase 5: Per-User Isolation

- [ ] NetworkPolicy denies pod-to-pod traffic
- [ ] Two instances deployed → each only sees its own data → cross-pod traffic blocked

### Phase 6: Brute-Force Protection

- [ ] Rate-limit middleware exists in `deploy/k8s/middleware-ratelimit.yaml`
- [ ] 6 rapid failed logins → 429 on 6th → clears after 60s

### Phase 7: User Administration

- [ ] `deploy/scripts/provision-user.sh` exists and creates a working instance in <60s
- [ ] `deploy/scripts/revoke-user.sh` exists and removes access
- [ ] Test: provision alice → access works → revoke → access removed

### Phase 8: Polish

- [ ] `deploy/README.md` exists with architecture + commands
- [ ] AGENTS.md updated with deployment section
- [ ] Resource budget verified (Authentik + 2 instances fit node resources)

## Stopping Condition

The loop stops when:
1. All done_when checks pass, OR
2. A circuit breaker fires (needs human approval for cluster operations), OR
3. All autonomous phases (1-2 + manifest creation in 3-8) are complete and only cluster-deploy tasks remain

## Execution Strategy

- Phases 1-2: Fully autonomous (local docker build + verify)
- Phase 3+ manifest creation: Autonomous (file writing only)
- Phase 3+ cluster deployment: Circuit breaker — park for human with `kubectl apply` commands
- Git commit after each verified phase
