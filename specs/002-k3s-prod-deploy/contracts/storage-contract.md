# Storage Contract: PVC and Data Directory Layout

**Feature**: 002-k3s-prod-deploy | **Date**: 2026-06-29

---

## Storage Class

| Property | Value |
|----------|-------|
| **Name** | `local-path` (K3s default) |
| **Provisioner** | `rancher.io/local-path` |
| **Reclaim policy** | `Retain` (data survives PVC deletion) |
| **Volume binding mode** | `WaitForFirstConsumer` |
| **Node affinity** | Single node — all PVCs bind to the same node |

---

## PVC Specification (per-user)

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: pvc-{username}
  namespace: aionui
spec:
  accessModes:
    - ReadWriteOnce       # Single pod can read/write
  storageClassName: local-path
  resources:
    requests:
      storage: 10Gi       # Default; configurable per user
```

---

## Data Directory Layout (inside container at `/data`)

```
/data/
│
├── aionui-backend.db              # SQLite database (primary data store)
├── aionui-backend.db-wal          # SQLite Write-Ahead Log (active)
├── aionui-backend.db-shm          # SQLite shared memory (active)
│
├── logs/                          # aioncore + web-host logs
│   ├── 2026-06-29.aioncore.log    # Daily rotation (aioncore manages)
│   └── webui.log                  # WebUI server log
│
├── conversations/                 # Per-conversation agent workspaces
│   ├── opencode-temp-{id}/        # OpenCode agent workspace (ACP sessions)
│   │   ├── .opencode/             # opencode session data, skills
│   │   └── (project files)
│   └── aionrs-temp-{id}/          # Direct chat (aionrs) workspace
│       └── (generated files)
│
├── runtime/                       # Managed tools (auto-installed by aioncore)
│   └── managed-tools/
│       └── acp/                   # ACP agent binaries (claude, codex, etc.)
│
├── builtin-skills/                # Built-in skill definitions
│
└── aionrs-sessions/               # Direct chat session state
    └── index.json
```

---

## Data Persistence Guarantees

| Scenario | Data Safe? | Mechanism |
|----------|-----------|-----------|
| Pod crash/restart | ✅ | PVC persists; SQLite WAL ensures consistency |
| Pod deletion (Deployment deleted) | ✅ | PVC persists (Retain policy) |
| PVC deletion | ⚠️ Manual backup needed | Retain policy keeps data on disk but removes K8s reference |
| Node reboot | ✅ | local-path data on node filesystem; pod auto-restarts |
| Full node failure | ❌ | No replication (single-node). External backup required |

---

## Storage Monitoring

Monitor PVC usage to prevent storage exhaustion (edge case from spec):

```bash
# Check PVC usage
kubectl exec -n aionui deploy/aionui-{username} -- df -h /data

# Alert at 80% full
# (configure Prometheus/Grafana alert or simple cron-based check)
```

---

## Backup Strategy (external — out of scope for initial deployment)

Documented for reference. The spec states backup is performed externally.

### Option A: Volume Snapshot
```bash
# K3s local-path doesn't support snapshots natively.
# Use rsync/cron to copy /var/lib/rancher/k3s/storage/ to backup location
```

### Option B: SQLite Backup + File Copy
```bash
kubectl exec -n aionui deploy/aionui-{username} -- \
  sqlite3 /data/aionui-backend.db ".backup '/data/backup-$(date +%Y%m%d).db'"
kubectl cp aionui/{pod}:/data/backup-*.db ./backups/
```

---

## Per-User Storage Quota

Storage quotas are enforced at the PVC level (hard limit). When PVC is full:
- SQLite returns `SQLITE_FULL` errors
- aioncore logs the error
- User sees error in UI (conversation fails)
- PVC size can be increased: `kubectl edit pvc pvc-{username}` (local-path supports expansion)

**Recommended monitoring**: Alert admin at 80% PVC usage per user.
