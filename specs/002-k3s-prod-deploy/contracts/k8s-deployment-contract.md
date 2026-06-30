# K8s Deployment Contract: AionUi Instance

**Feature**: 002-k3s-prod-deploy | **Date**: 2026-06-29

---

## Namespace

All AionUi resources live in namespace `aionui`. Authentik lives in namespace `authentik`.

---

## Deployment Template (per-user instance)

Each user gets a Deployment created from this template.

| Field | Value |
|-------|-------|
| **API version** | `apps/v1` |
| **Kind** | `Deployment` |
| **Name pattern** | `aionui-{username}` |
| **Replicas** | `1` (single instance per user) |
| **Strategy** | `Recreate` (not RollingUpdate — PVC is RWO, can't have 2 pods) |

### Pod Specification

| Container Property | Value |
|--------------------|-------|
| Image | `ghcr.io/org/aionui:v2.1.23` (or registry path) |
| Port | `25808/HTTP` |
| Resources (request) | `500m CPU, 2Gi RAM` |
| Resources (limit) | `2000m CPU, 4Gi RAM` |
| Volume mount | `/data` ← PVC `pvc-{username}` |

### Environment (from ConfigMap)

```yaml
envFrom:
  - configMapRef:
      name: aionui-config
```

### Environment (from Secret — per-user)

```yaml
env:
  - name: AIONUI_INITIAL_ADMIN_PASSWORD
    valueFrom:
      secretKeyRef:
        name: secret-{username}
        key: admin-password
```

### Probes

```yaml
readinessProbe:
  httpGet:
    path: /api/auth/status
    port: 25808
  initialDelaySeconds: 5
  periodSeconds: 10
  failureThreshold: 3

livenessProbe:
  httpGet:
    path: /api/auth/status
    port: 25808
  initialDelaySeconds: 30
  periodSeconds: 30
  failureThreshold: 3

startupProbe:
  httpGet:
    path: /api/auth/status
    port: 25808
  initialDelaySeconds: 0
  periodSeconds: 5
  failureThreshold: 12   # 60s max startup
```

### Lifecycle

```yaml
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "kill -TERM 1"]  # Signal aioncore to flush WAL
terminationGracePeriodSeconds: 30
```

---

## Service (per-user instance)

| Field | Value |
|-------|-------|
| **API version** | `v1` |
| **Kind** | `Service` |
| **Name pattern** | `svc-{username}` |
| **Type** | `ClusterIP` (not exposed externally; Traefik Ingress handles that) |
| **Port** | `25808 → 25808` |

---

## PVC (per-user instance)

| Field | Value |
|-------|-------|
| **API version** | `v1` |
| **Kind** | `PersistentVolumeClaim` |
| **Name pattern** | `pvc-{username}` |
| **Storage class** | `local-path` |
| **Access mode** | `ReadWriteOnce` |
| **Size** | `10Gi` (default, configurable per user) |

---

## ConfigMap (shared)

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: aionui-config
  namespace: aionui
data:
  AIONUI_NO_BUILD: "1"
  AIONUI_HOST: "0.0.0.0"
  AIONUI_DATA_DIR: "/data"
  AIONUI_LOG_DIR: "/data/logs"
  NODE_ENV: "production"
  PORT: "25808"
```

---

## Resource Budget (single-node K3s)

| Component | CPU Request | RAM Request | RAM Limit |
|-----------|-------------|-------------|-----------|
| Authentik server | 250m | 512Mi | 1Gi |
| Authentik worker | 100m | 256Mi | 512Mi |
| PostgreSQL (Authentik) | 250m | 256Mi | 512Mi |
| Redis (Authentik) | 50m | 64Mi | 128Mi |
| **Per AionUi instance** | 500m | 2Gi | 4Gi |
| cert-manager | 100m | 128Mi | 256Mi |
| **Total overhead** | ~750m | ~1.2Gi | ~2.4Gi |
| **Available for users** | (node_cpu - 750m) / 500m | (node_ram - 1.2Gi) / 2Gi | — |

**Example**: 4-core / 8GB node → ~6 user instances + overhead.

---

## Multi-User Provisioning Contract

### Provision User (`provision-user.sh <username>`)

Creates:
1. K8s Secret `secret-{username}` — random admin password
2. PVC `pvc-{username}` — 10Gi local-path
3. Deployment `aionui-{username}` — from template
4. Service `svc-{username}` — ClusterIP
5. Traefik IngressRoute `route-{username}` — path rule + middlewares

Post-condition: User can access `https://ai.example.com/{username}` after Authentik auth.

### Revoke User (`revoke-user.sh <username>`)

Deletes (in order):
1. IngressRoute `route-{username}` — stop new traffic
2. Deployment `aionui-{username}` — stop the pod
3. Service `svc-{username}` — cleanup
4. PVC `pvc-{username}` — reclaim storage (optional: `--keep-data` flag)
5. Secret `secret-{username}` — cleanup
6. Authentik: deactivate user account

Post-condition: User cannot access any endpoint. Data optionally preserved.
