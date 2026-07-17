# Task 7C Acceptance

## Scope And Branch

- Branch: `phase1-task7c-migration-recovery-ui`
- Branch point: `2e435fde2650652d22e0ffcc7809180b6e439008`
- Route: `/settings/data-migration`
- Scope: existing-session discovery, refresh recovery, explicit Resume, explicit Rollback, rollback retry, persisted Backup download, safe report, and multi-tab writer protection.
- Excluded: activeStorage switch, localStorage deletion, repository/runtime cutover, real-user migration, merge, push, PR, and deployment.

## Database Existence And Inspection

`IndexedDbDatabaseInspector` uses `indexedDB.databases()` to determine whether `collection-revival-local` already exists. It does not call `indexedDB.open()` as an existence probe because opening a missing name creates the database. Unsupported enumeration is a blocking compatibility result. If the database does not exist, the page shows the Task 7A inspection entry and creates nothing.

Only an existing database is opened. `MigrationRecoveryController.inspectExistingSession()` calls `MigrationExecutor.inspectAll()`, evaluates every `migrationMetadata` record and its persisted Backup summary, then closes the adapter in `finally`. Multiple unresolved records and `activeStorageSwitched=true` block recovery without clearing anything.

## State Mapping

| Persisted condition | UI state | Allowed action |
|---|---|---|
| No database | `existing_session_not_found` | Start Task 7A inspection |
| `cancelled` or recoverable interrupted state | `resume_available` | Explicit Resume or Rollback |
| Failed and not resumable | `rollback_available` | Explicit Rollback |
| `completed` | `completed_not_activated` | Report, Backup download, or Rollback |
| `rollback_failed` | `rollback_failed` | Explicit retry |
| `rolled_back` | `rolled_back` | Reinspect legacy data or view history |
| Held writer lock | `another_session_running` | Refresh after lock release |
| Multiple unresolved metadata, activated metadata, unsupported inspection, or unsafe evidence | `recovery_blocked` | Review only |

Loading or refreshing the page never calls `execute`, `resume`, or `rollback` automatically.

## Resume

Resume requires a checked confirmation that the user understands the system will use the persisted Backup and upgrade record. The Web runtime creates a real `WebLocksMigrationLockProvider`; no Memory lock or test-only bypass is used. It calls `MigrationExecutor.resume` rather than `execute`.

The executor reloads and verifies the immutable Backup, persisted metadata, plan, source checksum, target schema, and Store checkpoints. It does not read legacy localStorage, recreate a Backup, regenerate preview data, repair text, or reclassify records. A target checksum conflict blocks continuation and preserves the target for explicit rollback.

## Rollback And Retry

Rollback requires confirmation that the current migration's new-store records will be cleared and that a fresh inspection is required before a later migration. It clears `savedItems`, `importBatches`, `importBatchItems`, `smartAlbums`, `actionCards`, `planCards`, `classificationCorrections`, `searchLogs`, and `settings`.

It preserves `backups`, `migrationMetadata`, and every legacy localStorage byte. `rollback_failed` is retryable: already empty Stores remain empty, pending Stores continue, and success ends in `rolled_back` while evidence remains available.

## Stored Backup And Safe Report

Stored Backup download performs a new verified read of the immutable Backup record, recomputes and checks its SHA-256, reparses the envelope, then reuses the Task 4 Blob and filename helpers. Damaged evidence is not downloaded and cannot be used for Resume.

The safe report contains sanitized migration and execution ids, timestamps, current status, source/planned/written/verified counts, checkpoint state, Backup status, Resume count, recovery capabilities, active-storage marker, and whitelisted warning/error codes. It excludes collection content, `userNote`, full titles, full URLs, tokens, `serializedEnvelope`, raw Backup, complete checksums, and stack traces. JSON download uses a temporary object URL and revokes it after the click.

## Refresh, Tabs, And Navigation

Refresh reruns read-only existing-session inspection. It does not rebuild from localStorage or start a writer. Resume and Rollback both require the named Web writer lock. A second tab sees `another_session_running`; there is no Memory-lock fallback. In-flight Resume or Rollback activates the page-leave warning. Resume may request a safe stop; Rollback cannot be cancelled halfway through the UI.

## Responsive And Accessibility

The existing 960px migration workspace is retained. Recovery facts use four desktop columns and two mobile columns; actions stack on mobile. The report uses collapsible Store checkpoints rather than a horizontal table. Buttons are real buttons, confirmations have labels, progress uses an ARIA progressbar, errors use `role=alert`, report expansion uses `aria-expanded`, and result headings receive focus.

Visual artifacts are under `apps/web/test-results/task7c-migration-recovery/`:

- Desktop: `01-desktop-cancelled-migration.png` through `09-desktop-migration-report.png`
- Mobile: `10-mobile-resume-available.png` through `15-mobile-migration-report.png`

The PNG files are local test artifacts and are not committed.

## Verification

The acceptance suite covers controller/reducer contracts, missing-database zero creation, persisted Resume, target conflict, Backup tampering, rollback retry, completed and rolled-back refresh, multi-tab locking, safe downloads, mobile overflow, and console errors. It also reuses the complete Task 1-6 storage-service suite and Task 7A/7B Web tests.

- Controller/reducer contracts: 10 passed.
- Recovery component and browser journeys: 14 passed, including three visual acceptance journeys.
- Web E2E: 106 passed, up from the Task 7B baseline of 82.
- storage-service: 165 tests / 769 assertions passed.
- `pnpm typecheck`: passed.
- Production build inside `pnpm check`: passed (`assets/index-CDpBgMKP.js`, `assets/index-Ddp8eB7R.css`).
- `pnpm check`: passed, 106 Web E2E.
- Two pre-existing browser tests were observed flaky under the six-worker full run: the mobile dashboard revival test and the Task 7B desktop visual capture. Each passed alone without product changes, and the final full run passed all 106 tests.
- Screenshots: 15 PNGs under `apps/web/test-results/task7c-migration-recovery/`; manual inspection confirmed no horizontal overflow and readable primary actions/report content.

## Acceptance Status And Task 8 Boundary

`TASK7C_ACCEPTANCE_STATUS: PASS`

Task 8 may start only as a design and merge-readiness audit. It must separately decide branch integration, controlled real-user preview, activeStorage activation, post-activation rollback, and deployment. Task 7C itself does not permit merging main or deploying to real users.
