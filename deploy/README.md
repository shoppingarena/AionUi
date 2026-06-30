# AionUi Production Deployment

Headless WebUI deployment on single-node K3s with Authentik authentication gateway.

## Architecture

```
Internet
   │
   ▼
┌──────────────────────────────────┐
│  Traefik (K3s default Ingress)   │
│  :80 → 301 → :443 (TLS)         │
│  :443 (cert-manager + Let's Enc) │
└──────────────┬───────────────────┘
               │
    ┌──────────┼──────────────┐
    │          │              │
    ▼          ▼              ▼
┌────────┐ ┌──────────┐ ┌─────────────────┐
│TLS     │ │Security  │ │Authentik        │
│Redirect│ │Headers   │ │Forward-Auth     │
└────────┘ └──────────└────────┬──────────┘
                               │ (authed)
                               ▼
                    ┌─────────────────────┐
                    │ AionUi Instance     │
                    │ (Pod + PVC)         │
                    │ Port 25808          │
                    │ SQLite @ /data      │
                    └─────────────────────┘
```

## File Layout

```
docker/
├── Dockerfile              # Multi-stage build (builder + runtime)
└── (uses root .dockerignore)

deploy/
├── k8s/
│   ├── namespace.yaml              # aionui namespace
│   ├── configmap.yaml              # Shared env vars
│   ├── secret.yaml.example         # API keys template
│   ├── cert-manager.yaml           # Let's Encrypt ClusterIssuer
├─  ├── middleware.yaml             # TLS redirect + security headers
│   ├── middleware-authentik.yaml   # Authentik forward-auth
│   ├── middleware-ratelimit.yaml   # Rate limiting (auth + app)
│   ├── deployment.yaml             # Base pod template
│   ├── service.yaml                # ClusterIP service
│   ├── ingress.yaml                # Traefik IngressRoute + TLS
│   ├── pvc.yaml                    # PVC (10Gi local-path)
│   └── networkpolicy.yaml          # Pod isolation
├── auth/
│   └── authentik-values.yaml       # Authentik Helm chart config
└── scripts/
    ├── provision-user.sh           # Create per-user instance
    └── revoke-user.sh              # Remove per-user instance
```

## Quick Start

### 1. Build the container image

```bash
docker build -f docker/Dockerfile -t aionui:v2.1.23 .
```

### 2. Configure secrets

```bash
cp deploy/k8s/secret.yaml.example deploy/k8s/secret.yaml
# Edit secret.yaml with base64-encoded API keys
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/secret.yaml
```

### 3. Configure DNS and TLS

```bash
# Edit cert-manager.yaml: set your admin email
# Edit ingress.yaml: replace ai.example.com with your domain
```

### 4. Install cert-manager (if not present)

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.15.0/cert-manager.yaml
kubectl apply -f deploy/k8s/cert-manager.yaml
```

### 5. Deploy Authentik

```bash
helm repo add authentik https://charts.goauthentik.io
helm repo update
helm install authentik authentik/authentik \
  -f deploy/auth/authentik-values.yaml \
  -n authentik --create-namespace
```

### 6. Deploy AionUi base infrastructure

```bash
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/middleware.yaml
kubectl apply -f deploy/k8s/middleware-authentik.yaml
kubectl apply -f deploy/k8s/middleware-ratelimit.yaml
kubectl apply -f deploy/k8s/pvc.yaml
kubectl apply -f deploy/k8s/deployment.yaml
kubectl apply -f deploy/k8s/service.yaml
kubectl apply -f deploy/k8s/ingress.yaml
kubectl apply -f deploy/k8s/networkpolicy.yaml
```

### 7. Provision users

```bash
./deploy/scripts/provision-user.sh alice --domain ai.lab.local
# Outputs: URL + initial password
```

### 8. Revoke users

```bash
./deploy/scripts/revoke-user.sh alice --keep-data  # preserve storage
./deploy/scripts/revoke-user.sh alice               # delete everything
```

## Common Commands

```bash
# Check pod status
kubectl -n aionui get pods

# Check pod logs
kubectl -n aionui logs -l app=aionui --tail=50

# Check PVC usage
kubectl -n aionui exec deploy/aionui-default -- df -h /data

# Port-forward for debugging
kubectl -n aionui port-forward svc-default 25808:25808

# Scale down all instances
kubectl -n aionui scale deployment -l app=aionui --replicas=0
```

## Resource Budget (4-core / 8GB node)

| Component         | CPU Req | RAM Req | RAM Limit |
|-------------------|---------|---------|-----------|
| Authentik server  | 250m    | 512Mi   | 1Gi       |
| Authentik worker  | 100m    | 256Mi   | 512Mi     |
| PostgreSQL        | 250m    | 256Mi   | 512Mi     |
| Redis             | 50m     | 64Mi    | 128Mi     |
| cert-manager      | 100m    | 128Mi   | 256Mi     |
| **Per user inst** | 500m    | 2Gi     | 4Gi       |
| **Overhead**      | ~750m   | ~1.2Gi  | ~2.4Gi    |
| **Available**     | ~3.2 cores | ~6.8Gi | —       |
| **Max users**     | **~6**  | **~3**  | —         |

RAM is the limiting factor. For more users, increase node RAM or reduce per-user limits.

## Database Note

AionUi uses **SQLite** (embedded in the aioncore Rust binary). PostgreSQL is NOT
supported — aioncore is compiled with `sqlx-sqlite` only. PostgreSQL is used
only for Authentik (the auth gateway). Each user instance has its own isolated
SQLite database on its own PVC.
