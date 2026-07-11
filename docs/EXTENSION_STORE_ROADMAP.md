# Extension Store Roadmap

Current status: the browser extension is an unpacked Beta for user testing. It should not be submitted to Chrome Web Store or Edge Add-ons yet.

## Why Not Store Release Yet

- Xiaohongshu DOM extraction is still a POC-level heuristic.
- We need more friend testing on Chrome and Edge before making public permission claims.
- The privacy policy and permission explanation are not ready.
- Store review may reject unclear scraping-like behavior unless the user-triggered, local-only boundary is very explicit.

## Required Before Chrome Web Store

- Chrome Developer Account.
- Public privacy policy page.
- Clear permission explanations for `activeTab`, `scripting`, `storage`, and `downloads`.
- Screenshots and store listing copy.
- Stable extension build artifact.
- Manual test report covering Chrome on Windows and macOS if possible.

## Required Before Edge Add-ons

- Microsoft Partner Center / Edge extension publishing account.
- Same privacy and permission documentation as Chrome.
- Edge-specific smoke test.

## Permission Positioning

- `activeTab`: used only after the user clicks the extension while viewing their own Xiaohongshu page.
- `scripting`: injects the scanner into the current active tab.
- `storage`: stores the Web MVP destination URL.
- `downloads`: exports the scan payload as JSON for local review.

The extension must not request broad host permissions until there is a clear, reviewed reason.

## Compliance Boundary

Do not add automatic login, CAPTCHA bypass, background crawling, cloud scraping, or public data collection. The formal product should continue to scan only the user’s current browser tab after explicit action.
