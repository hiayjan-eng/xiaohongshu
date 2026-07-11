# Browser Extension Beta User Guide

This guide is for Chrome and Microsoft Edge unpacked-extension testing. The extension is not a Chrome Web Store or Edge Add-ons release.

## What It Does

The extension scans the current visible DOM on a Xiaohongshu web page after the user clicks the scan button. It extracts only basic visible card information:

- title
- sourceUrl
- coverUrl when visible
- visibleText when visible
- sourcePlatform: `xiaohongshu`

It does not log in for the user, bypass verification, crawl cloud data, or read a full favorite folder automatically.

## Build The Beta Folder

```bash
pnpm --filter @revival/extension build
```

The build output is:

```text
release-artifacts/extension-beta
```

## Install In Chrome

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click “Load unpacked”.
4. Select `release-artifacts/extension-beta`.
5. Pin the extension if you want easier access.

## Install In Edge

1. Open `edge://extensions`.
2. Turn on Developer mode.
3. Click “Load unpacked”.
4. Select `release-artifacts/extension-beta`.

## Test Flow

1. Open your own logged-in Xiaohongshu web favorite page.
2. Click the extension.
3. Click “扫描当前可见卡片” or “轻滚动后扫描”.
4. Review the statistics and the checkbox list.
5. Uncheck anything you do not want to import.
6. Click “导入并查看结果”.
7. The Web MVP opens `/old-import` with the ImportBatch payload.

## Safety Boundary

This Beta only reads what is already loaded in your browser tab. It does not promise one-click scanning of the entire historical favorite folder. If Xiaohongshu changes its web DOM, card extraction may become unstable.
