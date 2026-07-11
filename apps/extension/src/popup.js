const DEFAULT_WEB_APP_URL = "https://xiaohongshu-green.vercel.app/old-import";
const STORAGE_KEY = "revival-extension-settings";

const state = {
  items: [],
  pageUrl: "",
  webAppUrl: DEFAULT_WEB_APP_URL
};

const elements = {
  webAppUrl: document.querySelector("#webAppUrl"),
  scanVisible: document.querySelector("#scanVisible"),
  scanScroll: document.querySelector("#scanScroll"),
  importToWeb: document.querySelector("#importToWeb"),
  exportJson: document.querySelector("#exportJson"),
  status: document.querySelector("#status"),
  count: document.querySelector("#count"),
  list: document.querySelector("#list")
};

init();

async function init() {
  const settings = await chrome.storage.local.get(STORAGE_KEY);
  state.webAppUrl = settings[STORAGE_KEY]?.webAppUrl || DEFAULT_WEB_APP_URL;
  elements.webAppUrl.value = state.webAppUrl;
  elements.webAppUrl.addEventListener("change", saveSettings);
  elements.scanVisible.addEventListener("click", () => scanActiveTab(false));
  elements.scanScroll.addEventListener("click", () => scanActiveTab(true));
  elements.importToWeb.addEventListener("click", importToWeb);
  elements.exportJson.addEventListener("click", exportJson);
}

async function saveSettings() {
  state.webAppUrl = elements.webAppUrl.value.trim() || DEFAULT_WEB_APP_URL;
  await chrome.storage.local.set({ [STORAGE_KEY]: { webAppUrl: state.webAppUrl } });
}

async function scanActiveTab(autoScroll) {
  setStatus(autoScroll ? "正在轻滚动并扫描已加载卡片..." : "正在扫描当前可见卡片...");
  try {
    await saveSettings();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("没有找到当前标签页");
    if (!/^https?:\/\//.test(tab.url || "")) throw new Error("请在小红书网页版页面中使用这个扩展");

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content-script.js"] });
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "REVIVAL_SCAN_VISIBLE_CARDS",
      autoScroll,
      maxScrolls: autoScroll ? 6 : 0,
      delayMs: 650
    });

    if (!response?.ok) throw new Error(response?.error || "扫描失败");
    state.items = response.items || [];
    state.pageUrl = response.pageUrl || tab.url || "";
    renderResults();
    setStatus(state.items.length ? `扫描到 ${state.items.length} 条候选收藏，请确认后导入。` : "没有识别到收藏卡片，可以先手动滚动页面再试一次。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "扫描失败");
  }
}

function renderResults() {
  elements.count.textContent = `${state.items.length} 条`;
  elements.importToWeb.disabled = state.items.length === 0;
  elements.exportJson.disabled = state.items.length === 0;
  elements.list.innerHTML = "";

  if (state.items.length === 0) {
    elements.list.innerHTML = `<div class="result-card"><strong>暂无结果</strong><small>打开你本人的小红书收藏夹页面后再扫描。</small></div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  state.items.slice(0, 80).forEach((item) => {
    const card = document.createElement("article");
    card.className = "result-card";
    card.innerHTML = `
      <strong></strong>
      <a target="_blank" rel="noreferrer noopener"></a>
      <small></small>
    `;
    card.querySelector("strong").textContent = item.title || "未命名收藏";
    const link = card.querySelector("a");
    link.href = item.sourceUrl || "#";
    link.textContent = item.sourceUrl || "未识别链接";
    card.querySelector("small").textContent = item.visibleText ? item.visibleText.slice(0, 90) : "只保存可见文本，不复制原帖全文";
    fragment.appendChild(card);
  });
  elements.list.appendChild(fragment);
}

function buildPayload() {
  return {
    source: "browser-extension-poc",
    sourcePlatform: "xiaohongshu",
    scannedAt: new Date().toISOString(),
    pageUrl: state.pageUrl,
    items: state.items
  };
}

function importToWeb() {
  const payload = buildPayload();
  const encoded = encodeBase64Url(JSON.stringify(payload));
  const baseUrl = normalizeWebAppUrl(state.webAppUrl);
  chrome.tabs.create({ url: `${baseUrl}#extension-import=${encoded}` });
}

function exportJson() {
  const payload = buildPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename: `collection-revival-xhs-scan-${Date.now()}.json`,
    saveAs: true
  });
}

function normalizeWebAppUrl(value) {
  const clean = (value || DEFAULT_WEB_APP_URL).trim().replace(/#.*$/, "");
  return clean;
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function setStatus(message) {
  elements.status.textContent = message;
}
