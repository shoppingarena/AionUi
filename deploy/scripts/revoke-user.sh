#!/usr/bin/env bash
# =============================================================================
# revoke-user.sh — Remove an AionUi user instance
#
# Deletes (in order):
#   1. IngressRoute    route-{username}      — stop new traffic immediately
#   2. Deployment      aionui-{username}     — stop the pod
#   3. Service         svc-{username}        — cleanup networking
#   4. Secret          secret-{username}     — cleanup credentials
#   5. PVC             pvc-{username}        — reclaim storage (optional)
#
# Usage:   ./deploy/scripts/revoke-user.sh <username> [--keep-data]
# Example: ./deploy/scripts/revoke-user.sh alice --keep-data
# =============================================================================
set -euo pipefail

USERNAME="${1:?Usage: revoke-user.sh <username> [--keep-data]}"
shift

KEEP_DATA=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-data)
      KEEP_DATA=true
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

NAMESPACE="aionui"

echo "============================================================"
echo "  Revoking AionUi instance for: $USERNAME"
echo "  Keep data: $KEEP_DATA"
echo "============================================================"

# ---------------------------------------------------------------------------
# 1. IngressRoute (stop traffic immediately)
# ---------------------------------------------------------------------------
echo "→ Deleting IngressRoute: route-${USERNAME}..."
kubectl delete ingressroute "route-${USERNAME}" --namespace "$NAMESPACE" --ignore-not-found

# ---------------------------------------------------------------------------
# 2. Deployment (stop the pod)
# ---------------------------------------------------------------------------
echo "→ Deleting Deployment: aionui-${USERNAME}..."
kubectl delete deployment "aionui-${USERNAME}" --namespace "$NAMESPACE" --ignore-not-found

# ---------------------------------------------------------------------------
# 3. Service
# ---------------------------------------------------------------------------
echo "→ Deleting Service: svc-${USERNAME}..."
kubectl delete service "svc-${USERNAME}" --namespace "$NAMESPACE" --ignore-not-found

# ---------------------------------------------------------------------------
# 4. Secret
# ---------------------------------------------------------------------------
echo "→ Deleting Secret: secret-${USERNAME}..."
kubectl delete secret "secret-${USERNAME}" --namespace "$NAMESPACE" --ignore-not-found

# ---------------------------------------------------------------------------
# 5. PVC (optional — reclaim storage)
# ---------------------------------------------------------------------------
if [ "$KEEP_DATA" = true ]; then
  echo "→ Keeping PVC: pvc-${USERNAME} (--keep-data flag set)"
  echo "  Data preserved at: /var/lib/rancher/k3s/storage/pvc-${USERNAME}_*"
else
  echo "→ Deleting PVC: pvc-${USERNAME}..."
  kubectl delete pvc "pvc-${USERNAME}" --namespace "$NAMESPACE" --ignore-not-found
  echo "  ⚠️  Storage reclaimed. Data is no longer accessible."
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
echo "  Revoked: $USERNAME"
echo "============================================================"
if [ "$KEEP_DATA" = true ]; then
  echo "  Data preserved. To restore: re-provision with same username."
else
  echo "  All resources deleted including storage."
fi
echo "============================================================"
