# Implementation Plan: AionUi Production Deployment with Secure Authentication

**Branch**: `002-k3s-prod-deploy` | **Date**: 2026-06-29 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-k3s-prod-deploy/spec.md`

## Execution Flow (/plan command scope)

```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from context (deployment infrastructure)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands.

## Summary

Deploy AionUi as a containerized headless WebUI on a single-node K3s Kubernetes cluster with TLS-terminated Traefik Ingress, Authentik forward-auth gateway for centralized authentication, rate-limiting middleware, per-user instance isolation backed by local-path persistent volumes, and SMS-ready MFA architecture for future Twilio integration. The existing Dockerfile requires a complete rebuild to use the validated `electron-vite build` path with bundled aioncore binary.

## Technical Context

**Language/Version**: TypeScript/React 18 (application), Rust (aioncore backend — pre-built binary), YAML (K8s manifests), Dockerfile
**Primary Dependencies**: Bun 1.3+ (runtime), Node.js 22 (agent runtime), aioncore v0.1.36, opencode-ai, K3s v1.30+, Traefik (Ingress), cert-manager, Authentik
**Storage**: SQLite via aioncore (per-user instance), local-path PVC (K3s default storage class)
**Testing**: Manual integration testing (container build + K8s deploy + HTTP verification), `curl` health checks
**Target Platform**: Linux x86_64 (single-node K3s server)
**Project Type**: Infrastructure/deployment (not standard web/mobile/single — deployment manifests + container build)
**Performance Goals**: 99.5% uptime over 30-day window, <60s restart recovery, <10s brute-force detection
**Constraints**: Single-node only, <4GB RAM per user instance, no external database dependencies, SQLite (not networked DB), must preserve agent CLI capabilities (opencode, git, ssh)
**Scale/Scope**: 1–10 concurrent users, instance-per-user isolation model

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Evaluation |
|-----------|--------|------------|
| **I. Multi-Agent AI Integration** | ✅ PASS | Container includes Node.js + opencode + nvm PATH augmentation. Agents run inside the container with full CLI access. Agent protocol (ACP) preserved through headless WebUI mode. |
| **II. Modular Architecture First** | ✅ PASS | Deployment layer is separate from application code. No application code changes required. Infrastructure manifests are modular (Ingress, Deployment, Service, Middleware, PVC each separate files). |
| **III. User Experience Excellence** | ✅ PASS | Users access the full AionUi WebUI (identical SPA) via browser over HTTPS. Multi-conversation, workspace, agent features all preserved. Only access method changes (URL instead of desktop app). |
| **IV. Security and Privacy First** | ✅ PASS | This feature **enhances** security: adds TLS (FR-001), authentication gate (FR-002), brute-force protection (FR-005), credential encryption (FR-009), audit logging (FR-011), security headers (FR-013). Per-user data isolation (FR-004) is core. |
| **V. Developer Experience** | ✅ PASS | Standard infrastructure-as-code (YAML manifests). `kubectl`/`helm` management. Clear quickstart guide. No exotic tooling. |
| **Electron Framework** | ⚠️ N/A | Deployment uses headless WebUI mode (`scripts/webui.ts`), not Electron desktop. This is a supported mode of the application — the constitution describes the desktop experience; the WebUI mode is an officially supported alternative. |
| **TypeScript Standards** | ✅ PASS | No application TypeScript changes. K8s YAML manifests and Dockerfile follow standard patterns. |
| **Cross-Platform** | ✅ PASS | Container targets Linux x86_64 (deployment target). Application remains cross-platform for desktop users. Deployment is server-side only. |
| **Feature Branches / PR** | ✅ PASS | All work on `002-k3s-prod-deploy` branch. PR required before merge. |

**Gate Result**: **PASS** — No violations. One N/A (Electron desktop framework not used in headless mode, which is a supported alternative).

## Project Structure

### Documentation (this feature)

```
specs/002-k3s-prod-deploy/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output — technology decisions
├── data-model.md        # Phase 1 output — deployment data entities
├── quickstart.md        # Phase 1 output — deployment runbook
├── contracts/
│   ├── container-contract.md       # Container image specification
│   ├── k8s-deployment-contract.md  # K8s manifest structure
│   ├── network-security-contract.md # Ingress, TLS, auth middleware
│   └── storage-contract.md         # PVC and data directory layout
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (deployment artifacts at repository root)

```
docker/
├── Dockerfile            # Fixed multi-stage container build
└── .dockerignore         # Build context exclusions

deploy/k8s/
├── namespace.yaml        # aionui namespace
├── deployment.yaml       # AionUi pod template (per-user instance)
├── service.yaml          # ClusterIP service
├── pvc.yaml              # Persistent volume claim template
├── secret.yaml           # Sealed secrets (API keys, admin credentials)
├── configmap.yaml        # Non-secret configuration (env vars)
├── ingress.yaml          # Traefik IngressRoute with TLS
└── middleware.yaml       # Rate limiting + security headers + forward-auth

deploy/auth/
├── authentik-values.yaml # Authentik Helm chart values
└── flows/                # Auth flow definitions (password, MFA, Twilio SMS)

deploy/scripts/
├── provision-user.sh     # Create new per-user instance (Deployment + PVC + route)
└── revoke-user.sh        # Remove user instance and reclaim storage
```

**Structure Decision**: Deployment infrastructure (not standard Option 1/2/3 from template). Manifests live under `deploy/` at repository root, container build under `docker/`.

## Phase 0: Outline & Research

✅ Research complete — see [research.md](research.md)

Key decisions resolved:
1. **Container build**: Multi-stage Dockerfile using `electron-vite build` + aioncore binary (existing Dockerfile is broken)
2. **Ingress**: Traefik (K3s default) with cert-manager for TLS
3. **Auth gateway**: Authentik (native Twilio SMS stage, forward-auth, OIDC)
4. **Isolation model**: Instance-per-user (separate Deployment + PVC per user)
5. **Storage**: local-path provisioner (K3s default, single-node appropriate)
6. **Provisioning**: Shell scripts wrapping kubectl (no operator needed for <10 users)

**Output**: research.md ✅ complete

## Phase 1: Design & Contracts

_Prerequisites: research.md complete_

✅ Design artifacts generated:
- [data-model.md](data-model.md) — Deployment entities and relationships
- [contracts/](contracts/) — Container, K8s, network/security, and storage contracts
- [quickstart.md](quickstart.md) — Step-by-step deployment runbook

## Phase 2: Task Planning Approach

_This section describes what the /tasks command will do - DO NOT execute during /plan_

**Task Generation Strategy**:

- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Tasks grouped by layer: Container → K8s Infrastructure → Auth Gateway → Provisioning → Validation

**Layer Ordering Strategy**:

1. **Container tasks** (fix Dockerfile, validate build, test locally)
2. **K8s infrastructure tasks** (namespace, deployment, service, PVC, configmap)
3. **Network/security tasks** (Ingress with TLS, rate limiting middleware, security headers)
4. **Auth gateway tasks** (Authentik Helm deploy, forward-auth middleware, test auth flow)
5. **Provisioning tasks** (provision-user script, revoke-user script, multi-user isolation test)
6. **Validation tasks** (end-to-end quickstart, persistence test, brute-force test)

**Estimated Output**: 20-25 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation

_These phases are beyond the scope of the /plan command_

**Phase 3**: Task execution (/tasks command creates tasks.md)
**Phase 4**: Implementation (execute tasks.md following constitutional principles)
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking

_No violations to document — all constitution checks pass._

## Progress Tracking

_Updated during execution flow_

**Phase Status**:

- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:

- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [x] Complexity deviations documented (none needed)

---

_Based on Constitution v1.0.0 — See `/memory/constitution.md`_
