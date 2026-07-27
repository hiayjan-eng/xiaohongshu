# Phase 1 Production Smoke Blocker Audit

## Status

PHASE1_PRODUCTION_SMOKE_STATUS: FAIL_BLOCKING

## `.app-shell` readiness contract

`IS_APP_SHELL_STILL_A_VALID_PRODUCTION_CONTRACT: YES`, for workbench routes. The current source renders `.app-shell` in `App.tsx` and `MigrationRouteShell.tsx`, and local E2E uses it as the post-bootstrap boundary.

The production home route is an intentional exception: it renders `main.welcome-screen` as a landing page. The initial Smoke used `.app-shell` as the sole readiness signal for `/`, so its root cause was:

`ROOT_CAUSE: STALE_SMOKE_SELECTOR`

The repaired route contract is `main.welcome-screen` for `/`, and `.app-shell` plus `main` and `nav` for workbench routes. No production component was modified.

## Production DOM and asset diagnosis

- Production URL: `https://xiaohongshu-green.vercel.app`
- Deployment baseline: `fb2c3e85bf5ce29b27e4d8afc0e6cd600334a575` / `dpl_9wCQBPRPCTV2yiHM32kewfSHJmca`
- Browser: isolated Chromium 150.0.7871.184, no user profile or extension.
- Document, `index-uc0E8GH4.js`, and `index-DMS-ewsC.css`: HTTP 200.
- Failed requests, console errors, page errors, unhandled rejections: none.
- Root at network idle: present, one child, populated DOM; home has `main.welcome-screen`, nav, and its core heading. It is not a white screen, loading state, or Recovery screen.
- Empty-context Marker, legacy keys, and business IndexedDB: absent.

## Complete isolation Smoke results

| Area | Result | Evidence |
| --- | --- | --- |
| Smoke A public routes | PASS | `/`, `/import`, `/albums`, `/search`, `/settings`, `/settings/data-migration` returned 200, rendered their route contract, and passed refresh. |
| Smoke B fresh user | PASS | LocalStorageRuntime; no Marker, business IndexedDB, migration, Prepare, activation, or Recovery; isolated temporary favorite persisted through refresh. |
| Smoke C Legacy fixture | FAIL_BLOCKING | Fixture hydrated, searched, and opened albums. A theme click wrote `dawn` to `collection-revival-theme`, but refresh restored `lavender-mint`. |
| Smoke D migration entry | PASS | The fixture Context opened the inspection entry only; no buttons were clicked and Marker/IndexedDB remained absent. |
| Visual | PASS | Desktop 1440×900 and mobile 390×844 capture completed; mobile `scrollWidth` and `clientWidth` were both 390. |

## Blocking root cause

`ROOT_CAUSE: LEGACY_SETTINGS_PERSISTENCE_FAILURE`

The theme write was observed before and after an explicit readiness wait. On page refresh, the app replaced it with the fixture's old theme. This is a production behavior failure in the Legacy settings hydration/persistence path, not a timing workaround issue.

## Safety boundary and changes

- No real user data, primary browser profile, real localStorage, or real IndexedDB was read.
- All mutations were synthetic data in disposable isolated Browser Contexts that were closed after each scenario.
- No migration, Prepare, activation, rollback, deletion, Marker or Journal modification, push, merge, deploy, production-code change, or DeepSeek API call occurred.
- Local browser diagnostics and screenshots are confined to ignored `apps/web/test-results/` and are not tracked.
- This audit documents a Smoke-test readiness-contract correction only; no production code was changed.

## Required next step

Fix the Legacy settings hydration/persistence defect, rerun the complete isolated Production Smoke, and only then reassess DeepSeek delegation work. Task B is not authorized while this status is blocking.
