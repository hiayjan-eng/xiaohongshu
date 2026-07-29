importScripts("full-scan-idb.js");

const WEB_APP_URL_PATTERNS = [
  "https://xiaohongshu-green.vercel.app/*",
  "http://localhost:5173/*",
  "http://127.0.0.1:5173/*"
];

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel();
  void reinjectOpenWebTabs();
});

chrome.runtime.onStartup?.addListener(() => {
  void configureSidePanel();
  void reinjectOpenWebTabs();
});

void configureSidePanel();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isFullScanDatabaseMessage(message)) return false;
  void globalThis.CollectionRevivalFullScanDb.handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  return true;
});

async function configureSidePanel() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // Older Chromium builds may expose the API before supporting this behavior.
  }
}

function isFullScanDatabaseMessage(message) {
  return [
    "M0_FULL_SCAN_CREATE_SESSION",
    "M0_FULL_SCAN_GET_SESSION",
    "M0_FULL_SCAN_UPDATE_SESSION",
    "M0_FULL_SCAN_PERSIST_ITEMS",
    "M0_FULL_SCAN_VERIFY_SESSION",
    "M0_FULL_SCAN_GET_DIAGNOSTICS",
    "M0_FULL_SCAN_RESET_SESSION"
  ].includes(message?.type);
}

async function reinjectOpenWebTabs() {
  const tabs = await chrome.tabs.query({ url: WEB_APP_URL_PATTERNS });
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/web-bridge.js"] });
    } catch {
      // Some tabs may still be loading or lack permission. Popup/Web fallback will retry.
    }
  }));
}
