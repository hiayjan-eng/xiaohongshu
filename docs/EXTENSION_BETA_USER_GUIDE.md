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

The build outputs are:

```text
release-artifacts/extension-beta
release-artifacts/collection-revival-extension-beta-v0.2.2.zip
apps/web/public/downloads/collection-revival-extension-beta-v0.2.2.zip
```

## Install In Chrome

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Download `collection-revival-extension-beta-v0.2.2.zip` from the Web `/old-import` page, or use the local artifact in `release-artifacts`.
4. Unzip it to a fixed folder.
5. Click “Load unpacked”.
6. Select the unzipped folder that contains `manifest.json`.
5. Pin the extension if you want easier access.

## Install In Edge

1. Open `edge://extensions`.
2. Turn on Developer mode.
3. Download `collection-revival-extension-beta-v0.2.2.zip` from the Web `/old-import` page, or use the local artifact in `release-artifacts`.
4. Unzip it to a fixed folder.
5. Click “Load unpacked”.
6. Select the unzipped folder that contains `manifest.json`.

## Test Flow

1. Open your own logged-in Xiaohongshu web favorite page.
2. Click the extension.
3. Choose a scan limit such as “先试 200 条”, then click “开始扫描旧收藏”.
4. Watch the progress bar, real-time counts, and current stage.
5. Try “暂停” and “继续” once to confirm checkpoint recovery.
6. Review the statistics and the checkbox list.
7. Uncheck anything you do not want to import.
8. Click “导入收藏复活”.
9. The Web MVP opens `/old-import` with the ImportBatch payload.

## Safety Boundary

This Beta only reads what is already loaded in your browser tab. It does not promise one-click scanning of the entire historical favorite folder. If Xiaohongshu changes its web DOM, card extraction may become unstable.

