const DEFAULT_WEB_APP_URL = "https://xiaohongshu-green.vercel.app/old-import";
const STORAGE_KEY = "revival-extension-settings";

const state = {
  items: [],
  selectedKeys: new Set(),
  pageUrl: "",
  webAppUrl: DEFAULT_WEB_APP_URL,
  tabUrl: ""
};

const elements = {
  webAppUrl: document.querySelector("#webAppUrl"),
  scanVisible: document.querySelector("#scanVisible"),
  scanScroll: document.querySelector("#scanScroll"),
  importToWeb: document.querySelector("#importToWeb"),
  exportJson: document.querySelector("#exportJson"),
  selectAll: document.querySelector("#selectAll"),
  clearSelection: document.querySelector("#clearSelection"),
  pageHealth: document.querySelector("#pageHealth"),
  status: document.querySelector("#status"),
  statsGrid: document.querySelector("#statsGrid"),
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
  elements.selectAll.addEventListener("click", () => setAllSelected(true));
  elements.clearSelection.addEventListener("click", () => setAllSelected(false));

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  updatePageHealth(tab?.url || "");
  renderResults();
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

    state.tabUrl = tab.url || "";
    updatePageHealth(state.tabUrl);

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content-script.js"] });
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "REVIVAL_SCAN_VISIBLE_CARDS",
      autoScroll,
      maxScrolls: autoScroll ? 6 : 0,
      delayMs: 650
    });

    if (!response?.ok) throw new Error(response?.error || "扫描失败");
    state.items = normalizeItems(response.items || []);
    state.selectedKeys = new Set(state.items.map(itemKey));
    state.pageUrl = response.pageUrl || tab.url || "";
    renderResults();
    setStatus(state.items.length ? `扫描到 ${state.items.length} 条候选收藏，请确认后导入。` : "没有识别到收藏卡片，可以先手动滚动页面再试一次。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "扫描失败");
  }
}

function normalizeItems(items) {
  return items
    .map((item) => ({
      title: (item.title || "").trim(),
      sourceUrl: (item.sourceUrl || "").trim(),
      coverUrl: item.coverUrl || undefined,
      visibleText: (item.visibleText || "").trim(),
      sourcePlatform: "xiaohongshu"
    }))
    .filter((item) => item.sourceUrl || item.title);
}

function updatePageHealth(tabUrl) {
  const isXhs = /xiaohongshu\.com|xhslink\.com/i.test(tabUrl);
  const looksCollection = /collection|favorite|fav|likes|profile|收藏|小红书/i.test(tabUrl);
  elements.pageHealth.className = isXhs ? "page-health ok" : "page-health warn";
  elements.pageHealth.textContent = isXhs
    ? looksCollection
      ? "已检测到小红书页面。请确认这是你本人已登录的收藏夹或相关页面。"
      : "已检测到小红书页面，但不一定是收藏夹。Beta 只会读取当前可见卡片。"
    : "当前标签页不像小红书页面，请先打开你本人的小红书网页版收藏夹。";
}

function renderResults() {
  const selectedItems = getSelectedItems();
  const stats = computeStats(state.items);
  elements.count.textContent = `${selectedItems.length} / ${state.items.length} 条`;
  elements.importToWeb.disabled = selectedItems.length === 0;
  elements.exportJson.disabled = selectedItems.length === 0;
  elements.selectAll.disabled = state.items.length === 0;
  elements.clearSelection.disabled = state.items.length === 0;
  renderStats(stats);
  elements.list.innerHTML = "";

  if (state.items.length === 0) {
    elements.list.innerHTML = `<div class="result-card"><strong>暂无结果</strong><small>打开你本人的小红书收藏夹页面后再扫描。</small></div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  state.items.slice(0, 120).forEach((item) => {
    const key = itemKey(item);
    const card = document.createElement("article");
    card.className = "result-card selectable";
    card.innerHTML = `
      <label class="scan-choice">
        <input type="checkbox" />
        <span>
          <strong></strong>
          <a target="_blank" rel="noreferrer noopener"></a>
          <small></small>
        </span>
      </label>
    `;
    const checkbox = card.querySelector("input");
    checkbox.checked = state.selectedKeys.has(key);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedKeys.add(key);
      else state.selectedKeys.delete(key);
      renderResults();
    });
    card.querySelector("strong").textContent = item.title || "未命名收藏";
    const link = card.querySelector("a");
    link.href = item.sourceUrl || "#";
    link.textContent = item.sourceUrl || "未识别链接";
    card.querySelector("small").textContent = item.visibleText ? item.visibleText.slice(0, 90) : "只保存可见文本，不复制原帖全文";
    fragment.appendChild(card);
  });
  elements.list.appendChild(fragment);
}

function renderStats(stats) {
  const cells = [
    [stats.total, "总数"],
    [stats.withLinks, "有链接"],
    [stats.duplicates, "重复"],
    [stats.missingTitles, "缺标题"]
  ];
  elements.statsGrid.innerHTML = cells.map(([value, label]) => `<span><strong>${value}</strong><small>${label}</small></span>`).join("");
}

function computeStats(items) {
  const seen = new Set();
  let duplicates = 0;
  items.forEach((item) => {
    const key = item.sourceUrl || item.title;
    if (key && seen.has(key)) duplicates += 1;
    if (key) seen.add(key);
  });
  return {
    total: items.length,
    withLinks: items.filter((item) => item.sourceUrl).length,
    duplicates,
    missingTitles: items.filter((item) => !item.title).length
  };
}

function setAllSelected(selected) {
  state.selectedKeys = selected ? new Set(state.items.map(itemKey)) : new Set();
  renderResults();
}

function getSelectedItems() {
  return state.items.filter((item) => state.selectedKeys.has(itemKey(item)));
}

function itemKey(item) {
  return `${item.sourceUrl || ""}|${item.title || ""}`;
}

function buildPayload() {
  return {
    source: "browser-extension-poc",
    sourcePlatform: "xiaohongshu",
    scannedAt: new Date().toISOString(),
    pageUrl: state.pageUrl,
    items: getSelectedItems()
  };
}

function importToWeb() {
  const payload = buildPayload();
  if (payload.items.length === 0) {
    setStatus("请先勾选要导入的收藏");
    return;
  }
  const encoded = encodeBase64Url(JSON.stringify(payload));
  const baseUrl = normalizeWebAppUrl(state.webAppUrl);
  chrome.tabs.create({ url: `${baseUrl}#extension-import=${encoded}` });
}

function exportJson() {
  const payload = buildPayload();
  if (payload.items.length === 0) {
    setStatus("请先勾选要导出的收藏");
    return;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename: `collection-revival-xhs-scan-${Date.now()}.json`,
    saveAs: true
  });
}

function normalizeWebAppUrl(value) {
  return (value || DEFAULT_WEB_APP_URL).trim().replace(/#.*$/, "");
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