# Quickstart: AionUi K3s Production Deployment

**Feature**: 002-k3s-prod-deploy | **Date**: 2026-06-29

---

## Prerequisites

- Single-node K3s cluster (v1.30+) with Traefik Ingress enabled
- Domain name pointing to the K3s node's public IP (A record)
- `kubectl` configured and connected to the cluster
- Docker (or Podman) for building the container image
- Container registry access (GHCR, Docker Hub, or local registry)
- Minimum 4 CPU cores, 8GB RAM on the K3s node

---

## Step 1: Build the Container Image

```bash
# From the AionUi repository root (branch: 002-k3s-prod-deploy)
docker build -f docker/Dockerfile -t aionui:v2.1.23 .

# Test locally
docker run -p 25808:25808 -v aionui-test:/data aionui:v2.1.23

# Verify health
curl http://localhost:25808/api/auth/status
# Expected: {"needs_setup": true, ...}

# Push to registry
docker tag aionui:v2.1.23 ghcr.io/your-org/aionui:v2.1.23
docker push ghcr.io/your-org/aionui:v2.1.23
```

---

## Step 2: Install cert-manager

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.15.0/cert-manager.yaml

# Wait for cert-manager to be ready
kubectl wait --for=condition=Available deployment/cert-manager -n cert-manager --timeout=60s

# Create Let's Encrypt ClusterIssuer
kubectl apply -f - <<'EOF'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@your-domain.com    # CHANGE THIS
    privateKeySecretRef:
      name: letsencrypt-account-key
    solvers:
      - http01:
          ingress:
            class: traefik
EOF
```

---

## Step 3: Deploy AionUi Namespace and Config

```bash
# Create namespace
kubectl create namespace aionui

# Apply ConfigMap
kubectl apply -f deploy/k8s/configmap.yaml

# Apply shared Secrets (model provider keys, etc.)
kubectl apply -f deploy/k8s/secret.yaml
# EDIT secret.yaml first with your base64-encoded API keys
```

---

## Step 4: Apply Security Middlewares

```bash
kubectl apply -f deploy/k8s/middleware.yaml
# Creates: tls-redirect, security-headers, rate-limit-auth, rate-limit-app
```

---

## Step 5: Provision First User

```bash
# Provision a user instance (creates Deployment + Service + PVC + IngressRoute)
./deploy/scripts/provision-user.sh alice

# Expected output:
# ✅ PVC pvc-alice created (10Gi)
# ✅ Deployment aionui-alice created
# ✅ Service svc-alice created
# ✅ IngressRoute route-alice created
# ✅ Admin password: <random-password>
```

---

## Step 6: Verify AionUi Instance

```bash
# Check pod is running
kubectl get pods -n aionui -l app=aionui-alice

# Check health
kubectl exec -n aionui deploy/aionui-alice -- curl -s http://localhost:25808/api/auth/status

# Test external access (without auth — will be behind Authentik after Step 7)
curl -k https://ai.your-domain.com/alice/api/auth/status
```

---

## Step 7: Deploy Authentik (Auth Gateway)

```bash
# Add Authentik Helm repo
helm repo add authentik https://charts.goauthentik.io
helm repo update

# Create authentik namespace
kubectl create namespace authentik

# Deploy Authentik
# EDIT deploy/auth/authentik-values.yaml: set email, password, domain
helm install authentik authentik/authentik \
  -f deploy/auth/authentik-values.yaml \
  -n authentik

# Wait for Authentik to be ready (takes 1-2 minutes)
kubectl wait --for=condition=Available deployment/authentik-server -n authentik --timeout=180s

# Apply Authentik forward-auth middleware
kubectl apply -f deploy/k8s/middleware-authentik.yaml
```

---

## Step 8: Configure Authentik Application

1. Open Authentik admin UI: `https://auth.your-domain.com`
2. Login with admin credentials from `authentik-values.yaml`
3. **Create Application**:
   - Name: `AionUi`
   - Slug: `aionui`
   - Launch URL: `https://ai.your-domain.com`
4. **Create Provider**:
   - Type: Proxy (forward-auth for Traefik)
   - Name: `aionui-proxy`
   - Authorization flow: `default-authentication-flow`
5. **Create Outpost**:
   - Type: Proxy
   - Bind to: `aionui-proxy` provider
   - Deploy to: `authentik` namespace
6. **Bind Application to Outpost**

---

## Step 9: Test End-to-End

```bash
# Unauthenticated access should redirect to Authentik login
curl -L https://ai.your-domain.com/alice
# Expected: Redirects to https://auth.your-domain.com/...

# Authenticate via browser:
# 1. Navigate to https://ai.your-domain.com/alice
# 2. Authentik login page appears
# 3. Enter alice's credentials
# 4. Redirected back to AionUi application
# 5. AionUi WebUI loads — ready to use
```

---

## Step 10: Add More Users

```bash
./deploy/scripts/provision-user.sh bob
./deploy/scripts/provision-user.sh carol

# Each user gets:
# - Their own AionUi instance (isolated pod + PVC)
# - Their own path: https://ai.your-domain.com/bob, /carol
# - Authentik account (create in Authentik admin UI)
```

---

## Verification Checklist

- [ ] Container image builds and runs locally
- [ ] cert-manager issues TLS certificate (check: `kubectl get certificate -A`)
- [ ] No browser TLS warnings on `https://ai.your-domain.com`
- [ ] Unauthenticated requests redirect to Authentik login (FR-002)
- [ ] After login, AionUi WebUI loads fully
- [ ] Conversations persist across pod restart (FR-003)
  - `kubectl delete pod -l app=aionui-alice -n aionui` → pod recreates → data intact
- [ ] Two users cannot see each other's data (FR-004)
- [ ] 6+ failed login attempts trigger rate limit (FR-005)
- [ ] Security headers present in response (FR-013)
  - `curl -I https://ai.your-domain.com/alice` → check HSTS, X-Frame-Options
- [ ] Health endpoint responds: `GET /api/auth/status` → 200 (FR-007)

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| TLS cert not issued | Check cert-manager logs: `kubectl logs -n cert-manager deploy/cert-manager` |
| Authentik redirect loop | Ensure Traefik forwards `X-Forwarded-*` headers; check outpost is running |
| Pod CrashLoopBackOff | Check logs: `kubectl logs -n aionui deploy/aionui-alice` |
| SQLite "database locked" | Normal during startup; should resolve in <30s. If persistent, check for duplicate pods |
| PVC pending | Check local-path-provisioner: `kubectl get pv` and node storage |
| Agent (opencode) not found | Verify container includes Node.js + opencode: `kubectl exec <pod> -- opencode --version` |
