# Task 7A Acceptance

## Result

`TASK7A_ACCEPTANCE_STATUS: PASS`

Task 7A exposes a read-only inspection and backup flow. It does not execute migration, open or create the production IndexedDB database, invoke `MigrationExecutor`, acquire Web Locks, write localStorage, or change `activeStorage`.

## Product Surface

- Entry: Settings -> Data Management -> `升级本地数据存储`.
- Route: `/settings/data-migration`; direct navigation and refresh are handled by the existing Vite SPA fallback.
- Visible steps: `检查数据`, `查看结果`, `保存备份`.
- Layout: centered at a 960px maximum width, with 24-32px desktop padding and 16px mobile padding.
- Refresh behavior: all Task 7A state is memory-only, so refresh returns to `idle` and requires a new explicit inspection.

## Component Boundary

- `MigrationDataUpgradeEntry` owns the Settings entry.
- `MigrationDataUpgradePage` owns the page skeleton, three-step indicator, and reducer dispatch.
- `MigrationInspectionStep`, `MigrationPreviewStep`, and `MigrationBackupStep` render one user task each.
- `MigrationFlowController` receives a narrow `ReadonlyStorageLike`, creates the Task 4 backup envelope, runs Task 5 source validation and preview generation, and prepares the existing backup serialization helpers.
- The controller constructor is inert. Reading starts only after the user clicks `开始检查`.

The single reducer state is one of `idle`, `inspecting`, `preview_ready`, `review_required`, `blocked`, `backup_ready`, `backup_downloaded`, or `inspection_failed`. It prevents contradictory loading, blocking, and download flags.

## Read-Only Inspection

The browser adapter exposes only `length`, `key`, and `getItem`. The reader uses the Task 4 allowlist for the product AppState, theme, and achievements keys. Internal/test keys remain excluded, unknown keys expose names only, and chrome.storage.local is outside the boundary.

The flow does not call `loadAppState`, demo fallback, text repair, classification, `persistAppState`, `setItem`, `removeItem`, or `clear`. It renders a safe empty state when no migratable data is present and safe Chinese issue text when parsing, checksum, schema, reference, or conflict checks block the normalized snapshot.

## Preview And Backup

The preview shows SavedItem, SmartAlbum, ActionCard, and PlanCard counts first, then groups data into preserved, regenerated, excluded, and review-required categories. Technical details are collapsed and contain only a safe issue code, store label, field, and record id; user notes, full source URLs, URL tokens, and raw JSON are not displayed.

If normalized data is blocked but raw capture succeeded, the original backup remains downloadable. Download calls `serializeLegacyBackup`, `createLegacyBackupBlob`, and `createLegacyBackupFilename`, creates a temporary anchor, and revokes the object URL in `finally`. The success message says only that the download was triggered because the browser cannot confirm the file was saved to disk.

## Safety Guarantees

- localStorage writes during the Task 7A action boundary: zero.
- `indexedDB.open` calls during inspection and download: zero.
- `MigrationExecutor` and Web Locks calls: zero.
- Network backup uploads: zero.
- New persistent Task 7A keys: zero.
- Runtime dependencies added: zero; the Web workspace only links the existing `@revival/storage-service` package.

## Responsive And Accessibility

The page is covered at 1440x900, 1280x800, 768x1024, 390x844, and 360x800. It has no horizontal overflow, keeps the initial primary action in the mobile first viewport, uses buttons for actions, exposes `aria-current` on the active step, uses `aria-live` for inspection and download status, uses `role=alert` for errors, and preserves keyboard-operable `details` elements and visible focus outlines.

## Automated Acceptance

- Controller/reducer tests: 7.
- Functional route, preview, boundary, and download E2E tests: 7.
- Responsive E2E tests: 3.
- Visual acceptance tests: 4 scenarios producing 7 screenshots.
- Total Task 7A tests: 21.
- Existing Web E2E baseline: 39 tests; Task 7A raises the full suite to 60 tests.

Screenshot output directory:

`apps/web/test-results/task7a-migration-preview/`

Expected files:

- `desktop-1440-initial.png`
- `desktop-1440-preview.png`
- `desktop-1440-review-required.png`
- `desktop-1440-backup.png`
- `mobile-390-initial.png`
- `mobile-390-preview.png`
- `mobile-390-blocked.png`

## Task 7B Gate

Task 7A may proceed to Task 7B after this acceptance remains green. Task 7B must explicitly create its target adapter only after the user confirmations, must use `WebLocksMigrationLockProvider` for the IndexedDB execution path, must not enable any test-only process-local lock option, and must not switch `activeStorage`.
