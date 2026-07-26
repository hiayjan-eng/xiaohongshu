# Release Blocker: E2E Orchestration and Durability Waits

## Evidence

The legacy mixed release run allowed synthetic 3,000 and 10,000 record Chromium scenarios to compete with ordinary UI, activation, and mobile persistence tests in Playwright's default worker pool.

- Experiment A: 139 core tests, default six workers, passed in 272.5 seconds.
- Experiment B: the 3,000 and 10,000 full migration/activation scenarios passed sequentially. The first 3,000 run exposed a test-fixture UTC date bug, corrected to use the local calendar date; it was not a storage or migration failure.
- Experiment C: three repeats of Task 8D, mobile revive, and the 10,000 full scenario with six workers produced two mobile persistence-read timeouts while Task 8D and all 10,000 scenarios passed.

ROOT_CAUSE: E2E_RESOURCE_CONTENTION_AND_ORCHESTRATION

## Readiness and Durability Findings

Task 8D succeeds with normal Playwright clicks when it is not competing with the heavy scenarios. The existing `.app-shell` remains the real post-bootstrap UI boundary, so no production bootstrap marker was added.

Mobile revive reaches React state before the queued runtime persistence write can always be read under mixed heavy load. Focused runs complete the write and retain the ActionCard after a reload. The helper waits for the durable localStorage state, and the mobile E2E now verifies a reload can open the persisted action-card detail. No product persistence semantics changed.

## Release Gates

`pnpm check` runs all gates in order and fails on the first failure:

1. Typecheck, storage-runtime tests, storage-service tests, and production build.
2. `pnpm check:e2e-core`: 139 ordinary E2E tests at Playwright's default six-worker configuration.
3. `pnpm check:e2e-heavy`: the three 3,000 / 10,000 record Chromium scenarios sequentially with one worker.

The gates remain exhaustive: 139 core plus 3 heavy equals the original 142 E2E cases. No retry was added, no global timeout was raised, and the heavy datasets were unchanged.

## Status

RELEASE_GATE_STATUS: PENDING_FINAL_VALIDATION
READY_TO_RESUME_PRODUCTION_RELEASE: NO

The remaining work is the prescribed two core runs, one heavy run, one complete `pnpm check`, then release review. No user browser data is read or migrated by these tests.