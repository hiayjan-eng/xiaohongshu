# Task 6 Migration Executor Acceptance Audit

Date: 2026-07-15

Scope: independent audit of the Phase 1 Task 6 migration executor branch. This audit did not modify business code, did not merge to `main`, did not push, did not deploy, and did not run a real migration against user browser data.

## Executive Conclusion

Task 6 is a solid executor prototype for isolated tests and the next design pass, but it is not yet accepted for merge to `main` or for a user-facing migration button. The executor has real lock, preflight, checkpoint, resume, rollback, and IndexedDB execution coverage. The remaining risks are concentrated in backup immutability/verification, checksum strength, and production UI lock/schema guardrails.

**TASK6_ACCEPTANCE_STATUS: BLOCKED_FOR_MERGE_AND_USER_MIGRATION.**

Task 7A read-only UI design can proceed because it does not execute migration. Task 7B execution UI must not be implemented until the blocking gaps below are fixed and re-audited.

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

## Blocking Issues

### B1. Backup persistence is not independently read back and re-verified

Location: `packages/storage-service/src/migration-executor.ts`, `persistBackup`.

The executor writes a backup record and metadata in a single transaction before business stores are written, which is the right order. However, it does not read the backup record back after the transaction, recompute checksum, and compare it to the envelope. It also does not call `verifyLegacyBackupEnvelope` or `serializeLegacyBackup` before persisting.

Why this blocks merge: the migration design says the raw backup is the last reliable recovery source. If backup persistence silently writes a malformed record, the executor can still continue into business data writes.

Required before Task 7B:

- Verify envelope structure before write.
- Persist a canonical serialized envelope or a documented equivalent.
- Read the backup record back after write.
- Recompute and compare raw and normalized checksums.
- Block execution if verification fails.

### B2. Same backup id with different content can be overwritten

Location: `packages/storage-service/src/migration-executor.ts`, `persistBackup`.

The backup record id is `legacy-backup:${backupId}` and is written with `put`. Since `backups` is intentionally excluded from target-empty checks, an existing backup id with different content can be overwritten.

Why this blocks merge: backup immutability is a core safety guarantee. Same id with same checksum can be reused, but same id with different checksum must stop execution.

Required before Task 7B:

- If backup id exists, read it first.
- If checksum matches, allow idempotent reuse.
- If checksum differs, throw a blocking migration error.
- Never overwrite an existing backup with different content.

### B3. Store checksum uses a non-cryptographic fingerprint

Location: `packages/storage-service/src/migration-executor.ts`, `computeStoreChecksum`.

The executor sorts records by primary key and uses canonical JSON, which is good. The final checksum is a small FNV-style fingerprint, not SHA-256. Tests cover deterministic ordering, but not cryptographic integrity.

Why this blocks merge: Task 6 acceptance criteria explicitly require strong checksum behavior before real migration. A weak fingerprint is acceptable for prototype comparison, not for user data migration assurance.

Required before Task 7B:

- Reuse Task 4 SHA-256 checksum utilities or add an async strong checksum path.
- If Web Crypto is unavailable in production execution, block execution with a clear error instead of falling back to weak hash.
- Keep deterministic record ordering before hashing.

## High-Risk Issues

### H1. Default lock provider is memory-only

Location: `packages/storage-service/src/migration-executor.ts`, constructor.

If a caller creates `MigrationExecutor` without a lock provider, it defaults to `MemoryMigrationLockProvider`. This is safe in unit tests but not cross-tab safe in browser production. Task 7 must always inject `WebLocksMigrationLockProvider`; if `navigator.locks` is unavailable, the UI must block migration rather than falling back.

### H2. Target schema version is not explicitly checked against the plan

Location: `ensureTargetReady`, `validateStagingSnapshot`, `createInitialMetadata`.

The executor opens the target adapter and uses `plan.targetSchemaVersion` for staging. It does not explicitly compare `targetAdapter.getSchemaVersion()` with `plan.targetSchemaVersion` before writes. This should be added before Task 7B.

### H3. No scan for other active migration metadata

Location: `execute`, `readMetadata`, `assertTargetEmpty`.

The executor reads metadata for the current migration id and checks that business stores are empty. It does not scan `migrationMetadata` for another active migration id. The writer lock prevents concurrent execution, but stale active metadata from a different migration should be surfaced before writing.

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
| Backup before business writes | VERIFIED | backup + metadata transaction happens before `writeStores` |
| Backup read-back verification | BLOCKING | Not implemented |
| Backup id conflict protection | BLOCKING | Existing backup id with different content is not checked |
| Target non-empty protection | VERIFIED | Business stores are checked and `MIGRATION_TARGET_NOT_EMPTY` is thrown |
| Store write atomicity | VERIFIED | Each store is written via one `readwrite` transaction |
| Whole migration all-or-nothing | NOT_APPLICABLE | Design intentionally uses checkpoints and resume rather than one global transaction |
| Checkpoint after transaction complete | VERIFIED | Checkpoint update occurs after store transaction returns |
| Weak checksum | BLOCKING | `computeStoreChecksum` uses non-cryptographic fingerprint |
| Resume missing checkpoint recovery | VERIFIED | `reconcileCheckpoints` compares actual store records to expected checksum |
| Resume conflict protection | VERIFIED | mismatch throws `MIGRATION_RESUME_CONFLICT` |
| Cancel before execution | VERIFIED | Test covers no records written |
| Cancel mid-store | RISK | Stops between stores, not inside an active store transaction |
| Rollback keeps backup | VERIFIED | Test covers backup and metadata retained |
| Rollback after activation | VERIFIED | Refuses if `activeStorageSwitched` is true |
| Active storage switch | VERIFIED | Task 6 never sets active storage true |
| Error safety | VERIFIED | URL/token/userNote sanitization exists in error model |

## Test Coverage Observed

Task 6 adds 15 migration executor cases and 5 migration lock cases. The strongest coverage areas are successful execution, explicit confirmation, blocked preview, target-not-empty, idempotent completed execution, resume after checkpoint, resume conflict, rollback, rollback after activation, rollback failure metadata, cancellation before execution, inspect, lock release on failure, and deterministic checksum ordering.

Coverage gaps before merge:

- Backup write read-back and checksum verification.
- Backup id collision with different content.
- Strong SHA-256 store checksum.
- Explicit target schema version mismatch.
- Other active migration metadata.
- Progress callback throwing.
- Cancel after one or more stores have completed.
- Web Locks unavailable in a real browser UI controller.

## Task 6 Merge Decision

Task 6 should not be merged to `main` yet. The executor is acceptable as a reviewed foundation on the feature branch, but the blocking gaps must be fixed before any user-facing migration execution path is built or merged.

Recommended next instruction: **fix Task 6 blocking gaps**, then re-run this audit. Task 7A read-only design can be used as planning context, but Task 7B execution UI should wait.
