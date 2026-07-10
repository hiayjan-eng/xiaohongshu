# 收藏复活 MVP QA Report

Updated: 2026-07-09

## Project Shape

The current product is a Web MVP built with Vite and React inside a pnpm workspace. It is not currently a PWA, and it does not include production mobile app packaging. The `apps/mobile` directory is kept as a future mobile/app prototype structure, not as a complete native iOS or Android app.

The main preview target is:

```bash
pnpm --filter @revival/web dev -- --host 0.0.0.0 --port 5173
```

Preview URLs:

- Web app: `http://localhost:5173/`
- QA panel: `http://localhost:5173/qa`
- Real test mode: `http://localhost:5173/real-test`

## E2E Coverage

Playwright tests now cover the MVP paths that should stay stable during later UI or feature work:

- Page health for `/`, `/dashboard`, `/search`, `/settings`, `/qa`, and `/real-test`
- QA seed reset and demo data import, with at least 20 SavedItems and ActionCards
- Simulated Xiaohongshu share import through “复活一条新收藏”
- Mock AI classification, action card generation, keywords, entities, and searchableText persistence
- Collection pool lookup after import
- Search recall for terms such as `封面`, `小红书`, `设计`, `大理`, `低卡晚餐`, and `剪辑`
- Search result match reasons, “打开原帖”, and “查看行动卡”
- Completion reward flow, revived status, dashboard stats, and first achievement unlock
- Search-to-open behavior and “原帖找回” achievement unlock without duplicate unlocks
- Switching and persisting all 5 preset themes
- Empty dashboard, empty collection pool, no-result search, and missing sourceUrl fallback
- Desktop and mobile viewport sanity checks at `1440x900` and `390x844`
- Real user test mode: create one record, generate an action card, rate it, test search recall, persist after refresh, and export Markdown / JSON

## How To Run

Install dependencies first if needed:

```bash
pnpm install
```

Run all E2E checks:

```bash
pnpm test:e2e
```

Run headed mode:

```bash
pnpm test:e2e:headed
```

Open the Playwright UI:

```bash
pnpm test:e2e:ui
```

The Playwright config can reuse an existing dev server on `http://localhost:5173/`. If it is not already running, it will start the Web app with:

```bash
pnpm run dev -- --host 0.0.0.0 --port 5173
```

## Current Result

The current E2E baseline passes:

```text
17 passed
```

TypeScript typecheck also passes for the Web app:

```bash
pnpm --filter @revival/web typecheck
```

## Known Limits

- The app still uses localStorage/mock database storage, so E2E state is browser-local and intentionally reset by tests.
- AI classification and action-card generation are mock/rule-based, not connected to a real model.
- “打开原帖” is validated by URL/open behavior in tests; the test suite does not navigate away to Xiaohongshu.
- Mobile coverage is responsive Web/prototype coverage, not native iOS or Android automation.
- Playwright uses the installed Chrome channel by default. If Chrome is not installed on another machine, set `PLAYWRIGHT_CHANNEL` or install Playwright browsers.

## Suggested Next Priority

Keep this E2E baseline as the product safety net. The next useful product-learning step is to run 20 real Xiaohongshu saves through `/real-test`, then prioritize AI mock-rule and search improvements from the observed failures.
