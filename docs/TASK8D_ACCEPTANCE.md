# Task 8D Acceptance: two-phase IndexedDB activation and startup recovery

## 1. Scope and branch

- Branch: `phase1-task8d-indexeddb-activation`
- Start commit: `4c20d0417bdee68b9006194a4e9f310bcacdb44e`
- `main` and `origin/main`: `3b6e940a8ce724426f3924294e65a922556d18a3`
- Task 6 through Task 8D remain outside main. No PR, merge, production deployment, or real-user migration was performed.
- Allowed implementation areas were limited to storage-service, storage-runtime, Web bootstrap/activation/recovery UI, tests, and these design records. The extension and classification service were not changed.

## 2. Authority state machines

Bootstrap Marker v1 now accepts these strict combinations:

| Marker state | activeBackend | Runtime behavior |
|---|---|---|
| missing / `legacy_active` | `localStorage` | Start `LocalStorageRuntime` normally |
| `activation_prepared` | `localStorage` | Freeze product writes and direct the user to data management |
| `activating` | `indexedDB` | Hide the normal app and run activation boot |
| `indexeddb_active` | `indexedDB` | Verify committed evidence and start `IndexedDbRuntime` |
| `recovery_required`, invalid, unsupported, or conflicting | not guessed | Show startup Recovery Screen |

Marker revisions increase monotonically and writes use expected-revision plus read-back. The Marker never contains user content.

Activation Journal v1 supports `preparing`, `prepared`, `switching`, `boot_verifying`, `committed`, `cancelled`, `prepare_failed`, and `activation_failed`. The committed state is terminal for the forward activation flow. `activeStorageSwitched=true` and Journal `committed` are written in the same IndexedDB transaction.

## 3. Formal activation and final recheck

The formal activation action is available only after migration is complete and Prepare evidence remains consistent. It requires four separate confirmations:

1. Future product writes go only to IndexedDB.
2. Legacy localStorage remains as a read-only history snapshot, not a writable fallback.
3. Task 7 migration rollback cannot be used after activation commit.
4. A failed boot opens Recovery instead of silently selecting legacy data.

After confirmation, `ActivationSwitcher` acquires the production Web Locks provider under `collection-revival:migration-writer`, keeps the write gate frozen, flushes accepted legacy writes, and reruns the complete activation preflight. This rechecks Marker, Journal, migration completion, `activeStorageSwitched=false`, source drift, raw Backup, target schema and checksums, runtime hydrate/equivalence, browser capabilities, and unresolved sessions.

The switching order is fixed:

1. Journal `prepared -> switching`, then read-back.
2. Marker revision increments to `activating` with `activeBackend=indexedDB`, then read-back.
3. Journal records the activating Marker revision.
4. Publish `storage_activation_started` and set the gate to `activation_switching`.
5. Release the writer lock.
6. Invoke the injected `ControlledReloader`.

A Journal failure does not write the Marker. A Marker failure records safe recovery evidence and does not reload. A crash after the activating Marker is durable resumes through startup activation boot.

## 4. Activation boot and commit

`AppBootstrap` reads only the Bootstrap Marker to choose the initial backend. It does not open IndexedDB for missing/legacy markers and does not construct `LocalStorageRuntime` for activating, active, or recovery states.

Activation boot performs:

1. Capability check and writer lock acquisition.
2. IndexedDB open before reading IndexedDB Journal/metadata evidence.
3. Marker, Journal, migration id, activation id, schema and authority consistency checks.
4. Non-destructive health check and full AppState/theme/achievements hydrate.
5. Runtime metadata/order manifest and pre-commit target checksum verification.
6. Journal transition to `boot_verifying`.
7. Atomic activation commit.
8. Marker finalization to `indexeddb_active`.
9. `storage_backend_activated` broadcast and IndexedDB write-gate opening.
10. Rendering of the normal app only after all preceding steps succeed.

The atomic commit transaction updates MigrationMetadata (`activeStorageSwitched=true`, time and activation id), Journal (`committed`, time and safe verification summary), and `runtime:activation:v1`. It then performs an independent read-back. Marker finalization happens only after that IndexedDB transaction commits.

The prepared runtime checksum is a cutover invariant and is checked before commit. After commit, legitimate IndexedDB edits change the runtime bundle; normal boots therefore validate committed activation evidence, schema, health and hydrate integrity instead of comparing mutable user state to the old prepared checksum.

## 5. Normal writes and retained legacy data

After `indexeddb_active`, AppState changes and product settings are persisted through `IndexedDbRuntime`. Entity diffs use atomic transactions and theme/achievements use settings records. No product write is sent to `LocalStorageRuntime`.

The three legacy keys remain byte-for-byte unchanged:

- `collection-revival-system:v1`
- `collection-revival-theme`
- `collection-revival-achievements`

The Bootstrap Marker may change, but it is not part of the retained product-data checksum. There is no dual write, automatic reverse migration, automatic localStorage cleanup, or fallback write.

## 6. Multi-tab protocol

The channel is `collection-revival-storage-runtime:v1`; a transient storage-event channel is used when BroadcastChannel is unavailable. `activation_preflight_started`, `activation_prepared`, `storage_activation_started`, `storage_backend_activated`, and `storage_recovery_required` carry only safe ids/revisions.

An old tab immediately closes its product UI behind `StorageWriteGate` when switching starts. New writes are rejected, queued accepted writes are flushed before switching, and old in-memory state is never copied into IndexedDB. A mounted legacy or prepared tab never hot-switches into a competing activation boot; it shows the reload-required screen instead. After backend activation, that tab must reload and bootstrap from IndexedDB. Web Locks remain the single writer exclusion mechanism; there is no Memory Lock or unlocked production fallback.

## 7. Recovery Screen and action matrix

Recovery is a startup-level screen that takes precedence over all product routes. It is used for invalid/unsupported Marker data, Marker/Journal/metadata conflicts, interrupted switching or boot verification, IndexedDB open/schema/hydrate/integrity failures, and committed activation with an unfinished Marker.

It shows only safe state summaries: Marker state, Journal state, migration state, commit flag, IndexedDB readability, Backup availability, safe error code, and allowed actions. It never displays user text, notes, URLs, raw JSON, serialized Backup content, or stack traces.

| Evidence | Allowed actions | Forbidden actions |
|---|---|---|
| Prepared, not switching | Return to data management; explicit cancel Prepare | Automatic activation |
| Activating, not committed, verified legacy source | Retry boot; explicit cancel uncommitted activation | Silent fallback or cleanup |
| Commit succeeded, Marker unfinished | Retry boot; finalize committed Marker; export evidence | Cancel to legacy or Task 7 rollback |
| `indexeddb_active` boot failure | Retry; export IndexedDB snapshot and safe report | Writable localStorage fallback, clear database |

Pre-commit cancellation requires the lock, uncommitted Journal/metadata and an unchanged legacy source. Post-commit cancellation is rejected. Task 7 execute/resume/rollback are blocked once switching, committed, or active evidence exists. A future return to legacy requires a separately designed reverse migration.

Recovery exports include the persisted legacy Backup, a read-only IndexedDB Snapshot when available, and a content-free safe report. Downloads are local Blob files; they do not upload data or mutate either backend.

## 8. Storage Status

Settings -> Data Management shows the active backend, retained legacy status, health, and activation time. In IndexedDB mode it explicitly says legacy data is retained as read-only history. It does not offer one-click fallback, legacy deletion, IndexedDB clearing, or direct migration rollback.

## 9. Tests and performance

Implemented coverage includes Marker/Journal transitions, strict runtime selection, four confirmations, final recheck, switching order, controlled reload, activation boot, atomic commit/read-back, post-commit normal boot, Marker repair, pre/post-commit recovery boundaries, write-gate behavior, legacy byte retention, and error safety.

- storage-service: 181 tests / 826 assertions passed.
- storage-runtime: 67 tests / 284 assertions passed.
- Task 8D browser E2E: 2 complete scenarios covering the end-to-end activation, multi-tab write freeze, IndexedDB-only theme persistence, refresh hydrate, Task 7 blocking, corrupt Marker Recovery, safe report download, mobile overflow and unchanged legacy bytes.
- Full Web E2E: 132 / 132 passed in both the single-worker verification and the final default six-worker `pnpm check`. Earlier parallel acceptance runs exposed a navigation-poll race in the test and a real old-tab activation-boot race; both were fixed before the final clean run.
- Production Web build passed and emitted `assets/index-Bwti0kwx.js` with `assets/index-DMS-ewsC.css`. This build was not deployed.
- 3,000 records: real fake-indexeddb hydrate plus a small diff persist.
- 10,000 records: real fake-indexeddb open, health check and hydrate equivalence, plus iterative codec order equivalence. The test uses a generous safety ceiling rather than a machine-sensitive timing assertion.

Screenshots are generated locally under `apps/web/test-results/task8d-indexeddb-activation/` and are not committed. Verified files include formal confirmation, active IndexedDB, Storage Status, corrupt-Marker Recovery, and mobile Storage Status/Recovery. Browser assertions confirm no horizontal overflow at 390x844.

## 10. Fault injection

Internal-only injection points cover `after_journal_switching`, `after_marker_activating`, `before_reload`, `after_reload_before_open`, `after_open_before_health`, `after_health_before_hydrate`, `after_hydrate_before_commit`, `after_commit_before_marker_finalize`, and `after_marker_finalize_before_render`. They are constructor-injected test hooks, are not controlled by URL/localStorage, and are not wired into the production Web UI.

## 11. Acceptance

`TASK8D_ACCEPTANCE_STATUS: PASS_WITH_NON_BLOCKING_GAPS`

Core authority switching, commit atomicity, boot selection, no-fallback recovery, multi-tab write freeze, IndexedDB-only persistence and legacy retention are complete and independently exercised. Non-blocking gaps reserved for Task 8E are a broader real-browser fault-injection matrix, a physical-browser 10,000-record timing benchmark, and screenshots of every transient sub-stage that is too brief to capture deterministically without a dedicated test harness.

Task 8D may enter Task 8E isolation acceptance. It is not authorized to merge main or deploy. Production remains unchanged, and no real user profile has been migrated or activated.