# Task 8E.3 Activation Flaky Fix

`TASK8E3_STATUS: PASS`

## Scope

Task 8E.3 closed the final default-worker acceptance gap on `phase1-task8e3-activation-flaky-fix`. It began from Task 8E.2 commit `8eb586ff7cb5912b68579c17bfdebb1a8b11e9bb`. At the audit point, `main` and `origin/main` were both `d50f669d846c952b7c60d999be4e8a3a679a9b6d`; their only divergence from the prior baseline `3b6e940` is documentation and licensing work (`LICENSE`, `README.en.md`, and `README.md`). No Task 6 through Task 8E code entered `main`.

The work was deliberately confined to the Task 8D Playwright acceptance and its evidence. There is no production runtime, Marker, Journal, Web Locks, controlled-reload protocol, migration executor, active-storage default, extension, or data-model change. No user browser profile, real localStorage data, production IndexedDB database, real migration, deployment, pull request, merge, or intentional push was used.

## Root Cause and Fix

The historic full-suite failure observed the Marker as `activating` at revision `2`. Since the test stopped at that point, it did not also capture a committed Journal or final metadata record and therefore could not prove a runtime corruption. Serial and focused multi-worker runs completed normally with `indexeddb_active` at revision `3`, committed Journal state, `activeStorageSwitched: true`, and normal old-tab write-gate release.

A full concurrent rerun after the first test adjustment identified the reproducible failure: Playwright timed out in `page.screenshot({ fullPage: true })` while waiting for fonts. That capture happened before the Marker assertion. The acceptance race had two test-only pieces: the old page shell could be observed before the formal activation navigation had installed the new runtime, and full-page evidence capture multiplied rendering work under the six-worker suite.

The final change waits for the actual main-frame navigation caused by clicking the formal activation command, then observes the new document. It retains screenshot evidence as viewport captures, which are adequate for this activation state while the independent visual tests cover responsive full-page layout. No timeout, worker count, retry behavior, or runtime authority protocol was weakened.

## Evidence

| Run | Result |
|---|---|
| Formal activation, serial `--repeat-each=3` | 3/3 passed; about 19-23 s per run |
| Task 8C + Task 8D focused pair | 8/8 passed with default workers |
| Formal activation stress, `--repeat-each=6 --workers=6` | 6/6 passed |
| Post-capture-fix focused pair, `--repeat-each=3` | 24/24 passed with six workers; formal cases 44.6-47.8 s |
| Storage runtime | 70 tests / 295 assertions passed |
| Storage service | 181 tests / 826 assertions passed |
| Typecheck | passed |
| Default `pnpm check` | 142/142 Web E2E passed in 4.5 min; includes typecheck and production build |
| `git diff --check` | passed |

The production build emitted `assets/index-uc0E8GH4.js` at 675.83 kB (209.99 kB gzip) and `assets/index-DMS-ewsC.css` at 120.55 kB. The existing Vite chunk-size warning is retained as a non-blocking performance follow-up.

## Physical Chromium Results

All browser scenarios use isolated fixtures and databases.

| Scenario | Legacy boot | Migration | Prepare | Activation boot | Refresh | Search |
|---|---:|---:|---:|---:|---:|---:|
| 3,000 records | 516 ms | 6,030 ms | 4,155 ms | 3,672 ms | 1,010 ms | 188 ms |
| 10,000 records | 357 ms | 17,617 ms | 8,561 ms | 7,933 ms | 1,609 ms | 267 ms |

The 3,000-record scenario also completed its differential import in 2,561 ms. The 10,000-record scenario completed differential import in 2,372 ms and order work in 2,650 ms. Memory was not collected through a reliable browser-process metric and is intentionally reported as not captured.

## Screenshots

Generated, ignored local evidence:

- `apps/web/test-results/task8d-indexeddb-activation/desktop-formal-confirmation.png`
- `apps/web/test-results/task8d-indexeddb-activation/desktop-indexeddb-active.png`
- `apps/web/test-results/task8d-indexeddb-activation/desktop-recovery-corrupt-marker.png`
- `apps/web/test-results/task8d-indexeddb-activation/desktop-storage-status.png`
- `apps/web/test-results/task8d-indexeddb-activation/mobile-recovery-corrupt-marker.png`
- `apps/web/test-results/task8d-indexeddb-activation/mobile-storage-status.png`
- `apps/web/test-results/task8e-independent-acceptance/physical-3000-active.png`
- `apps/web/test-results/task8e-independent-acceptance/physical-10000-active.png`

## Release Decision

`TASK8E_ACCEPTANCE_STATUS: PASS`

`RELEASE_RECOMMENDATION: READY_FOR_EXPLICIT_MERGE_AND_RELEASE`

The acceptance evidence now permits an explicitly authorized merge to `main` and subsequent release audit. This task does not perform either action. Remaining risks are limited to the known Vite bundle-size warning and the ordinary fact that viewport activation captures complement, rather than replace, dedicated responsive visual coverage.
