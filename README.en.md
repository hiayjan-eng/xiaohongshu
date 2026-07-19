# Collection Revival System MVP

[English](README.en.md) | [简体中文](README.md)

Collection Revival is a web MVP that turns bookmarked content users actively share into the app into executable action cards, plans, and a searchable index. Its core goal is not to organize more saves, but to help users pick back up the content that once excited them: they can search and recover the original post, and know exactly which step to start with today.

## What's done

- Simulated share import: saves `sourceUrl`, `title`, `rawShareText`, and `userNote`.
- Mock AI auto-classification: covers skill learning, travel spots, food & restaurant hunting, recipes & cooking, outfits & style, home life, work productivity, inspiration material, and others.
- Action card generation: generates next-step actions, tasks, structured fields, and estimated time based on the category.
- Search & recover: keyword search, match-reason display, "open original post", and "view action card".
- Today's Revival: the Dashboard recommends 1-3 actionable cards for today.
- Collection pool & plan library: view imported items, their status, and simple plans.
- Theme system: 5 preset themes, persisted across refreshes.
- Completion rewards & light achievements: completing an action card moves it to the "Revived" state and updates basic stats.
- QA self-check page: `/qa` supports resetting and importing 20 demo items.
- E2E regression tests: Playwright covers the core MVP loop; the current baseline is 17 passed.

## What it is NOT (yet)

This project is currently not a PWA, not a real iOS/Android app, and not connected to the real Xiaohongshu API. It does not log into Xiaohongshu accounts, does not read user favorites, does no bulk crawling, and does not store or publicly display full original posts. Full content is always viewed on the source platform via `sourceUrl`.

It also currently has no login system, cloud sync, production database, real AI service, mobile system share entry, native desktop widget, or Electron desktop app.

## Project structure

```text
apps/
  web/       Vite + React Web MVP
  mobile/    Structural placeholder for future mobile and share entry; not a full native app
packages/
  shared-types/
  ai-service/
  search-service/
  action-card-service/
  recommendation-service/
  database/
docs/
  MVP_QA_REPORT.md
  RELEASE_CHECKLIST.md
  REAL_USER_TEST_TEMPLATE.md
```

## Installation

```bash
pnpm install
```

## Run locally

```bash
pnpm --filter @revival/web dev -- --host 0.0.0.0 --port 5173
```

Open:

- Web app: `http://localhost:5173/`
- QA self-check page: `http://localhost:5173/qa`
- Real trial mode: `http://localhost:5173/real-test`

## QA self-check page

`/qa` quickly verifies that local mock data and core state are working. You can reset demo data or import it with one click, and view SavedItem, ActionCard, today's recommendations, completed count, achievement count, and the current theme. The page also has a direct entry to `/real-test`.

## When the preview won't open

If the browser shows `ERR_CONNECTION_REFUSED`, it usually means the local Vite preview server is not persistently running on port 5173. Run:

```bash
pnpm preview:start
```

Or bypass pnpm and run the PowerShell script directly:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-web-preview.ps1
```

Once started, open `http://localhost:5173/real-test`. Logs are written to `web-preview-5173.log` and `web-preview-5173.err.log` in the repo root.

## Testing

Run the E2E regression tests:

```bash
pnpm test:e2e
```

Open the Playwright UI:

```bash
pnpm test:e2e:ui
```

Debug in headed mode:

```bash
pnpm test:e2e:headed
```

## Pre-release checks

Before moving into a stable state, run the full check:

```bash
pnpm check
```

It runs typecheck, web build, and E2E tests in order. For a quick check:

```bash
pnpm check:quick
```

See `docs/RELEASE_CHECKLIST.md` for the detailed pre-release process.

## Vercel deployment

This web MVP can be deployed to Vercel for a stable production URL, avoiding reliance on local `localhost:5173`. Before deploying, run:

```bash
pnpm check
```

On Vercel, select the repo root as the Root Directory, use `pnpm --filter @revival/web build` as the Build Command, and `apps/web/dist` as the Output Directory. See `docs/DEPLOY_VERCEL.md` for details.

## Next phase

The recommended next phase is to run 20 real Xiaohongshu saves through `/real-test`, focusing on classification accuracy, action-card usefulness, search recovery rate, and whether users are willing to act today. `docs/REAL_USER_TEST_TEMPLATE.md` serves as an offline backup template, but the in-app flow is preferred. Once real-trial results stabilize, we'll consider integrating real AI, designing production data storage, and validating the mobile system share entry.

## Production smoke test

Current production URL: https://xiaohongshu-green.vercel.app

Run the production route smoke test with:

```bash
pnpm verify:prod
```

This uses Node `fetch` to verify `/`, `/dashboard`, `/import`, `/albums`, `/old-import`, `/qa`, `/real-test`, `/search`, and `/settings` return the SPA shell. See `docs/PRODUCTION_SMOKE_TEST.md` for the full checklist.

Current GitHub sync note: local `main` may be ahead of `origin/main` if this environment cannot reach GitHub. When connectivity is restored, run `git push origin main`. A recovery bundle can be generated under `release-artifacts/` for handoff.

## AI provider configuration

The default mode is still mock/local rules — no network and no API key required. Real AI is integrated through the server-side `/api/ai` proxy: the frontend only calls its own backend, and real keys can only live in Vercel Environment Variables or a local server-side `.env.local` — never in any variable name that ends up in the browser bundle.

`.env.example` keeps only an empty template:

```bash
AI_PROVIDER=mock
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=
AI_TIMEOUT_MS=30000
```

Supported modes:

- `AI_PROVIDER=mock`: default local mock provider; no real model requests.
- `AI_PROVIDER=openai-compatible`: server-side OpenAI-compatible chat completions provider; requires `AI_API_KEY` configured on the server.

If there is no key, the API times out, or the returned JSON is invalid, the web app falls back to mock so that import, search, smart albums, and the real-trial page never go blank. See `docs/AI_PROVIDER_SETUP.md` and `docs/AI_PROVIDER_AND_PROMPTS.md` for details.

## Phase 2/3 architecture status

The current version has split out the next-phase integration points for AI and storage, while remaining a stable local web MVP by default.

- AI: `packages/ai-service` provides `AiProvider`, `MockAiProvider`, and the OpenAI-compatible provider chain. Without a server-side `AI_API_KEY`, it keeps using mock fallback and consumes no network requests.
- Prompts: all live in `packages/ai-service/src/prompts.ts`; the boundary is to generate only private summaries, action suggestions, and search indexes — never copying full original posts.
- Sync: `packages/storage-service` covers SavedItem, ActionCard, ImportBatch, SmartAlbum, Task, Plan, Achievement, SearchLog, RealUserTestRecord. The default is localStorage; the Supabase adapter requires the project URL, anon key, Auth, and RLS verification before it can be enabled.
- Settings page: now shows AI status and sync status, so mock/localStorage is never mistaken for real cloud capability.

Related docs:

- `docs/AI_PROVIDER_AND_PROMPTS.md`
- `docs/SUPABASE_SCHEMA.md`
- `docs/AUTH_AND_SYNC_PLAN.md`

## Phase 4-6 status

The current version stays web-MVP-first — no real app, PWA, login, or cloud sync. Phase 4-6 added the following verifiable assets:

- Mobile: `apps/mobile` is still a skeleton; `docs/MOBILE_SHARE_TECH_SPEC.md` and `docs/MOBILE_MVP_SCOPE.md` were added, explaining how iOS Share Extension / Android Send Intent feed into the unified ImportBatch pipeline.
- Extension Beta: `apps/extension` now has `pnpm --filter @revival/extension build`, outputting `release-artifacts/extension-beta`, which can be installed as an unpacked Beta in Chrome / Edge.
- Friend Test: `/real-test` has a friend-test entry note at the top, `/qa` has an online-testing reminder, and `docs/FRIEND_TEST_GUIDE.md` works directly as a test SOP.

Related commands:

```bash
pnpm --filter @revival/mobile typecheck
pnpm --filter @revival/extension typecheck
pnpm --filter @revival/extension build
pnpm check
```
