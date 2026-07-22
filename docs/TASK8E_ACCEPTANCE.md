# Task 8E Independent Acceptance

`TASK8E_ACCEPTANCE_STATUS: FAIL_BLOCKING`

## Scope and evidence

Task 8E was audited on `phase1-task8e-independent-acceptance`. The work remained outside `main`; no pull request, merge, push initiated by this task, deployment, automatic upgrade, real user migration, localStorage deletion, or active-storage policy change was performed.

The resumed acceptance started from `b0d6e6a0cff7d3102da930cb4a12c96f14811e3d`. The environment later synchronized an existing local source commit to `9f35affc62ebba6d567a9ae0992829d255f87e49`; this audit did not intentionally push it. `main` and `origin/main` remain `3b6e940a8ce724426f3924294e65a922556d18a3`.

All browser scenarios used Playwright's isolated profile and synthetic fixtures. No user browser profile, real localStorage data, real migration database, extension state, network backup upload, or production deployment was used.

## Passed acceptance

| Area | Result | Evidence |
|---|---|---|
| Legacy default authority | Passed | Task 8E browser scenario proves no IndexedDB open or Marker on the default path, with CRUD remaining in localStorage. |
| Migration and activation | Passed | Browser scenario completes migration, authority commit, refresh and IndexedDB-only writes while legacy bytes remain unchanged. |
| Multi-tab behavior | Passed | An old legacy tab freezes during activation and only returns through an IndexedDB reload. |
| Source Drift | Passed | Authoritative state, theme and achievements changes block activation; internal keys are ignored. |
| Recovery | Passed | Corrupt and unsupported Marker evidence keeps normal UI closed and opens Recovery without a writable fallback. |
| Fault matrix | Passed at unit and focused browser levels | Runtime and storage tests cover Marker errors, Journal interruption/transition errors, IndexedDB open and schema failures, hydrate failures, commit/read-back failures, cancellation boundaries, retryable rollback, and Recovery actions. |
| 3,000-record Chromium flow | Passed before the pause on this branch | Migration, activation, album, PlanCard, active import, refresh and search completed in about 39.4 s. Recorded phase timings: legacy boot 471 ms, migration 8,349 ms, prepare 6,493 ms, activation 5,266 ms, small diff 3,367 ms, refresh 1,648 ms. |
| Storage runtime | Passed | `70 tests / 295 assertions passed`. Includes 3,000 and 10,000 record runtime hydrate/equivalence and SearchLog-only differential persistence. |
| Storage service | Passed | `181 tests / 826 assertions passed`. Includes adapter contracts, snapshot/backup, migration execution, SHA-256, locks, staging, resume and rollback. |
| Web E2E outside physical-scale gate | Passed | `137` unique scenarios passed. The first serial batch passed 98 then reached its global runner limit; the remaining 33 and six not-yet-run product-core scenarios passed in focused non-duplicating runs. |
| Typecheck and production build | Passed | `pnpm typecheck` passed. Vite built `assets/index-Bz0nnghQ.js` at 675.80 kB (209.99 kB gzip) and `assets/index-DMS-ewsC.css`. |
| Static safety audit | Passed with bundle-size warning | `git diff --check` passed. The production JS contains no workspace path, common OpenAI/Google key literal, Bearer credential literal, or Cookie literal. |

## Physical Chromium performance gate

The 10,000-record legacy search diagnostic passed in 12.7 s, so the legacy search path is not the blocker.

The real 10,000-record migration/activation scenario reached the active IndexedDB state but failed after refresh when submitting the global query `10000`. The app remained on Settings and `.search-page-form input` did not appear within the explicit 60 s search limit. The controlled run ended in 135.2 s rather than being allowed to wait indefinitely.

Recorded timings before the failure:

| Stage | Duration |
|---|---:|
| Legacy boot | 652 ms |
| Migration | 22,799 ms |
| Activation preflight and prepare | 11,822 ms |
| Activation boot | 9,085 ms |
| Activated search navigation | blocked after 60,000 ms |

The failure is restricted to the activated 10,000-record global-search submission boundary. It is not evidence of target-store corruption: migration, schema checks, source retention, preflight, activation and refresh all passed before it. Memory was not recorded with a reliable browser-process metric, so it remains unmeasured rather than inferred.

The test was stopped after this controlled reproduction. `pnpm check` was not run as a final green command because it necessarily reruns this known failing physical-scale gate; marking it green by excluding that test would be misleading. The build and all remaining E2E coverage were run separately and are recorded above.

## Screenshots and artifacts

The following generated local artifacts are intentionally not staged:

- `apps/web/test-results/task8e-independent-acceptance/legacy-mobile-search.png`
- `apps/web/test-results/task8e-independent-acceptance/indexeddb-active-storage-status.png`
- `apps/web/test-results/task8e-independent-acceptance/old-tab-write-gate.png`
- `apps/web/test-results/task8e-independent-acceptance/recovery-corrupt-marker.png`
- `apps/web/test-results/task8e-independent-accepta-bf1cc-tivation-refresh-and-search/test-failed-1.png`

The tracked historical `task8e-3k-failed.png` is still an unrelated release-hygiene issue on this branch. It was not removed during acceptance because this task does not rewrite history or delete user-visible artifacts without an explicit follow-up decision.

## Release decision

`MERGE_MAIN_ALLOWED: NO`

`DEPLOY_ALLOWED: NO`

Task 8E cannot proceed to merge while an activated IndexedDB browser session with 10,000 records cannot complete a normal global search. The next task should profile and repair that narrow active-runtime search submission path, add a bounded Chromium regression benchmark, then rerun only the failed 10,000-record gate before any new full-suite release audit.
