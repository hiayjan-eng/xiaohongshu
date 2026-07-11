# Mobile MVP Scope

Current status: `apps/mobile` intentionally stays lightweight. It should not pull native dependencies into the Web release path until the Web MVP and cloud sync are stable.

## First Mobile App Should Include

- Today Revival: show 1-3 recommended action cards.
- Import: receive a manually pasted link first, then later a system share payload.
- Search: find saved items and open the original source URL.
- Smart Albums: show generated album candidates and confirmed albums.
- My: local settings, theme status, sync status, and future account entry.

## First Mobile App Should Not Include

- Native widgets.
- Full offline sync conflict resolution.
- Xiaohongshu account login.
- Crawling or reading a user’s favorite folder directly.
- App Store or Google Play release work.
- Push notifications beyond a local prototype.

## Current Package Shape

`apps/mobile` currently exports typed screen metadata and `normalizeIncomingShare()` style adapter code. It typechecks as part of `pnpm check`, but it is not an Expo runtime app yet.

Recommended next step after Web/cloud stability: create an isolated Expo app inside `apps/mobile` with its own script, keep Web E2E independent, and only promote it into the main release gate after it can run on at least one real device.

## Widget Timing

Widgets should wait until the native app has:

- Login and sync.
- Stable Today Revival data.
- A clear refresh policy.
- Real device testing.

Until then, Web keeps only the widget preview.
