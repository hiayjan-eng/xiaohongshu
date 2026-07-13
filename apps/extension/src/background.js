const WEB_APP_URL_PATTERNS = [
  "https://xiaohongshu-green.vercel.app/*",
  "http://localhost:5173/*",
  "http://127.0.0.1:5173/*"
];

chrome.runtime.onInstalled.addListener(() => {
  void reinjectOpenWebTabs();
});

chrome.runtime.onStartup?.addListener(() => {
  void reinjectOpenWebTabs();
});

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
