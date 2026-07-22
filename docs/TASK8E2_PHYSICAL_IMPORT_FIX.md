# Task 8E.2 Physical Browser Bulk Import Fix

`TASK8E2_PHYSICAL_IMPORT_GATE: PASS`

## Scope

This repair was completed on `phase1-task8e2-physical-import-fix` from `9835ab34e78fb6b6bfb3dc4cce1f2fb5be123d7b`. It used only isolated Playwright Chromium profiles, synthetic fixtures, and the Task 8E test database. No user browser data, extension state, production database, deployment, or storage activation policy was changed.

## Failure diagnosis

The original 3,000-record scenario completed migration and activation. Its first assertion failure was caused by a fixed historical plan date in the fixture, so the dashboard no longer considered the plan a today item. After the fixture date was made current, manual import still failed before the success panel.

The import pipeline itself generated its fallback result, then `AiHttpClient.compactSavedItemForAi` prepared the local fallback request payload. Retained legacy records may omit optional `rawShareText`; `truncateForAi` treated it as a required string and called `.length`. The form catches that rejection and deliberately shows a generic import failure, which is why the browser did not report an uncaught page error or a transaction failure.

A companion guard in smart-album keyword collection now treats absent optional `secondaryIntents` as an empty array. That avoids reaching the same legacy-shape class after the request payload compatibility issue is resolved.

## Minimal changes

- `packages/ai-service/src/index.ts`: `truncateForAi` accepts absent optional legacy text and compacts it as an empty string.
- `packages/action-card-service/src/index.ts`: smart-album keyword collection handles missing `secondaryIntents` as an empty array.
- `apps/web/tests/e2e/task8e-helpers.ts`: the physical fixture uses the current date for its today-plan record.
- `apps/web/tests/e2e/task8e-independent-acceptance.spec.ts`: adds a 300-record activated import regression that verifies the success panel only after SavedItems, ImportBatch, ImportBatchItems, order manifest, refresh, and legacy-byte checks pass.

Runtime activation, Marker, Journal, source drift checks, transaction behavior, read-back verification, and active-storage switching were not modified.

## Chromium evidence

| Scenario | Result | Evidence |
|---|---|---|
| Initial 3,000-record default focused run | Failed | Reproduced the stale today-plan fixture assertion after migration and activation. |
| Initial 3,000-record `--workers=1` run | Failed the same way | Confirms the first issue was not worker contention. |
| 300-record activated import after repair | Passed | Success panel, 301 SavedItems, 1 ImportBatch, 1 ImportBatchItem, 301 manifest entries, refresh persistence, unchanged legacy bytes, and no browser console errors. |
| 3,000-record focused run after repair | Passed | Legacy boot 353 ms; migration 6,234 ms; preflight/prepare 4,135 ms; activation 3,793 ms; import diff 2,775 ms; refresh 1,106 ms; search 454 ms; total 28.7 s. |
| Full default-worker regression 3,000-record run | Passed | Legacy boot 563 ms; migration 7,097 ms; preflight/prepare 4,241 ms; activation 3,810 ms; import diff 2,477 ms; refresh 988 ms; search 246 ms; total 26.9 s. |

The physical import assertions verify that the activated runtime owns the new data: SavedItems becomes 3,001, ImportBatch and ImportBatchItems each become 1, and `runtime:order-manifest:v1` contains 3,001 saved-item IDs including the imported ID. The fixture's three legacy keys are byte-identical before and after import and after refresh. There is no legacy dual write, fallback, transaction abort, or user data access in this evidence.

## Full regression and remaining risk

`pnpm typecheck`, production build, storage-runtime (`70 / 295`), and storage-service (`181 / 826`) passed. The final default-worker `pnpm check` ran 142 Web E2E scenarios: 141 passed, including both the repaired 3,000-record import gate and the 10,000-record activated search gate.

The only failure was the pre-existing Task 8D formal activation test in the concurrent full suite, where its Marker remained at `activating` revision 2. The same test then passed in isolation with `--workers=1`, and the complete `activation-indexeddb.spec.ts` group passed serially. This is recorded as a test-isolation or concurrency flaky, not evidence for changing the activation protocol in this task. It prevents treating the final `pnpm check` command as a green release signal.

## Artifact hygiene

`task8e-3k-failed.png` was removed from Git tracking with `git rm --cached`; its local file was preserved. Root `.gitignore` now ignores `task8e-*.png`, while existing ignored `apps/*/test-results/` rules continue to cover Playwright output. No product asset path was ignored.

## Decision

`TASK8E_ACCEPTANCE_STATUS: PASS_WITH_NON_BLOCKING_GAPS`

`RELEASE_RECOMMENDATION: NOT_READY_FOR_EXPLICIT_MERGE_AND_RELEASE`

The 3,000-record physical import blocker is closed. Before an explicit merge or release, stabilize or isolate the Task 8D concurrent activation test and obtain one fully green default-worker `pnpm check` run. No further Task 8E feature work is authorized by this record.
