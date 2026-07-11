# Friend Test Guide

Production URL:

```text
https://xiaohongshu-green.vercel.app
```

Current product shape: public Web MVP. It is not a PWA, not a native app, and not connected to real Xiaohongshu APIs.

## What Friends Can Test

- Import one new saved item at `/import`.
- Review generated action cards.
- Check smart album candidates at `/albums`.
- Search and recover original source links at `/search`.
- Use `/real-test` to test 3-5 real Xiaohongshu saves and copy the test summary.

## What It Cannot Do Yet

- No login.
- No cloud sync.
- No real AI provider unless API Key is configured later.
- No real mobile share extension.
- No automatic reading of a full Xiaohongshu favorite folder.
- No Chrome Web Store or Edge Add-ons release.

## Privacy Reminder

Data is stored in each tester’s own browser localStorage. Friends should avoid entering private content, private notes, or sensitive URLs. Different friends will not see each other’s data.

## Suggested 15-Minute Test

1. Open `/real-test`.
2. Paste 3-5 real saved links or share snippets.
3. For each item, rate classification, action-card usefulness, next-step clarity, search recall, and reward feel.
4. Click “复制试用总结”.
5. Send the copied summary back to the product owner.

## Optional Old Favorites Beta

If testing old favorite scanning, install the unpacked extension from `release-artifacts/extension-beta` and open `/old-import` after scanning. The extension only scans the current loaded DOM after user action.

## Pre-Test Owner Checklist

- Run `pnpm check`.
- Run `pnpm verify:prod` when network access allows it.
- Manually open `/`, `/import`, `/albums`, `/old-import`, `/real-test`, `/search`, `/settings`, and `/qa`.
- Confirm `/real-test` can export JSON/Markdown and copy summary.
