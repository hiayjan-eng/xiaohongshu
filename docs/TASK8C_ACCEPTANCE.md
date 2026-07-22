# Task 8C Acceptance

## 1. Scope And Baseline

Task 8C is implemented on `phase1-task8c-activation-preflight`, branched from Task 8B commit `d20660316ed10bd647d06166f181cc49b77b47c8`. It stops at `activation_prepared`. The authoritative backend remains `localStorage`; `activating`, `indexeddb_active`, controlled reload, `activeStorageSwitched=true`, main integration and deployment remain outside this task.

## 2. Source Drift

The authoritative legacy keys are fixed to:

- `collection-revival-system:v1`
- `collection-revival-theme`
- `collection-revival-achievements`

The Bootstrap Marker, runtime notification key, developer/QA keys, unknown keys, extension state and `chrome.storage.local` are excluded. `checkSourceDrift` regenerates a read-only raw backup from the three fixed keys, verifies the persisted Backup Envelope, compares the raw SHA-256 evidence, hydrates source and current runtime bundles, then compares canonical SHA-256 values and reports `app_state`, `theme` and `achievements` independently. It never calls demo fallback, text repair, classification, localStorage writes or IndexedDB writes. Corrupt source JSON produces a safe blocking issue without exposing content.

## 3. Full Target Verification

`runActivationPreflight` requires exactly one completed, not-activated migration. It verifies the persisted Backup Envelope, MigrationMetadata state and checkpoints, target schema/runtime health, every migration Store SHA-256, runtime metadata, order manifest and complete runtime round-trip equivalence. Runtime comparison includes all AppState collections, user record, collection order, theme and achievements. Reports omit user content, raw JSON, URLs, full checksums and Backup data; full hashes remain only in in-memory evidence used by Prepare.

Browser capability checks require Web Locks, Web Crypto, IndexedDB, readable legacy storage and an available adapter. `indexedDB.databases()` may be a warning only when the completed session already proves the target database exists. At least BroadcastChannel or the storage-event fallback is mandatory.

## 4. Coordination And Write Gate

Prepare reuses the Task 6 writer lock `collection-revival:migration-writer`. Only `WebLocksMigrationLockProvider` is accepted; Memory Lock and lockless fallback are rejected. `StorageWriteGate` blocks new AppState, theme and achievement persistence at the RuntimePersistCoordinator boundary. Already accepted writes finish before the freeze is considered drained. Other tabs receive `activation_preflight_started`, `activation_prepared` and `activation_prepare_cancelled` through `collection-revival-storage-runtime:v1`.

When BroadcastChannel is unavailable, a transient internal key, `collection-revival-storage-runtime-event:v1`, carries the same content-free notification through the browser storage event. It is immediately removed and is excluded from source drift. A cancel notification is not trusted by itself: receiving tabs re-read the Bootstrap Marker before reopening writes.

## 5. Bootstrap Marker

The key is `collection-revival-storage-bootstrap:v1`. Task 8C permits only `legacy_active`, `activation_prepared` and `recovery_required`, and `activeBackend` is always `localStorage`. The Marker carries revision, migration/activation/journal ids, fixed database/schema identity, verification evidence and timestamps, but no product data.

Marker construction and reads are inert. Writes require the writer lock, compare the expected revision, increment it exactly once, serialize canonically and perform read-back verification. Missing Marker preserves normal legacy boot. Invalid or unsupported Marker is never overwritten automatically and blocks ordinary App boot.

## 6. Activation Journal

Activation Journal records reuse the `migrationMetadata` Store with `recordType: "activation"`, leaving migration records as a separate discriminated union member. Task 8C statuses are `preparing`, `prepared`, `prepare_failed` and `cancelled`. `createOrReuse` is transactional and immutable: identical evidence is idempotently reused, conflicting evidence is rejected, and an independent read-back is required.

A valid prepared state requires Marker and Journal to agree on migration id, activation id, journal id, source/target checksums and prepared Marker revision. Missing, conflicting, multiple active or recovery states block Prepare.

## 7. Prepare Order And Failure Windows

The implemented order is:

1. require all four user confirmations;
2. acquire the migration writer Web Lock;
3. read Marker and freeze Runtime writes;
4. publish preflight notification and drain accepted writes;
5. rerun source drift and full target verification under the lock;
6. create or reuse Journal `preparing`;
7. write/read-back Marker `activation_prepared`;
8. transition/read-back Journal `prepared`;
9. publish prepared notification and keep the gate frozen;
10. release the lock.

If Journal `preparing` succeeds but Marker fails, Journal becomes `prepare_failed`, the gate reopens and legacy remains authoritative. If Marker succeeds but Journal finalization fails, the Marker revision advances to `recovery_required`, the gate stays frozen and startup blocks for recovery. No path writes `activeBackend=indexedDB` or `activeStorageSwitched=true`.

Repeated Prepare under a consistent prepared Marker/Journal pair reruns preflight and returns idempotently without replacing evidence. It does not rewrite Marker, duplicate Journal or reload.

## 8. Cancel Prepare

Cancel requires explicit confirmation, the same Web Lock, an inactive completed migration, and an exactly matching prepared Marker/Journal pair. Journal transitions to `cancelled`; Marker revision advances to `legacy_active`; tabs re-read Marker and reopen the write gate. Cancel does not clear IndexedDB, delete Backup, delete MigrationMetadata, delete Journal, roll back migration or change the active backend.

Task 7C resume/rollback checks the Marker first. `activation_prepared`, `recovery_required`, invalid or unsupported Marker blocks Task 7C so it cannot bypass the activation protocol.

## 9. AppBootstrap And UI

Ordinary startup reads Marker before opening the normal App Runtime. Missing or `legacy_active` continues with LocalStorageRuntime. `activation_prepared` and recovery states render a startup-level blocking screen and do not instantiate IndexedDbRuntime as App authority. The migration route remains available for inspection and cancellation.

The `completed_not_activated` page now offers “检查启用条件”, never “正式启用”. The single reducer covers idle, checking, eligible/blocked, confirmation, preparing, prepared, cancelling and safe failure states. The prepared screen explicitly shows localStorage as current source, the new store as prepared but not active, no automatic reload, and a cancel action. The downloadable safe report contains no user content or complete checksum.

## 10. Tests And Performance

Storage runtime tests cover Marker construction/revision/corruption, Journal create/reuse/conflict, source drift by domain, write gate, BroadcastChannel and storage-event fallback, capability gates, Prepare success/failure/idempotency/recovery and Cancel. Adapter/runtime regression suites continue to include 3,000-record migration and 10,000-record codec round-trip coverage.

Task 8C Playwright scenarios cover successful preflight/prepare/cancel, theme drift, target mismatch, concurrent two-tab Prepare, prepared/corrupt Marker boot blocking and 390px mobile layout. Screenshots are generated under `apps/web/test-results/task8c-activation-preflight/` and are intentionally ignored by Git.

## 11. Acceptance

`TASK8C_ACCEPTANCE_STATUS: PASS_WITH_NON_BLOCKING_GAPS`

Closed blocking boundaries:

- source drift and target mismatch prevent Marker/Journal writes;
- formal Prepare requires Web Locks and has no Memory Lock fallback;
- Marker and Journal use monotonic, read-back-verified evidence;
- the Marker-success/Journal-failure window enters `recovery_required`;
- ordinary startup never selects IndexedDB in Task 8C;
- active backend, localStorage source data and `activeStorageSwitched` remain unchanged.

Non-blocking gaps retained for Task 8D/8E:

- Task 8C has a minimal startup blocker, not the complete recovery workflow;
- storage-event fallback is unit-tested and multi-tab Web Locks are browser-tested, while a separate legacy-editing-tab flush acknowledgement protocol is not introduced;
- visual evidence covers implemented success, drift, target mismatch, concurrent, startup-block and mobile states rather than every synthetic capability error;
- no real user profile or production database was used.

Task 8D may begin from this branch after explicit instruction. Task 8C is not authorized to merge main or deploy.