# Network & Security Contract: Ingress, TLS, Auth Middleware

**Feature**: 002-k3s-prod-deploy | **Date**: 2026-06-29

---

## Network Topology

```
Internet
   │
   ▼
┌──────────────────────────────────┐
│  Traefik (K3s default Ingress)   │
│  EntryPoints: web (:80), websecure (:443) │
│  TLS termination + cert-manager  │
└──────────────┬───────────────────┘
               │
    ┌──────────┼──────────────┐
    │          │              │
    ▼          ▼              ▼
┌────────┐ ┌──────────┐ ┌─────────────────┐
│TLS     │ │Security  │ │Authentik        │
│Redirect│ │Headers   │ │Forward-Auth     │
│(HTTP→  │ │(HSTS,    │ │                 │
│ HTTPS) │ │ X-Frame) │ │  Not authed?    │
└────────┘ └──────────┘ │  → 302 redirect │
                         │     to login    │
                         │                 │
                         │  Authed?        │
                         │  → X-Auth-User  │
                         │  → allow        │
                         └────────┬────────┘
                                  │ (authed)
                                  ▼
                         ┌─────────────────┐
                         │ AionUi Service  │
                         │ (ClusterIP:     │
                         │  25808)         │
                         └─────────────────┘
```

---

## TLS Configuration

### Certificate Issuer

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@example.com   # [CONFIGURE: admin email]
    privateKeySecretRef:
      name: letsencrypt-account-key
    solvers:
      - http01:
          ingress:
            class: traefik
```

### TLS Requirements

| Requirement | Implementation |
|-------------|----------------|
| FR-001: HTTPS only | Traefik `tls-redirect` middleware (HTTP → HTTPS 301) |
| FR-012: Auto cert provisioning | cert-manager + Let's Encrypt HTTP-01 |
| FR-012: Auto cert renewal | cert-manager renews 30 days before expiry |
| Minimum TLS version | 1.2 (Traefik default) |
| HSTS | `Strict-Transport-Security: max-age=31536000; includeSubDomains` |

---

## Middleware Chain

Every IngressRoute applies these middlewares in order:

### 1. TLS Redirect

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: tls-redirect
  namespace: aionui
spec:
  redirectScheme:
    scheme: https
    permanent: true
```

### 2. Security Headers (FR-013)

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: security-headers
  namespace: aionui
spec:
  headers:
    stsSeconds: 31536000
    stsIncludeSubdomains: true
    frameDeny: true
    contentTypeNosniff: true
    referrerPolicy: strict-origin-when-cross-origin
    customResponseHeaders:
      X-XSS-Protection: "0"
```

### 3. Rate Limiting — Auth Endpoints (FR-005)

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: rate-limit-auth
  namespace: aionui
spec:
  rateLimit:
    average: 5          # 5 requests per...
    period: 1m          # ...per minute per IP
    burst: 3            # allow short bursts of 3
    sourceCriterion:
      ipStrategy:
        depth: 0        # trust X-Forwarded-For
```

**Applied to**: Authentik login endpoints only (`/outpost.goauthentik.io/*`).

### 4. Rate Limiting — Application

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: rate-limit-app
  namespace: aionui
spec:
  rateLimit:
    average: 100        # 100 requests per...
    period: 1s          # ...per second per IP
    burst: 50
```

**Applied to**: All AionUi application routes.

### 5. Authentik Forward-Auth (FR-002)

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: authentik-forward-auth
  namespace: aionui
spec:
  forwardAuth:
    address: http://authentik-server.authentik.svc.cluster.local:9000/outpost.goauthentik.io/auth/traefik
    trustForwardHeader: true
    authResponseHeaders:
      - X-authentik-username
      - X-authentik-email
      - X-authentik-groups
```

---

## IngressRoute Template (per-user)

```yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: route-{username}
  namespace: aionui
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(`ai.example.com`) && PathPrefix(`/{username}`)
      kind: Rule
      middlewares:
        - name: security-headers
        - name: authentik-forward-auth
        - name: rate-limit-app
          # Note: strip prefix if using path-based routing
      services:
        - name: svc-{username}
          port: 25808
  tls:
    certResolver: letsencrypt
```

### Alternative: Subdomain-Based Routing

```yaml
    - match: Host(`{username}.ai.example.com`)
      kind: Rule
      # ... (same middlewares/services)
```

**Decision**: Path-prefix routing (`ai.example.com/{username}`) for simplicity. Subdomain routing requires wildcard DNS + wildcard TLS cert. Can migrate later.

---

## Network Policies

Restrict pod-to-pod communication:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: aionui-isolation
  namespace: aionui
spec:
  podSelector:
    matchLabels:
      app: aionui
  policyTypes:
    - Ingress
  ingress:
    # Allow Traefik (Ingress) to reach AionUi
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - port: 25808
    # DENY user-to-user traffic (instances can't reach each other)
```

---

## Port Allocation

| Port | Component | Scope |
|------|-----------|-------|
| 80 | Traefik HTTP (redirect to 443) | Node |
| 443 | Traefik HTTPS (TLS terminated) | Node |
| 25808 | AionUi WebUI | ClusterIP (per-user service) |
| 9000 | Authentik server | ClusterIP (authentik namespace) |
| 5432 | PostgreSQL (Authentik) | ClusterIP (authentik namespace) |
| 6379 | Redis (Authentik) | ClusterIP (authentik namespace) |

No ports exposed directly to the internet except 80 and 443 (Traefik).
