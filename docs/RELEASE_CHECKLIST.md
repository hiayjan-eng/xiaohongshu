# Release Checklist

This document freezes the current MVP release routine. The goal is simple: before and after meaningful changes, run the same checks and confirm the product loop still works.

## Current Project Shape

收藏复活 is currently a Web MVP. It is not a PWA, not a production mobile app, and not connected to a real Xiaohongshu interface. The `apps/mobile` folder is only a reserved prototype structure for future mobile work.

The current stable product surface is the Vite React Web app in `apps/web`.

## Local Start

Install dependencies:

```bash
pnpm install
```

Start the Web MVP:

```bash
pnpm --filter @revival/web dev -- --host 0.0.0.0 --port 5173
```

Open:

- App: `http://localhost:5173/`
- QA panel: `http://localhost:5173/qa`
- Real test mode: `http://localhost:5173/real-test`

## Required Pre-Release Commands

Run these before treating a change as stable:

```bash
pnpm install
pnpm check
```

`pnpm check` runs the full stability gate:

```bash
pnpm typecheck
pnpm --filter @revival/web build
pnpm test:e2e
```

For a faster local pass without browser automation, run:

```bash
pnpm check:quick
```

## Manual Acceptance Checklist

Use this checklist after larger UI or workflow changes, even when automated tests pass:

- Open the homepage at `http://localhost:5173/`.
- Open `/qa` and confirm the QA panel renders.
- Reset demo data, then import demo data from `/qa`.
- Add one new saved item through “复活一条新收藏”.
- Search for keywords such as `封面`, `大理`, `低卡晚餐`, or `剪辑`.
- Confirm search results show match reasons.
- Click “打开原帖” and confirm the source URL behavior is correct.
- Click “查看行动卡” and confirm the detail page opens.
- Mark an action card as “已复活”.
- Confirm reward feedback appears once.
- Confirm achievement feedback can trigger without repeated duplicate unlocks.
- Switch themes in settings, refresh the page, and confirm the selected theme persists.
- Add one `/real-test` record, test search recall, save the evaluation, refresh, and confirm it persists.
- Export the `/real-test` summary as Markdown or JSON.
- Check a mobile-sized viewport and confirm the main layout does not overflow horizontally.

## Failure Triage

### Typecheck Failure

Run the Web typecheck directly to isolate the failing package:

```bash
pnpm --filter @revival/web typecheck
```

Most failures here are TypeScript prop, import, or shared type mismatches.

### Build Failure

Run the Web build directly:

```bash
pnpm --filter @revival/web build
```

If typecheck passes but build fails, check Vite config, package imports, static assets, or browser-only APIs used during build.

### E2E Failure

Run Playwright with the normal script first:

```bash
pnpm test:e2e
```

For visual debugging, use headed mode or UI mode:

```bash
pnpm test:e2e:headed
pnpm test:e2e:ui
```

Common causes are changed button text, missing `data-testid`, localStorage state assumptions, or a route that no longer renders the expected title.

### Localhost Cannot Be Reached

Start the app explicitly:

```bash
pnpm --filter @revival/web dev -- --host 0.0.0.0 --port 5173
```

Then open `http://localhost:5173/`. If the port is occupied, stop the old process or run with another port and set the matching Playwright environment variables later.

### Playwright Browser Missing

The current setup uses the installed Chrome channel by default. If another machine does not have Chrome, either install Chrome or install Playwright browsers and adjust `PLAYWRIGHT_CHANNEL` as needed.

## Known Limits

- Data is stored in localStorage, not a production database.
- AI classification and action-card generation are mock/rule-based.
- There is no real Xiaohongshu API integration.
- There is no crawler and no reading of a user's Xiaohongshu collection folder.
- There is no real mobile system share entry yet.
- There is no PWA packaging.
- There is no cloud sync.
- There is no login system.
