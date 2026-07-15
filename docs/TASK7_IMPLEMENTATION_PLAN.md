# Task 7 Migration UI Implementation Plan

This plan is intentionally split. Task 7 must not be delivered as one giant settings-page patch. The migration flow touches user data, backup files, Web Locks, IndexedDB, and recovery states, so each subtask must be independently reviewed and tested.

Important gate: Task 7B cannot start until Task 6 blocking gaps are fixed and re-audited.

## Task 7A: Read-Only Check and Preview

Goal: expose a Settings entry that inspects legacy localStorage through the Task 4 reader and shows a migration preview without writing data.

Files allowed:

- `apps/web` Settings data-management area
- A small migration UI component folder, if needed
- A migration flow controller file, read-only methods only
- E2E or component tests for Settings preview
- Docs for user-facing migration copy

Files not allowed:

- `packages/storage-service/src/migration-executor.ts`
- `packages/storage-service/src/indexeddb-adapter.ts`
- extension files
- classification/action-card/plan-card logic
- activeStorage startup logic

Data reads/writes:

- Reads allowlisted legacy localStorage through `LegacyLocalStorageSnapshotReader`.
- Writes nothing to localStorage.
- Opens no IndexedDB database.
- Does not call MigrationExecutor.

UI changes:

- Add `升级本地数据存储` under Settings -> Data Management.
- Add read-only check, preview summary, issue groups, and backup warning.
- Add disabled execution area when blocking/manual_review exists.

Controller changes:

- `inspectLegacyStorage()`
- `createPreview()`
- `prepareBackupDownload()`

storage-service calls:

- `LegacyLocalStorageSnapshotReader`
- `createMigrationPreview`
- `serializeLegacyBackup`
- `createLegacyBackupBlob`
- `createLegacyBackupFilename`

Automated tests:

- Settings entry visible.
- Preview does not call `setItem`, `removeItem`, or IndexedDB open.
- Corrupt AppState shows raw backup available.
- manual_review blocks execution.
- Backup download helper is invoked only by user click.

Manual acceptance:

- Open Settings with clean profile.
- Open Settings with fixture-like local data.
- Confirm preview copy distinguishes preserve/regenerate/exclude/review.
- Confirm no migration execution button is enabled when blocking issues exist.

Git strategy:

- Commit allowed after tests pass.
- Push not required unless user explicitly asks.
- Deploy not allowed in this subtask unless separately requested.

Stop conditions:

- Any code path writes localStorage.
- Any code path opens IndexedDB.
- Any executor call appears.
- Settings page refactor expands beyond the migration section.

Effort: M.

## Task 7B: Execution Confirmation and Progress

Goal: allow migration execution only after backup download, four confirmations, Web Locks availability, and explicit target adapter creation. Completion state remains not activated.

Preconditions:

- Task 6 blocking gaps fixed:
  - Backup read-back verification.
  - Backup id immutability.
  - Strong SHA-256 store checksum.
  - Explicit target schema check.
- Task 7A merged or available on the same branch.

Files allowed:

- Migration flow controller execution methods.
- Migration UI progress component.
- Tests for execution, lock behavior, and activeStorage non-switch.

Files not allowed:

- App startup storage switching.
- loadAppState / persistAppState.
- extension files.
- classification/action-card/plan-card logic.

Data reads/writes:

- Reads legacy data only through the already-created envelope.
- Creates and opens IndexedDB after confirmations.
- Writes only through `MigrationExecutor.execute`.
- Does not mutate localStorage.
- Does not switch activeStorage.

UI changes:

- Four confirmation checkboxes.
- Progress stages.
- Cancel button.
- Completed-not-activated panel.

Controller changes:

- `canExecuteMigration()`
- `createTargetAdapter()`
- `createWebLockProvider()`
- `executeMigration()`
- `cancelExecution()`

storage-service calls:

- `createIndexedDbAdapter`
- `WebLocksMigrationLockProvider`
- `createMigrationExecutor`
- `execute`

Automated tests:

- Missing confirmation blocks execution.
- Missing Web Locks blocks execution.
- Lock held blocks second writer.
- Progress renders store phases.
- Cancel stops after safe boundary.
- `activeStorage` remains localStorage.
- Original localStorage remains intact.

Manual acceptance:

- Use fake profile and fixture data.
- Download backup.
- Confirm all four checks.
- Run migration.
- See completed-not-activated copy.
- Refresh; app still uses legacy localStorage.

Git strategy:

- Commit allowed after full check.
- Push/deploy only if user explicitly requests.

Stop conditions:

- Web Locks unavailable but migration continues.
- activeStorage changes.
- localStorage is deleted or rewritten.
- Executor starts without backup downloaded.

Effort: L.

## Task 7C: Resume and Rollback UI

Goal: make interrupted, failed, cancelled, completed, rolled back, and rollback_failed states understandable and recoverable.

Files allowed:

- Migration controller recovery methods.
- Recovery UI states.
- Error-copy map.
- Tests for refresh/resume/rollback.

Files not allowed:

- activeStorage switch.
- main navigation redesign.
- extension code.

Data reads/writes:

- Opens IndexedDB to inspect `migrationMetadata` and `backups`.
- Calls `resume` only after explicit user action.
- Calls `rollback` only after explicit user action.
- Does not reconstruct a plan from memory after refresh.
- Does not delete backups.

UI changes:

- Recovery panel after refresh.
- `继续升级` action.
- `恢复到升级前` action.
- `查看迁移报告` action.
- High-risk `rollback_failed` state.

Controller changes:

- `inspectMigrationState()`
- `resumeMigration()`
- `rollbackMigration()`
- `mapMigrationErrorToCopy()`

storage-service calls:

- `MigrationExecutor.inspect`
- `MigrationExecutor.resume`
- `MigrationExecutor.rollback`

Automated tests:

- Refresh after failed store write shows resume panel.
- Resume completes from checkpoint.
- Resume conflict blocks and suggests rollback.
- Rollback clears migrated business stores and keeps backup/metadata.
- Rollback failed state is shown safely.
- Completed state is idempotent.

Manual acceptance:

- Simulate cancellation.
- Refresh page.
- Resume.
- Simulate rollback.
- Confirm backup remains.

Git strategy:

- Commit allowed after full check.
- No deploy unless explicitly requested.

Stop conditions:

- UI auto-resumes without user click.
- rollback deletes backup.
- rollback after activeStorage activation is allowed.

Effort: L.

## Task 7D: Full Flow Validation

Goal: verify Task 7A-C as a complete flow without using real user browser data.

Files allowed:

- E2E tests.
- QA fixtures.
- Documentation updates.

Files not allowed:

- Product feature expansion.
- activeStorage switch.
- extension protocol changes.

Data reads/writes:

- Use fake localStorage fixture data.
- Use isolated IndexedDB test database names.
- Do not touch user profile data.

Automated tests:

- 3000 savedItems.
- 100 importBatches.
- 3000 importBatchItems.
- Multi-store migration.
- Backup download event.
- Preview blocked state.
- Manual review blocked state.
- Execution success.
- Cancel then resume.
- Resume conflict.
- Rollback.
- Two-tab lock protection.
- No console error.
- Production build.
- Existing Web routes unaffected.

Manual acceptance:

- Fresh browser profile.
- Run read-only preview.
- Download backup.
- Execute fixture migration.
- Refresh and inspect recovery state.
- Roll back.
- Confirm the normal app still reads legacy localStorage.

Git strategy:

- Commit allowed.
- Push/deploy only by explicit user request.

Stop conditions:

- E2E starts using real user data.
- activeStorage switches.
- existing extension tests regress.

Effort: XL.

## Shared Implementation Rules

- Do not call `loadAppState` from the migration flow.
- Do not call `persistAppState`.
- Do not read chrome.storage.local.
- Do not modify extension bridge or scan payload.
- Do not include API keys, cookies, or extension state in backup.
- Do not show raw technical errors as main UI copy.
- Do not automatically run text repair or reclassification.
- Do not enable IndexedDB as active storage in Task 7.

## Branching and Commit Policy

Use the existing Task 6 branch only if the user explicitly asks to continue there. Otherwise create a new Task 7 branch after Task 6 blocking gaps are resolved.

Recommended order:

1. Fix Task 6 blocking gaps.
2. Re-run Task 6 acceptance audit.
3. Start Task 7A read-only preview.
4. Start Task 7B only after Task 6 is accepted.
5. Add Task 7C recovery.
6. Run Task 7D full validation.

## Task 8 Boundary

Task 8 is responsible for merge/deploy and activeStorage decisions. It should not be bundled into Task 7.

Task 8 likely needs its own split:

- Task 8A: merge and production deploy of safe migration UI.
- Task 8B: controlled real-user preview with backup.
- Task 8C: activeStorage switch.
- Task 8D: post-activation rollback and cleanup.
