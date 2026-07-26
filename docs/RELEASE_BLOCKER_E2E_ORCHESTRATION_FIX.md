# Release Blocker: E2E Orchestration and Durability Waits

## Evidence

The legacy mixed release run allowed synthetic 3,000 and 10,000 record Chromium scenarios to compete with ordinary UI, activation, visual, and mobile persistence tests in Playwright's default worker pool.

- Experiment A: 139 core tests with the default six-worker configuration passed in 272.5 seconds.
- Experiment B: sequential 3,000 and 10,000 full migration/activation scenarios passed. The first 3,000 run revealed a test-fixture UTC date mismatch: after local midnight, a plan card was seeded for the prior local day. The fixture now uses the test process local calendar date; no product or storage code changed.
- Experiment C: three repeats of Task 8D, mobile revive, and the 10,000 full scenario with six workers produced two mobile persistence-read timeouts while Task 8D and every 10,000 scenario passed.
- A subsequent flat 139-test core run also produced normal-click timeouts in Task 8C/8D and the migration visual spec. Each test passed when grouped by workload type without retry, timeout, force-click, or DOM-click changes.

ROOT_CAUSE: E2E_RESOURCE_CONTENTION_AND_ORCHESTRATION

## Readiness and Durability Findings

Task 8D succeeds with normal Playwright clicks when it does not compete with unrelated visual and scale scenarios. The existing `.app-shell` remains the real post-bootstrap UI boundary, so no production AppBootstrap marker was added.

Mobile revive reaches React state before the queued runtime persistence write can always be read under mixed heavy load. Focused runs complete the write and retain the ActionCard after a reload. The helper waits for the durable localStorage state, and the responsive E2E now reloads and opens the persisted action-card detail. No product persistence semantics changed.

## Release Gates

`pnpm check` runs all gates in order and fails on the first failure:

1. Typecheck, storage-runtime tests, storage-service tests, and production build.
2. `pnpm check:e2e-core`, with six-worker configuration in three sequential core lanes: 119 general tests, 12 visual tests, and 8 activation tests.
3. `pnpm check:e2e-heavy`, with one worker for the three 3,000/10,000 physical Chromium scenarios.

The gates remain exhaustive: 119 general plus 12 visual plus 8 activation plus 3 heavy equals the original 142 E2E cases. No retry was added, no global timeout was raised, and no heavy dataset was reduced.

## Validation Before Full Gate

- Task 8D with standard Playwright clicks: 3/3 passed.
- Mobile revive with immediate reload durability assertion: 3/3 passed.
- Core run one: 131 general plus 8 activation passed; the same 12 visual cases also passed in the new dedicated lane.
- Core run two under final orchestration: 119 general, 12 visual, and 8 activation passed in 301.4 seconds.
- Heavy gate: all three scenarios passed in 104.6 seconds.

## Status

RELEASE_GATE_STATUS: PASS
READY_TO_RESUME_PRODUCTION_RELEASE: YES

Final `pnpm check` passed in 490.2 seconds after typecheck, both storage package suites, production build, 139 core E2E cases, and three heavy E2E cases. Tests use isolated Playwright browser data and do not read or migrate user browser data.