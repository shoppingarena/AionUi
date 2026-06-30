# Data Model: AionUi Production Deployment

**Feature**: 002-k3s-prod-deploy | **Date**: 2026-06-29

---

## Overview

This data model describes the **deployment-level entities** — not application-internal data structures. AionUi's internal data (conversations, messages, users) lives inside its SQLite database and is not modified by this feature. The entities here represent the infrastructure layer that surrounds and manages AionUi instances.

---

## Entities

### 1. Deployment Instance

A running AionUi pod serving one user.

| Field | Type | Description |
|-------|------|-------------|
| `instance_id` | string (generated) | Unique identifier, e.g., `aionui-user-alice` |
| `user_id` | string (from Authentik) | Authenticated user identity (email or username) |
| `namespace` | string | K8s namespace, default `aionui` |
| `image` | string | Container image reference, e.g., `ghcr.io/org/aionui:v2.1.23` |
| `port` | integer | Internal ClusterIP port (25808) |
| `pvc_name` | string | Persistent volume claim name for this user |
| `status` | enum | `provisioning` → `running` → `stopping` → `stopped` |
| `created_at` | timestamp | When the instance was provisioned |
| `last_probe` | timestamp | Last successful health-check probe |
| `storage_used` | integer (bytes) | Current PVC storage consumption |

**Relationships**:
- Belongs to exactly one **User Account**
- Has exactly one **PVC** (persistent volume)
- Serves exactly one **User Workspace**

**State transitions**:
```
[none] → provisioning → running → stopping → stopped → (deleted)
                                    ↓
                                (crash → auto-restart by K8s)
```

---

### 2. User Account (Authentik-side)

Managed by Authentik identity provider. This entity exists in Authentik's directory, not in AionUi.

| Field | Type | Description |
|-------|------|-------------|
| `username` | string | Login identifier |
| `email` | string | Email address (for notifications, recovery) |
| `password_hash` | string (opaque) | Stored in Authentik's database (not exposed) |
| `mfa_enrolled` | boolean | Whether MFA (TOTP/SMS) is configured |
| `mfa_method` | enum | `none`, `totp`, `sms` (future: `webauthn`) |
| `phone_number` | string (nullable) | E.164 format, for SMS verification (future) |
| `groups` | array[string] | Group memberships (e.g., `aionui-users`) |
| `is_active` | boolean | Whether the account can authenticate |
| `created_at` | timestamp | Account creation time |
| `last_login` | timestamp | Most recent successful authentication |

**Relationships**:
- Has exactly one **Deployment Instance**
- Has one **User Workspace** (via the Deployment Instance)

---

### 3. PVC (Persistent Volume Claim)

K8s storage allocation per user.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | K8s PVC name, e.g., `pvc-user-alice` |
| `storage_class` | string | `local-path` (K3s default) |
| `size` | string | `10Gi` (configurable) |
| `access_mode` | enum | `ReadWriteOnce` (single-pod, single-node) |
| `mount_path` | string | `/data` (inside container) |
| `bound_node` | string | K8s node name (for local-path) |

**Contents** (inside the PVC at `/data`):
```
/data/
├── aionui-backend.db          # SQLite database (conversations, messages, users)
├── aionui-backend.db-wal      # SQLite WAL file
├── aionui-backend.db-shm      # SQLite shared memory file
├── logs/                      # aioncore logs
├── conversations/             # Per-conversation workspace files
│   ├── opencode-temp-xxx/     # ACP agent workspaces
│   └── aionrs-temp-xxx/       # Direct chat workspaces
├── conversations/             # Per-conversation workspace files
│   ├── opencode-temp-xxx/     # ACP agent workspaces
│   └── aionrs-temp-xxx/       # Direct chat workspaces
└── runtime/                   # Managed tools (ACP agents, MCP servers)
```

---

### 4. Ingress Route

Traefik routing rule directing traffic from a domain path to the correct user instance.

| Field | Type | Description |
|-------|------|-------------|
| `route_name` | string | K8s IngressRoute name |
| `host` | string | Base domain, e.g., `ai.example.com` |
| `path_prefix` | string | User-specific path or subdomain, e.g., `/alice` or `alice.ai.example.com` |
| `backend_service` | string | Target K8s service name |
| `backend_port` | integer | Target port (25808) |
| `tls_cert_resolver` | string | `letsencrypt` |
| `middlewares` | array[string] | Applied middleware names |

**Middlewares applied to every route**:
- `tls-redirect` — HTTP → HTTPS
- `security-headers` — HSTS, X-Frame-Options, etc.
- `authentik-forward-auth` — Authentication gate
- `rate-limit-auth` — Brute-force protection on auth endpoints
- `rate-limit-app` — General rate limiting

---

### 5. Authentication Event

Audit log entry for an authentication attempt. Stored in Authentik's event log (not a separate database).

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | datetime | When the event occurred |
| `source_ip` | string | Client IP address (from X-Forwarded-For) |
| `username` | string | Attempted username |
| `outcome` | enum | `success`, `failure`, `locked_out`, `mfa_challenge` |
| `factor` | enum | `password`, `totp`, `sms` |
| `user_agent` | string | Browser/client identifier |
| `session_id` | string (nullable) | Session token if successful |

**Retention**: 30 days minimum (FR-011). Authentik retains events in PostgreSQL; configure cleanup policy.

---

### 6. Configuration Values

Non-secret configuration applied via K8s ConfigMap.

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `webui_port` | integer | Container listening port | `25808` |
| `allow_remote` | boolean | Bind to 0.0.0.0 | `true` |
| `log_level` | enum | `debug`, `info`, `warn`, `error` | `info` |
| `node_env` | string | Node.js environment | `production` |
| `no_build` | boolean | Skip renderer rebuild | `true` |
| `data_dir` | string | Data directory inside container | `/data` |
| `aionui_version` | string | Application version tag | `v2.1.23` |
| `default_model` | string | Default model for new users | (per-user config) |
| `max_conversations` | integer | Conversation limit per user | `1000` |

---

## Entity Relationship Diagram

```
┌─────────────────────────────┐
│     User Account            │
│     (Authentik directory)   │
│─────────────────────────────│
│ username                    │
│ email                       │          ┌─────────────────────┐
│ mfa_enrolled                │ 1───────►│  Deployment Instance│
│ phone_number (future)       │          │─────────────────────│
│ is_active                   │          │ instance_id         │
│ groups                      │          │ image               │
└─────────────────────────────┘          │ port                │
                                         │ status              │
                ┌───────────────────────►│ pvc_name            │
                │ 1                      └─────────┬───────────┘
                │                                  │ 1
    ┌───────────▼──────────┐                       │
    │        PVC           │◄──────────────────────┘
    │──────────────────────│
    │ name                 │        ┌─────────────────────┐
    │ storage_class        │        │  Ingress Route      │
    │ size                 │        │─────────────────────│
    │ mount_path: /data    │        │ host                │
    └──────────────────────┘        │ path_prefix         │
                                    │ backend_service ────┼──► (to Instance)
                                    │ tls + middlewares   │
                                    └─────────────────────┘

    ┌──────────────────────┐
    │  Authentication Event│  (stored in Authentik event log)
    │──────────────────────│
    │ timestamp            │
    │ source_ip            │
    │ username             │
    │ outcome              │
    └──────────────────────┘
```
