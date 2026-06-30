#!/usr/bin/env bash
# =============================================================================
# provision-user.sh — Create a new per-user AionUi instance
#
# Creates:
#   1. K8s Secret      secret-{username}     — random admin password
#   2. PVC             pvc-{username}        — 10Gi local-path storage
#   3. Deployment      aionui-{username}     — AionUi pod from image
#   4. Service         svc-{username}        — ClusterIP on port 25808
#   5. IngressRoute    route-{username}      — HTTPS path-prefix routing
#
# Usage:   ./deploy/scripts/provision-user.sh <username> [--domain ai.example.com]
# Example: ./deploy/scripts/provision-user.sh alice --domain ai.lab.local
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
USERNAME="${1:?Usage: provision-user.sh <username> [--domain <domain>]}"
shift

DOMAIN="ai.example.com"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

NAMESPACE="aionui"
IMAGE="${AIONUI_IMAGE:-aionui:v2.1.23}"
STORAGE_SIZE="${AIONUI_STORAGE:-10Gi}"
PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)
PASSWORD_B64=$(echo -n "$PASSWORD" | base64)

echo "============================================================"
echo "  Provisioning AionUi instance for: $USERNAME"
echo "  Domain: $DOMAIN"
echo "  Image:  $IMAGE"
echo "  Storage: $STORAGE_SIZE"
echo "============================================================"

# ---------------------------------------------------------------------------
# 1. Secret (admin password)
# ---------------------------------------------------------------------------
echo "→ Creating Secret: secret-${USERNAME}..."
kubectl create secret generic "secret-${USERNAME}" \
  --namespace "$NAMESPACE" \
  --from-literal=admin-password="$PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

# ---------------------------------------------------------------------------
# 2. PVC
# ---------------------------------------------------------------------------
echo "→ Creating PVC: pvc-${USERNAME}..."
cat <<EOF | kubectl apply -f -
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: pvc-${USERNAME}
  namespace: ${NAMESPACE}
  labels:
    app: aionui
    instance: ${USERNAME}
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: local-path
  resources:
    requests:
      storage: ${STORAGE_SIZE}
EOF

# ---------------------------------------------------------------------------
# 3. Deployment
# ---------------------------------------------------------------------------
echo "→ Creating Deployment: aionui-${USERNAME}..."
cat <<EOF | kubectl apply -f -
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aionui-${USERNAME}
  namespace: ${NAMESPACE}
  labels:
    app: aionui
    instance: ${USERNAME}
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: aionui
      instance: ${USERNAME}
  template:
    metadata:
      labels:
        app: aionui
        instance: ${USERNAME}
    spec:
      containers:
        - name: aionui
          image: ${IMAGE}
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 25808
              name: http
              protocol: TCP
          envFrom:
            - configMapRef:
                name: aionui-config
          volumeMounts:
            - name: data
              mountPath: /data
          resources:
            requests:
              cpu: 500m
              memory: 2Gi
            limits:
              cpu: 2000m
              memory: 4Gi
          readinessProbe:
            httpGet:
              path: /api/auth/status
              port: 25808
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/auth/status
              port: 25808
            initialDelaySeconds: 30
            periodSeconds: 30
          startupProbe:
            httpGet:
              path: /api/auth/status
              port: 25808
            periodSeconds: 5
            failureThreshold: 12
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "kill -TERM 1"]
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: pvc-${USERNAME}
      terminationGracePeriodSeconds: 30
EOF

# ---------------------------------------------------------------------------
# 4. Service
# ---------------------------------------------------------------------------
echo "→ Creating Service: svc-${USERNAME}..."
cat <<EOF | kubectl apply -f -
---
apiVersion: v1
kind: Service
metadata:
  name: svc-${USERNAME}
  namespace: ${NAMESPACE}
  labels:
    app: aionui
    instance: ${USERNAME}
spec:
  type: ClusterIP
  selector:
    app: aionui
    instance: ${USERNAME}
  ports:
    - name: http
      port: 25808
      targetPort: 25808
      protocol: TCP
EOF

# ---------------------------------------------------------------------------
# 5. IngressRoute
# ---------------------------------------------------------------------------
echo "→ Creating IngressRoute: route-${USERNAME}..."
cat <<EOF | kubectl apply -f -
---
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: route-${USERNAME}
  namespace: ${NAMESPACE}
  labels:
    app: aionui
    instance: ${USERNAME}
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(\`${DOMAIN}\`) && PathPrefix(\`/${USERNAME}\`)
      kind: Rule
      middlewares:
        - name: security-headers
          namespace: aionui
        - name: authentik-forward-auth
          namespace: aionui
        - name: rate-limit-app
          namespace: aionui
      services:
        - name: svc-${USERNAME}
          namespace: ${NAMESPACE}
          port: 25808
  tls:
    certResolver: letsencrypt
EOF

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
echo "  Provisioned: $USERNAME"
echo "============================================================"
echo "  URL:      https://${DOMAIN}/${USERNAME}"
echo "  Password: $PASSWORD"
echo "  (Change the password after first login)"
echo ""
echo "  Check status:"
echo "    kubectl -n ${NAMESPACE} get pods -l instance=${USERNAME}"
echo "============================================================"
