const DEFAULT_WEB_APP_URL = "https://xiaohongshu-green.vercel.app/old-import";
const SETTINGS_KEY = "revival-extension-settings";
const CHECKPOINT_KEY = "revival-extension-checkpoint";
const XHS_COLLECTION_URL = "https://www.xiaohongshu.com/explore";

const state = {
  items: [],
  selectedKeys: new Set(),
  pageUrl: "",
  webAppUrl: DEFAULT_WEB_APP_URL,
  tabUrl: "",
  search: "",
  scanning: false,
  paused: false,
  noNewRounds: 0,
  lastStatus: "idle"
};

const elements = {
  webAppUrl: document.querySelector("#webAppUrl"),
  autoScrollToggle: document.querySelector("#autoScrollToggle"),
  scanVisible: document.querySelector("#scanVisible"),
  startScan: document.querySelector("#startScan"),
  pauseScan: document.querySelector("#pauseScan"),
  resumeScan: document.querySelector("#resumeScan"),
  clearCheckpoint: document.querySelector("#clearCheckpoint"),
  openCollection: document.querySelector("#openCollection"),
  importToWeb: document.querySelector("#importToWeb"),
  exportJson: document.querySelector("#exportJson"),
  selectAll: document.querySelector("#selectAll"),
  clearSelection: document.querySelector("#clearSelection"),
  searchBox: document.querySelector("#searchBox"),
  pageHealth: document.querySelector("#pageHealth"),
  status: document.querySelector("#status"),
  statsGrid: document.querySelector("#statsGrid"),
  count: document.querySelector("#count"),
  list: document.querySelector("#list")
};

init();

async function init() {
  const settings = await chrome.storage.local.get([SETTINGS_KEY, CHECKPOINT_KEY]);
  state.webAppUrl = settings[SETTINGS_KEY]?.webAppUrl || DEFAULT_WEB_APP_URL;
  const checkpoint = settings[CHECKPOINT_KEY];
  if (checkpoint?.items?.length) {
    state.items = normalizeItems(checkpoint.items);
    state.selectedKeys = new Set(checkpoint.selectedKeys || state.items.map(itemKey));
    state.pageUrl = checkpoint.pageUrl || "";
    setStatus(`已恢复上次断点：${state.items.length} 条候选收藏`);
  }

  elements.webAppUrl.value = state.webAppUrl;
  elements.webAppUrl.addEventListener("change", saveSettings);
  elements.scanVisible.addEventListener("click", scanVisibleCards);
  elements.startScan.addEventListener("click", startAutoScan);
  elements.pauseScan.addEventListener("click", pauseScan);
  elements.resumeScan.addEventListener("click", resumeScan);
  elements.clearCheckpoint.addEventListener("click", clearCheckpoint);
  elements.openCollection.addEventListener("click", () => chrome.tabs.create({ url: XHS_COLLECTION_URL }));
  elements.importToWeb.addEventListener("click", importToWeb);
  elements.exportJson.addEventListener("click", exportJson);
  elements.selectAll.addEventListener("click", () => setAllSelected(true));
  elements.clearSelection.addEventListener("click", () => setAllSelected(false));
  elements.searchBox.addEventListener("input", () => {
    state.search = elements.searchBox.value.trim().toLowerCase();
    renderResults();
  });

  await refreshPageStatus();
  renderResults();
}

async function saveSettings() {
  state.webAppUrl = elements.webAppUrl.value.trim() || DEFAULT_WEB_APP_URL;
  await chrome.storage.local.set({ [SETTINGS_KEY]: { webAppUrl: state.webAppUrl } });
}

async function refreshPageStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabUrl = tab?.url || "";
  updatePageHealth(state.tabUrl, undefined);
  if (!tab?.id || !/^https?:\/\//.test(state.tabUrl)) return;
  try {
    await ensureContentScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: "REVIVAL_GET_PAGE_STATUS" });
    updatePageHealth(state.tabUrl, response);
  } catch {
    updatePageHealth(state.tabUrl, undefined);
  }
}

async function scanVisibleCards() {
  setStatus("正在扫描当前已加载卡片...");
  try {
    const response = await scanStep(false);
    mergeItems(response.items || []);
    state.pageUrl = response.pageUrl || state.tabUrl;
    await saveCheckpoint();
    setStatus(state.items.length ? `已发现 ${state.items.length} 条候选收藏，请确认后导入。` : "没有识别到卡片，可以先手动滚动页面再试。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "扫描失败");
  }
}

async function startAutoScan() {
  if (state.scanning) return;
  state.scanning = true;
  state.paused = false;
  state.noNewRounds = 0;
  updateScanButtons();
  setStatus("正在扫描旧收藏，可随时暂停...");

  try {
    while (state.scanning && !state.paused) {
      const before = state.items.length;
      const response = await scanStep(Boolean(elements.autoScrollToggle.checked));
      if (response.blocked) {
        setStatus(response.reason || "页面出现登录、验证码或访问限制，已停止扫描。");
        break;
      }
      mergeItems(response.items || []);
      state.pageUrl = response.pageUrl || state.tabUrl;
      state.noNewRounds = state.items.length === before ? state.noNewRounds + 1 : 0;
      await saveCheckpoint();
      renderResults();
      setStatus(`扫描中：已发现 ${state.items.length} 条，连续 ${state.noNewRounds} 轮没有新增会自动停止。`);
      if (!elements.autoScrollToggle.checked || state.noNewRounds >= 3 || response.reachedEnd) break;
      await wait(700);
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "扫描失败");
  } finally {
    state.scanning = false;
    updateScanButtons();
    if (!state.paused) setStatus(state.items.length ? `扫描完成：待导入 ${getSelectedItems().length} / ${state.items.length} 条。` : "扫描完成，但暂时没有识别到收藏卡片。");
  }
}

function pauseScan() {
  state.paused = true;
  state.scanning = false;
  updateScanButtons();
  void saveCheckpoint();
  setStatus(`已暂停，当前保留 ${state.items.length} 条候选收藏。`);
}

function resumeScan() {
  state.paused = false;
  void startAutoScan();
}

async function scanStep(scroll) {
  await saveSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("没有找到当前标签页");
  if (!/^https?:\/\//.test(tab.url || "")) throw new Error("请在小红书网页版页面中使用这个扩展");
  state.tabUrl = tab.url || "";
  updatePageHealth(state.tabUrl, undefined);
  await ensureContentScript(tab.id);
  const response = await chrome.tabs.sendMessage(tab.id, { type: "REVIVAL_SCAN_STEP", scroll, delayMs: 650 });
  if (!response?.ok) throw new Error(response?.error || "扫描失败");
  updatePageHealth(state.tabUrl, response.pageStatus);
  return response;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "REVIVAL_PING" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content-script.js"] });
  }
}

function mergeItems(items) {
  const byKey = new Map(state.items.map((item) => [itemKey(item), item]));
  normalizeItems(items).forEach((item) => {
    const key = itemKey(item);
    if (!byKey.has(key)) byKey.set(key, item);
  });
  state.items = [...byKey.values()];
  state.selectedKeys = new Set([...state.selectedKeys, ...state.items.map(itemKey)]);
  renderResults();
}

function normalizeItems(items) {
  return items
    .map((item) => ({
      title: (item.title || "").trim(),
      sourceUrl: (item.sourceUrl || "").trim(),
      coverUrl: item.coverUrl || undefined,
      visibleText: (item.visibleText || "").trim(),
      author: (item.author || "").trim() || undefined,
      noteType: item.noteType || "unknown",
      sourcePlatform: "xiaohongshu"
    }))
    .filter((item) => item.sourceUrl || item.title);
}

function updatePageHealth(tabUrl, pageStatus) {
  const isXhs = /xiaohongshu\.com|xhslink\.com/i.test(tabUrl);
  const looksCollection = pageStatus?.looksCollection || /collection|favorite|fav|likes|profile|收藏|小红书/i.test(tabUrl);
  elements.pageHealth.className = isXhs ? "page-health ok" : "page-health warn";
  if (!isXhs) {
    elements.pageHealth.textContent = "当前标签页不像小红书页面，请先打开你本人的小红书网页版收藏夹。";
    return;
  }
  if (pageStatus?.blocked) {
    elements.pageHealth.className = "page-health warn";
    elements.pageHealth.textContent = pageStatus.reason || "页面出现登录、验证码或访问限制，请先在浏览器里处理后再扫描。";
    return;
  }
  elements.pageHealth.textContent = looksCollection
    ? "已检测到小红书页面。请确认这是你本人已登录的收藏夹或相关页面。"
    : "已检测到小红书页面，但不一定是收藏夹。Beta 只会读取当前可见卡片。";
}

function renderResults() {
  const visibleItems = getVisibleItems();
  const selectedItems = getSelectedItems();
  const stats = computeStats(state.items);
  elements.count.textContent = `${selectedItems.length} / ${state.items.length} 条`;
  elements.importToWeb.disabled = selectedItems.length === 0;
  elements.exportJson.disabled = selectedItems.length === 0;
  elements.selectAll.disabled = visibleItems.length === 0;
  elements.clearSelection.disabled = state.items.length === 0;
  renderStats(stats);
  elements.list.innerHTML = "";

  if (state.items.length === 0) {
    elements.list.innerHTML = `<div class="result-card"><strong>暂无结果</strong><small>打开你本人的小红书收藏夹页面后再扫描。</small></div>`;
    updateScanButtons();
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleItems.slice(0, 160).forEach((item) => {
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
    link.textContent = item.sourceUrl || "缺少链接，导入后会进入待整理";
    card.querySelector("small").textContent = [item.author, item.noteType, item.visibleText ? item.visibleText.slice(0, 90) : "只保存可见文本，不复制原帖全文"].filter(Boolean).join(" · ");
    fragment.appendChild(card);
  });
  elements.list.appendChild(fragment);
  updateScanButtons();
}

function renderStats(stats) {
  const cells = [
    [stats.total, "已发现"],
    [stats.unique, "已去重"],
    [stats.missingTitles, "缺标题"],
    [stats.missingLinks, "缺链接"]
  ];
  elements.statsGrid.innerHTML = cells.map(([value, label]) => `<span><strong>${value}</strong><small>${label}</small></span>`).join("");
}

function computeStats(items) {
  const seen = new Set();
  items.forEach((item) => {
    const key = item.sourceUrl || item.title;
    if (key) seen.add(key);
  });
  return {
    total: items.length,
    unique: seen.size,
    missingTitles: items.filter((item) => !item.title).length,
    missingLinks: items.filter((item) => !item.sourceUrl).length
  };
}

function setAllSelected(selected) {
  const visibleKeys = getVisibleItems().map(itemKey);
  if (selected) visibleKeys.forEach((key) => state.selectedKeys.add(key));
  else visibleKeys.forEach((key) => state.selectedKeys.delete(key));
  renderResults();
}

function getVisibleItems() {
  if (!state.search) return state.items;
  return state.items.filter((item) => `${item.title} ${item.visibleText} ${item.author}`.toLowerCase().includes(state.search));
}

function getSelectedItems() {
  return state.items.filter((item) => state.selectedKeys.has(itemKey(item)));
}

function itemKey(item) {
  return `${item.sourceUrl || ""}|${item.title || ""}`;
}

function buildPayload() {
  return {
    source: "browser-extension-beta",
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
  chrome.downloads.download({ url, filename: `collection-revival-xhs-scan-${Date.now()}.json`, saveAs: true });
}

async function saveCheckpoint() {
  await chrome.storage.local.set({ [CHECKPOINT_KEY]: { items: state.items, selectedKeys: [...state.selectedKeys], pageUrl: state.pageUrl, savedAt: new Date().toISOString() } });
}

async function clearCheckpoint() {
  state.items = [];
  state.selectedKeys = new Set();
  state.pageUrl = "";
  await chrome.storage.local.remove(CHECKPOINT_KEY);
  renderResults();
  setStatus("已清空本地扫描断点");
}

function updateScanButtons() {
  elements.pauseScan.disabled = !state.scanning;
  elements.resumeScan.disabled = state.scanning || state.items.length === 0;
  elements.startScan.disabled = state.scanning;
  elements.scanVisible.disabled = state.scanning;
}

function normalizeWebAppUrl(value) {
  return (value || DEFAULT_WEB_APP_URL).trim().replace(/#.*$/, "");
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function setStatus(message) {
  elements.status.textContent = message;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}