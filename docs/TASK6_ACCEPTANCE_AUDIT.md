# Task 6 Migration Executor Acceptance Audit

Date: 2026-07-15

Scope: independent audit of the Phase 1 Task 6 migration executor branch. This audit did not modify business code, did not merge to `main`, did not push, did not deploy, and did not run a real migration against user browser data.

## Executive Conclusion

Task 6.1 closes the three original blocking gaps and the three explicit high-risk gaps from the first audit. The executor now performs strict backup verification before business writes, treats backup records as immutable, uses SHA-256 for store verification, blocks unsafe IndexedDB lock providers, explicitly checks target schema version, scans unresolved migration metadata, revalidates backup on resume, and runs semantic final verification before completion.

**TASK6_ACCEPTANCE_STATUS: PASS_WITH_NON_BLOCKING_GAPS.**

Task 7A may proceed. Task 7B may be designed against the hardened executor, but it must still inject `WebLocksMigrationLockProvider`, must not set test-only lock options, and must not switch `activeStorage`. This audit still does not authorize merge to `main`, PR creation, production deployment, or real user migration.

## Task 6.1 Re-Audit Summary

| Original issue | Status | Fix |
|---|---|---|
| Backup write had no independent read-back verification | Closed | `persistBackup` verifies the envelope, serializes it, computes SHA-256, writes `backups`, reads it back, recomputes SHA-256, parses it, verifies the envelope again, then marks `verifiedAt`. |
| Same backup id with different content could be overwritten | Closed | Backup persistence now uses compare-before-create inside a single `backups` readwrite transaction. Same id and same immutable content is reused; same id with different content throws `MIGRATION_RESUME_CONFLICT`. |
| Store checksum used weak fingerprint | Closed | `computeStoreChecksum` is now async SHA-256 over canonical JSON including the store name and primary-key-sorted records. Web Crypto absence throws `MIGRATION_CRYPTO_UNAVAILABLE`. |
| IndexedDB could silently use memory lock | Closed | IndexedDB execution now requires a `web-locks` provider by default. Memory lock is allowed for MemoryAdapter and only for explicit test-only IndexedDB paths. |
| Target schemaVersion was not explicitly compared | Closed | Execution compares preview, plan, expected option, and actual adapter schemaVersion before any backup or business write. Mismatch throws `MIGRATION_TARGET_SCHEMA_MISMATCH`. |
| Other unresolved migration metadata was not scanned | Closed | New execution scans `migrationMetadata`; any other non-`rolled_back` migration blocks with `MIGRATION_ACTIVE_SESSION_EXISTS`. |
| Final verification only had count + checksum | Closed for required scope | Final verification now also creates a target snapshot and reuses Task 5 integrity checks for references and user-preserved fields. |

Current non-blocking gaps:

- Cancellation still stops at safe store boundaries rather than interrupting an active store transaction.
- UI progress callbacks should still be wrapped by the Task 7 controller so a rendering error does not accidentally fail migration.
- Task 7/8 still need separate product-level activation and post-activation rollback design; Task 6.1 keeps `activeStorageSwitched=false`.

## Git Isolation

| Item | Result |
|---|---|
| Current branch | `phase1-task6-migration-executor` |
| Task 6 local HEAD | `6e801ae0301fd2717c039a34e1328dfbc692ee76` |
| Task 6 remote branch HEAD | `6e801ae0301fd2717c039a34e1328dfbc692ee76` |
| `main` HEAD | `3b6e940a8ce724426f3924294e65a922556d18a3` |
| `origin/main` HEAD | `3b6e940a8ce724426f3924294e65a922556d18a3` |
| Worktree at audit start | Clean |
| Task 6 in `main` | No |
| Task 6 in `origin/main` | No |
| Push performed in this audit | No |
| PR created | No |
| Merge performed | No |
| Deploy performed | No |

Task 6 is isolated on `phase1-task6-migration-executor`. The current branch is aligned with `origin/phase1-task6-migration-executor`, but `main` and `origin/main` remain at the Task 5 baseline.

## Actual File Scope

Diff from `origin/main..HEAD` contains only storage-service implementation, storage-service tests, and Phase 1 docs:

- `packages/storage-service/src/migration-executor.ts`
- `packages/storage-service/src/migration-executor-errors.ts`
- `packages/storage-service/src/migration-lock.ts`
- `packages/storage-service/src/index.ts`
- `packages/storage-service/tests/migration-executor-fixtures.ts`
- `packages/storage-service/tests/migration-executor.spec.ts`
- `packages/storage-service/tests/migration-lock.spec.ts`
- `packages/storage-service/tests/run-storage-adapter-contracts.ts`
- `docs/INDEXEDDB_MIGRATION_FLOW.md`
- `docs/INDEXEDDB_SCHEMA_V1.md`
- `docs/PHASE1_EXECUTION_PLAN.md`
- `docs/STORAGE_ADAPTER_DESIGN.md`

No `apps/`, `apps/extension`, route, React component, CSS, package dependency, Vercel config, classification-service, ActionCard, PlanCard, or extension protocol files appear in the Task 6 diff.

## Verification Commands

| Command | Result |
|---|---|
| `pnpm typecheck` | Passed |
| `pnpm --filter @revival/storage-service test` | Passed, 148 tests / 707 assertions |
| `pnpm check` | Passed, Web E2E 39 passed |
| `git diff --check` | Passed |

The storage-service suite includes contract tests, MemoryAdapter tests, IndexedDbAdapter tests, legacy snapshot tests, migration preview tests, migration lock tests, and 15 migration executor cases.

## Original Blocking Issues

### B1. Backup persistence is not independently read back and re-verified

Location: `packages/storage-service/src/migration-executor.ts`, `persistBackup`.

Status after Task 6.1: Closed.

The executor writes and verifies backup before business stores are written. It calls `verifyLegacyBackupEnvelope`, uses `serializeLegacyBackup`, calculates SHA-256, writes backup, reads it back, recomputes SHA-256, parses it through `parseLegacyBackup`, verifies the parsed envelope, and writes `verifiedAt`.

Business store writes do not start if any backup verification step fails.

Tests: backup read-back missing, checksum tamper, serialized envelope tamper through same-id conflict, and resume backup tamper.

### B2. Same backup id with different content can be overwritten

Location: `packages/storage-service/src/migration-executor.ts`, `persistBackup`.

The backup record id is `legacy-backup:${backupId}` and is written with `put`. Since `backups` is intentionally excluded from target-empty checks, an existing backup id with different content can be overwritten.

Status after Task 6.1: Closed.

Same backup id and identical immutable fields are reused without overwriting `createdAt` or `serializedEnvelope`. Same backup id with different immutable content throws `MIGRATION_RESUME_CONFLICT` before business writes.

### B3. Store checksum uses a non-cryptographic fingerprint

Location: `packages/storage-service/src/migration-executor.ts`, `computeStoreChecksum`.

Status after Task 6.1: Closed.

Store checksum is now SHA-256 over canonical JSON with store name included. The old FNV-style helper is removed from `migration-executor.ts`.

## High-Risk Issues

### H1. Default lock provider is memory-only

Location: `packages/storage-service/src/migration-executor.ts`, constructor.

Status after Task 6.1: Closed for IndexedDB execution.

Memory lock remains available for MemoryAdapter tests. IndexedDB execution rejects missing or memory lock providers unless an explicit test-only option is set.

### H2. Target schema version is not explicitly checked against the plan

Location: `ensureTargetReady`, `validateStagingSnapshot`, `createInitialMetadata`.

Status after Task 6.1: Closed.

Execution now compares actual adapter schemaVersion, expected option, preview target schemaVersion, and plan target schemaVersion before backup or metadata writes.

### H3. No scan for other active migration metadata

Location: `execute`, `readMetadata`, `assertTargetEmpty`.

Status after Task 6.1: Closed.

New execution scans all migration metadata. Any other migration that is not `rolled_back` blocks new execution.

### H4. Progress callback can abort migration

Location: `emitProgress`, `emitProgressFromValues`.

`onProgress` is called directly. If a UI callback throws, the executor can mark migration failed. The `finally` block still releases the lock, so this is not a lock leak, but Task 7 should wrap UI progress handlers or the executor should isolate progress callback errors.

## Medium-Risk Issues

### M1. Cancellation is checked between stores, not inside a store transaction

Location: `writeStores`, `rollback`.

Cancellation before execution writes no records, and cancellation before each store is checked. During an individual store write transaction, cancellation waits until the store transaction finishes. This is acceptable if documented, but the UI copy should say cancellation stops after the current safe step, not necessarily at the exact millisecond.

### M2. Backup is stored as structured object, not serialized envelope

Location: `persistBackup`.

The backup record stores `snapshot`, `rawBackup`, `checksums`, and `report`, but not a single `serializedEnvelope`. This may still preserve data, but Task 7 download/recovery semantics should decide whether the persisted backup must include the exact serialized envelope string.

### M3. Final verification is count/checksum based, not semantic revalidation

Location: `verifyAllStores`.

Final verification confirms each checkpoint store has the expected count and checksum. It indirectly preserves user manual fields because the checksum is computed from records. It does not re-run reference integrity, duplicate handling, or preservation checks; those remain preview/plan responsibilities.

## Low-Risk Notes

- `ensureTargetReady` opens the passed target adapter. This does not create an adapter or pick a database name; Task 7 controller remains responsible for constructing the explicit target.
- `rollback` clears migrated business stores and keeps `backups` and `migrationMetadata`.
- `activeStorageSwitched` is always false in Task 6 code paths, except tests deliberately mutate metadata to verify rollback refusal.

## Audit Matrix

| Area | Status | Evidence |
|---|---|---|
| Branch isolation | VERIFIED | `main` / `origin/main` at `3b6e940`, Task 6 at `6e801ae` |
| File scope | VERIFIED | Diff limited to storage-service, tests, and docs |
| No apps changes | VERIFIED | No `apps/` files in `origin/main..HEAD` |
| No extension changes | VERIFIED | No extension files in diff |
| No package dependency changes | VERIFIED | No `package.json` or `pnpm-lock.yaml` in diff |
| No runtime product wiring | VERIFIED | No imports from apps or React; executor is not used by Web runtime |
| Module import side effects | VERIFIED | Migration files do not access `window`, `document`, `localStorage`, or `chrome.storage.local` at module import |
| IndexedDB construction | VERIFIED | Executor receives explicit `targetAdapter`; it does not create `IndexedDbAdapter` |
| Lock covers lifecycle | VERIFIED | `execute`, `resume`, and `rollback` acquire lock and release in `finally` |
| Web Locks support | VERIFIED WITH CONDITION | Provider supports `ifAvailable`; Task 7 must inject it and block if unavailable |
| No lock fallback | RISK | Executor defaults to memory lock if caller omits lock provider |
| Preflight before business writes | VERIFIED | input, target, plan, target-empty, staging validation happen before store writes |
| Backup before business writes | VERIFIED | backup is strictly verified before metadata and business writes |
| Backup read-back verification | VERIFIED | read-back, SHA-256, parse, envelope verification, and `verifiedAt` are required |
| Backup id conflict protection | VERIFIED | same id different immutable content throws `MIGRATION_RESUME_CONFLICT` |
| Target non-empty protection | VERIFIED | Business stores are checked and `MIGRATION_TARGET_NOT_EMPTY` is thrown |
| Store write atomicity | VERIFIED | Each store is written via one `readwrite` transaction |
| Whole migration all-or-nothing | NOT_APPLICABLE | Design intentionally uses checkpoints and resume rather than one global transaction |
| Checkpoint after transaction complete | VERIFIED | Checkpoint update occurs after store transaction returns |
| Weak checksum | VERIFIED | `computeStoreChecksum` uses SHA-256 canonical JSON |
| Resume missing checkpoint recovery | VERIFIED | `reconcileCheckpoints` compares actual store records to expected checksum |
| Resume conflict protection | VERIFIED | mismatch throws `MIGRATION_RESUME_CONFLICT` |
| Cancel before execution | VERIFIED | Test covers no records written |
| Cancel mid-store | RISK | Stops between stores, not inside an active store transaction |
| Rollback keeps backup | VERIFIED | Test covers backup and metadata retained |
| Rollback after activation | VERIFIED | Refuses if `activeStorageSwitched` is true |
| Active storage switch | VERIFIED | Task 6 never sets active storage true |
| Error safety | VERIFIED | URL/token/userNote sanitization exists in error model |

## Test Coverage Observed

Task 6.1 raises migration executor coverage to 30 cases. New coverage includes backup read-back failure, backup checksum tampering, same backup id same content reuse, same backup id different content rejection, target schema mismatch, unresolved migration metadata blocking, rolled-back metadata allowance, final semantic verification, resume backup tamper, IndexedDB memory-lock rejection, Web Crypto absence, and rollback retry.

## Task 6 Merge Decision

Task 6.1 may be used as the foundation for Task 7A and Task 7B design. It still should not be merged or deployed in this turn. The next recommended instruction is **start Task 7A** if the goal is the read-only Settings preview, or keep Task 6.1 open only if the team wants to wrap progress callback errors before UI work.
