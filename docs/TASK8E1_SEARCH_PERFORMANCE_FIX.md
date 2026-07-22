# Task 8E.1 IndexedDB Activated Search Performance Fix

## Scope

This narrowly scoped repair started from `b314109a2a88da2b63348c91ad404ed25be98ba5` on `phase1-task8e1-indexeddb-search-performance`. It did not alter the activation protocol, Marker, Journal, active-storage selection, migration executor, localStorage retention, extension, production deployment, or user data.

## Diagnosis

A fresh isolated Chromium profile reproduced the failure with 1,000 synthetic records, proving that the original 10,000-record failure was not a throughput-only problem. The browser probe observed no `history.pushState` call and two safe page errors: `Cannot read properties of undefined (reading 'join')`.

The activated IndexedDB runtime faithfully retained an older record shape that omitted optional `secondaryIntents`. `searchSavedItems` assumed the array existed and called `item.secondaryIntents.join(" ")` while scoring the query. That exception occurred before the search route and SearchLog state update, so the UI remained on the Settings data-migration page and appeared to be blocked by persistence.

## Repair

`packages/search-service/src/index.ts` now treats a missing `secondaryIntents` field as an empty array:

```ts
(item.secondaryIntents ?? []).join(" ")
```

This preserves search semantics for current records, avoids changing migrated data, and makes the search scorer compatible with legacy records that do not carry the optional field. The Task 8E physical acceptance test now records the activated search chain without exposing user content: route request, browser errors, search readiness, and persisted SearchLog count.

## Chromium Evidence

All runs used an isolated Playwright profile, a synthetic legacy fixture, and the dedicated `collection-revival-local` test database. No real browser data was read or modified.

| Scenario | Result | Evidence |
|---|---|---|
| 1,000 activated records after repair | Passed | refresh boot 497 ms; search route 112 ms; SearchLog persistence 8 ms; URL `/search?q=1000`; no page errors |
| 10,000 activated records after repair | Passed | legacy boot 485 ms; migration 22,222 ms; preflight/prepare 11,147 ms; activation boot 8,440 ms; refresh 2,177 ms; search route 264 ms |
| 10,000 legacy search diagnostic | Passed | Included in final Web E2E run |

The regression test verifies one navigation request, no page errors, and one SearchLog record in the isolated IndexedDB store. It does not expose query payloads beyond the fixed synthetic query.

## Validation

- `pnpm --filter @revival/storage-runtime test`: passed, 70 tests / 295 assertions.
- `pnpm --filter @revival/storage-service test`: passed, 181 tests / 826 assertions.
- `pnpm typecheck`: passed.
- `pnpm --filter @revival/web build`: passed; bundle `assets/index-C072Eosf.js`.
- Focused Chromium 1,000 and 10,000 activated search gates: passed.
- Final `pnpm check`: typecheck and production build passed; 139 of 141 Web E2E tests passed.

The two final-suite failures are outside this repair: the Task 8D activation assertion passed when rerun alone, while the physical 3,000-record flow has a separate, stable import acceptance failure after its stale date fixture is reached. No product behavior was changed to mask either result.

## Release Decision

`TASK8E1_SEARCH_GATE: PASS`

`TASK8E_OVERALL_MERGE_ALLOWED: NO`

The activated IndexedDB search blocker is closed. The branch remains ineligible for merge, pull request, deployment, or user migration until the independent 3,000-record physical acceptance failure is separately scoped and resolved. A previously tracked historical screenshot remains tracked because the environment rejected removing it from Git without a separate confirmed repository-hygiene approval; its local file was not deleted.