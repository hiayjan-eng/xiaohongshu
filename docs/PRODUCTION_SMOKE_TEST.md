# Production Smoke Test

This project is currently deployed as a public Web MVP at:

- Production URL: https://xiaohongshu-green.vercel.app
- Latest known deployment URL: https://xiaohongshu-m1ybf27l3-ayj.vercel.app

The app is still a localStorage/mock-AI MVP. It is not a PWA, not a native app, and not connected to a cloud database or real Xiaohongshu API.

## Automated route check

Run:

```bash
pnpm verify:prod
```

The script uses Node `fetch`, not Playwright. It checks that these routes return the Vite `index.html` and do not 404:

- `/`
- `/dashboard`
- `/import`
- `/albums`
- `/old-import`
- `/qa`
- `/real-test`
- `/search`
- `/settings`

To verify another deployment, set `PRODUCTION_URL`:

```bash
PRODUCTION_URL=https://your-preview.vercel.app pnpm verify:prod
```

On Windows PowerShell:

```powershell
$env:PRODUCTION_URL="https://your-preview.vercel.app"; pnpm verify:prod
```

## Manual smoke test

1. Open `/` and confirm the page is not blank.
2. Open `/import`, import one Xiaohongshu-style link, and confirm an ImportBatch is created.
3. Open `/albums`, confirm SmartAlbum candidates are visible, then confirm, rename, and archive one album.
4. Open `/old-import`, confirm the old collection scan Beta guidance appears.
5. Open `/search`, search for a newly imported keyword, then open the action card.
6. Open `/settings`, switch theme, refresh, and confirm it persists.
7. Open `/real-test`, add one test record, test search recall, and copy/export the summary.
8. Refresh `/albums`, `/old-import`, `/real-test`, `/search`, and `/settings`; none should 404.

## Current GitHub sync status

As of the generated state report, local `main` is ahead of `origin/main` by 2 commits, but this environment cannot connect to `github.com:443`. A recovery bundle has been generated at:

```text
release-artifacts/xiaohongshu-phase-latest.bundle
```

Once GitHub connectivity is restored, run:

```bash
git push origin main
```

Do not force push unless the user explicitly decides to rewrite history.
## Friend Test Smoke

Before sending the URL to friends, check:

1. `/real-test` opens and shows the friend test entry.
2. `/qa` shows the Web MVP / localStorage reminder.
3. A friend can test 3-5 real saves and click “复制试用总结”.
4. If old-favorite scanning is included in the test, build the extension Beta with:

```bash
pnpm --filter @revival/extension build
```

Then install `release-artifacts/extension-beta` as an unpacked Chrome or Edge extension. This is not a store release.
