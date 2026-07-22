# TASK8E_FINAL_ACCEPTANCE_REPORT

## Result

`TASK8E_ACCEPTANCE_STATUS: FAIL_BLOCKING`

This independent release audit is complete. It does not authorize a merge to `main`, a pull request, a push initiated by this task, or a deployment.

## Branch and Git state at report creation

- Branch: `phase1-task8e-independent-acceptance`
- Audited branch HEAD before this report commit: `9f35affc62ebba6d567a9ae0992829d255f87e49`
- `main` / `origin/main`: `3b6e940a8ce724426f3924294e65a922556d18a3`
- No Task 8E code has entered `main`.

## Completed work

- Verified legacy authority, migration, activation, IndexedDB-only writes, legacy retention, multi-tab write freeze, source drift blocking and startup Recovery.
- Verified Marker, Journal, interrupted transitions, IndexedDB open/schema/hydrate/commit failures, rollback retry and Recovery behavior through storage-runtime/storage-service tests plus focused browser coverage.
- Completed the physical Chromium 3,000-record scenario.
- Completed all 137 unique Web E2E scenarios outside the physical-scale test group.
- Ran typecheck, storage-runtime tests, storage-service tests, production build, `git diff --check`, and a static production-bundle credential/path scan.

## Test results

| Command or scenario | Result |
|---|---|
| `pnpm --filter @revival/storage-runtime test` | Passed: 70 tests / 295 assertions |
| `pnpm --filter @revival/storage-service test` | Passed: 181 tests / 826 assertions |
| Web E2E excluding physical-scale group | Passed: 137 unique scenarios |
| 3,000-record real Chromium migration/activation/refresh/search | Passed |
| 10,000-record legacy search diagnostic | Passed in 12.7 s |
| 10,000-record real Chromium activated search | Failed after a bounded 60 s wait |
| `pnpm typecheck` | Passed |
| `pnpm --filter @revival/web build` | Passed |
| `git diff --check` | Passed |
| final `pnpm check` | Not run as green evidence: it includes the known failing 10,000-record gate |

## Performance

The failing 10,000-record run completed legacy boot in 652 ms, migration in 22,799 ms, activation preflight/prepare in 11,822 ms, and activation boot in 9,085 ms. After refresh, global search submitted `10000` but never reached the Search view within 60,000 ms. This is the remaining release blocker. Browser memory was not measured reliably and is therefore recorded as not captured.

## Screenshots

- `apps/web/test-results/task8e-independent-acceptance/legacy-mobile-search.png`
- `apps/web/test-results/task8e-independent-acceptance/indexeddb-active-storage-status.png`
- `apps/web/test-results/task8e-independent-acceptance/old-tab-write-gate.png`
- `apps/web/test-results/task8e-independent-acceptance/recovery-corrupt-marker.png`
- Failure evidence: `apps/web/test-results/task8e-independent-accepta-bf1cc-tivation-refresh-and-search/test-failed-1.png`

## Remaining risks and decision

The active IndexedDB runtime cannot yet demonstrate responsive normal search at the stated 10,000-record acceptance size. There is also a Vite chunk-size warning and an existing tracked historical screenshot artifact that should be cleaned in a separately authorized hygiene change.

`ALLOW_MERGE_MAIN: NO`

The next instruction should be a tightly scoped performance investigation of the activated 10,000-record search submission path. It should not redesign Task 8A-8D, rerun full migration work indiscriminately, or deploy.

## Task 8E.1 Follow-up

The failed activated 10,000-record search gate has been repaired and rerun in isolated Chromium. The root cause was an optional historical `secondaryIntents` field missing on retained records; `searchSavedItems` dereferenced it before requesting navigation. The minimal compatibility guard keeps the existing search ranking behavior while treating the absent optional array as empty.

Final focused evidence: 1,000 activated records reached `/search?q=1000` in 112 ms and wrote SearchLog in 8 ms without page errors. The 10,000-record gate passed with 2,177 ms refresh and 264 ms search readiness. Storage-runtime, storage-service, and typecheck passed.

The final `pnpm check` did not become a green merge signal: typecheck and production build passed, and 139/141 Web E2E tests passed, but a separate physical 3,000-record import acceptance assertion failed consistently. It is not changed by this search repair and needs a separately authorized investigation. Therefore `ALLOW_MERGE_MAIN: NO` remains correct.
## Task 8E.2 Physical Import Follow-up

The 3,000-record physical Chromium import blocker has been repaired. The retained legacy fixture required two compatibility corrections: a today-plan test date must be current, and absent optional `rawShareText` must compact as empty text when the local AI fallback builds its request payload. Smart-album keyword aggregation now also tolerates absent optional `secondaryIntents`.

Focused and default-worker scale evidence both passed. The focused 3,000-record run took 28.7 s; the default-worker run inside the final suite took 26.9 s. At the import completion boundary, the test verifies 3,001 SavedItems, one ImportBatch, one ImportBatchItem, a 3,001-entry order manifest, persistence through refresh, and byte-identical legacy keys. No fallback or dual write was observed.

The full `pnpm check` now completes typecheck and production build and reports 141 / 142 Web E2E scenarios passed. The sole remaining failure is the known concurrent Task 8D formal activation flaky. It passed immediately in an isolated serial rerun, and the complete `activation-indexeddb.spec.ts` group also passed with one worker. This remains a release-audit gap, so the status is `PASS_WITH_NON_BLOCKING_GAPS` and `ALLOW_MERGE_MAIN: NO` until a fully green default-worker run is obtained.

`task8e-3k-failed.png` is no longer tracked; it remains local and is ignored along with Task 8E test artifacts. See `docs/TASK8E2_PHYSICAL_IMPORT_FIX.md` for the full chain of evidence.
