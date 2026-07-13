const DEFAULT_WEB_APP_URL = "https://xiaohongshu-green.vercel.app/old-import";
const SETTINGS_KEY = "revival-extension-settings";
const CHECKPOINT_KEY = "revival-extension-checkpoint";
const SCAN_STATE_KEY = "revival-extension-scan-state";
const XHS_COLLECTION_URL = "https://www.xiaohongshu.com/explore";
const WEB_APP_ORIGINS = ["https://xiaohongshu-green.vercel.app", "http://localhost:5173", "http://127.0.0.1:5173"];
const STAGES = ["recognizing", "loading", "extracting", "deduping", "complete"];
const STAGE_LABELS = {
  recognizing: "识别页面",
  loading: "加载收藏",
  extracting: "提取卡片",
  deduping: "清理去重",
  complete: "扫描完成",
  paused: "已暂停",
  error: "扫描异常"
};

const state = {
  items: [],
  selectedKeys: new Set(),
  pageUrl: "",
  webAppUrl: DEFAULT_WEB_APP_URL,
  tabUrl: "",
  search: "",
  filter: "all",
  duplicateCount: 0,
  scanState: createEmptyScanState(),
  pageStatus: undefined,
  renderTimer: undefined,
  pollingTimer: undefined
};

const elements = {
  extensionVersion: document.querySelector("#extensionVersion"),
  webAppUrl: document.querySelector("#webAppUrl"),
  autoScrollToggle: document.querySelector("#autoScrollToggle"),
  scanVisible: document.querySelector("#scanVisible"),
  startScan: document.querySelector("#startScan"),
  pauseScan: document.querySelector("#pauseScan"),
  resumeScan: document.querySelector("#resumeScan"),
  retryScan: document.querySelector("#retryScan"),
  clearCheckpoint: document.querySelector("#clearCheckpoint"),
  openWeb: document.querySelector("#openWeb"),
  openCollection: document.querySelector("#openCollection"),
  redetectPage: document.querySelector("#redetectPage"),
  importToWeb: document.querySelector("#importToWeb"),
  exportJson: document.querySelector("#exportJson"),
  selectAll: document.querySelector("#selectAll"),
  clearSelection: document.querySelector("#clearSelection"),
  searchBox: document.querySelector("#searchBox"),
  filterSelect: document.querySelector("#filterSelect"),
  pageHealth: document.querySelector("#pageHealth"),
  pageType: document.querySelector("#pageType"),
  bridgeStatus: document.querySelector("#bridgeStatus"),
  scannerStatus: document.querySelector("#scannerStatus"),
  supportStatus: document.querySelector("#supportStatus"),
  status: document.querySelector("#status"),
  statsGrid: document.querySelector("#statsGrid"),
  count: document.querySelector("#count"),
  list: document.querySelector("#list"),
  progressTitle: document.querySelector("#progressTitle"),
  progressMode: document.querySelector("#progressMode"),
  progressTrack: document.querySelector("#progressTrack"),
  progressFill: document.querySelector("#progressFill"),
  progressPrimary: document.querySelector("#progressPrimary"),
  progressStage: document.querySelector("#progressStage"),
  stageSteps: document.querySelector("#stageSteps"),
  importSummary: document.querySelector("#importSummary"),
  skipSummary: document.querySelector("#skipSummary")
};

init();

async function init() {
  elements.extensionVersion.textContent = chrome.runtime.getManifest().version;
  const stored = await chrome.storage.local.get([SETTINGS_KEY, CHECKPOINT_KEY, SCAN_STATE_KEY]);
  state.webAppUrl = stored[SETTINGS_KEY]?.webAppUrl || DEFAULT_WEB_APP_URL;
  hydrateFromCheckpoint(stored[CHECKPOINT_KEY]);
  hydrateFromScanState(stored[SCAN_STATE_KEY]);

  elements.webAppUrl.value = state.webAppUrl;
  elements.webAppUrl.addEventListener("change", saveSettings);
  elements.scanVisible.addEventListener("click", scanVisibleCards);
  elements.startScan.addEventListener("click", startAutoScan);
  elements.pauseScan.addEventListener("click", pauseScan);
  elements.resumeScan.addEventListener("click", resumeScan);
  elements.retryScan.addEventListener("click", startAutoScan);
  elements.clearCheckpoint.addEventListener("click", clearCheckpoint);
  elements.openWeb.addEventListener("click", openOrRefreshWebApp);
  elements.openCollection.addEventListener("click", () => chrome.tabs.create({ url: XHS_COLLECTION_URL }));
  elements.redetectPage.addEventListener("click", refreshPageStatus);
  elements.importToWeb.addEventListener("click", importToWeb);
  elements.exportJson.addEventListener("click", exportJson);
  elements.selectAll.addEventListener("click", () => setAllSelected(true));
  elements.clearSelection.addEventListener("click", () => setAllSelected(false));
  elements.searchBox.addEventListener("input", () => {
    state.search = elements.searchBox.value.trim().toLowerCase();
    scheduleRender();
  });
  elements.filterSelect.addEventListener("change", () => {
    state.filter = elements.filterSelect.value;
    scheduleRender();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[SCAN_STATE_KEY]?.newValue) hydrateFromScanState(changes[SCAN_STATE_KEY].newValue);
    if (changes[CHECKPOINT_KEY]?.newValue) hydrateFromCheckpoint(changes[CHECKPOINT_KEY].newValue);
    scheduleRender();
  });

  await refreshPageStatus();
  startPolling();
  renderAll();
}

function createEmptyScanState() {
  return {
    status: "idle",
    stage: "recognizing",
    mode: "limit",
    limit: 200,
    batch: 0,
    lastAdded: 0,
    noNewRounds: 0,
    duplicateCount: 0,
    missingLinkCount: 0,
    missingTitleCount: 0,
    totalFound: 0,
    selectedCount: 0,
    message: "等待扫描",
    pageUrl: "",
    updatedAt: "",
    milestones: []
  };
}

function hydrateFromCheckpoint(checkpoint) {
  if (!checkpoint?.items?.length) return;
  state.items = normalizeItems(checkpoint.items);
  state.selectedKeys = new Set(checkpoint.selectedKeys || state.items.filter((item) => !item.isDuplicate).map(itemKey));
  state.duplicateCount = checkpoint.duplicateCount || 0;
  state.pageUrl = checkpoint.pageUrl || state.pageUrl || "";
}

function hydrateFromScanState(scanState) {
  if (!scanState) return;
  state.scanState = { ...createEmptyScanState(), ...scanState };
  if (Array.isArray(scanState.items)) {
    state.items = normalizeItems(scanState.items);
    state.selectedKeys = new Set(scanState.selectedKeys || state.items.filter((item) => !item.isDuplicate).map(itemKey));
    state.duplicateCount = scanState.duplicateCount || state.duplicateCount;
    state.pageUrl = scanState.pageUrl || state.pageUrl || "";
  }
}

async function saveSettings() {
  state.webAppUrl = elements.webAppUrl.value.trim() || DEFAULT_WEB_APP_URL;
  await chrome.storage.local.set({ [SETTINGS_KEY]: { webAppUrl: state.webAppUrl } });
}

function startPolling() {
  if (state.pollingTimer) clearInterval(state.pollingTimer);
  state.pollingTimer = setInterval(() => {
    void refreshScanStateFromCurrentTab(false);
  }, 650);
}

async function refreshPageStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabUrl = tab?.url || "";
  updateDiagnostics(state.tabUrl, { bridgeInjected: false, scannerInjected: false });
  updatePageHealth(state.tabUrl, undefined);
  if (!tab?.id || !/^https?:\/\//.test(state.tabUrl)) return;

  if (isWebAppUrl(state.tabUrl)) {
    let bridgeInjected = await detectPageFlag(tab.id, "__collectionRevivalWebBridgeInstalled");
    if (!bridgeInjected) {
      await ensureWebBridgeScript(tab.id);
      await wait(140);
      bridgeInjected = await detectPageFlag(tab.id, "__collectionRevivalWebBridgeInstalled");
    }
    updateDiagnostics(state.tabUrl, { bridgeInjected, scannerInjected: false });
    elements.pageHealth.className = bridgeInjected ? "page-health ok" : "page-health warn";
    elements.pageHealth.textContent = bridgeInjected
      ? "已检测到收藏复活网页连接脚本。切回网页时会自动同步扩展状态。"
      : "当前收藏复活网页还没有加载连接脚本。请刷新网页，或点击“打开或刷新收藏复活扫描页”。";
    return;
  }

  if (!isXhsUrl(state.tabUrl)) {
    updateDiagnostics(state.tabUrl, { bridgeInjected: false, scannerInjected: false });
    return;
  }

  try {
    await ensureScannerScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: "REVIVAL_GET_PAGE_STATUS" });
    const scannerInjected = await detectPageFlag(tab.id, "__collectionRevivalScannerInstalled");
    state.pageStatus = response;
    updateDiagnostics(state.tabUrl, { bridgeInjected: false, scannerInjected, pageStatus: response });
    updatePageHealth(state.tabUrl, response);
    await refreshScanStateFromCurrentTab(true);
  } catch {
    updateDiagnostics(state.tabUrl, { bridgeInjected: false, scannerInjected: false });
    updatePageHealth(state.tabUrl, undefined);
  }
  renderAll();
}

async function refreshScanStateFromCurrentTab(force) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isXhsUrl(tab.url || "")) {
    if (force) {
      const stored = await chrome.storage.local.get(SCAN_STATE_KEY);
      hydrateFromScanState(stored[SCAN_STATE_KEY]);
      renderAll();
    }
    return;
  }
  try {
    await ensureScannerScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: "REVIVAL_GET_SCAN_STATE" });
    if (response?.ok && response.scanState) {
      hydrateFromScanState(response.scanState);
      scheduleRender();
    }
  } catch {
    if (force) {
      const stored = await chrome.storage.local.get(SCAN_STATE_KEY);
      hydrateFromScanState(stored[SCAN_STATE_KEY]);
      renderAll();
    }
  }
}

async function scanVisibleCards() {
  setStatus("正在扫描当前已加载卡片...");
  try {
    const response = await sendScannerMessage({ type: "REVIVAL_SCAN_VISIBLE" });
    if (!response?.ok) throw new Error(response?.error || "扫描失败");
    hydrateFromScanState(response.scanState);
    setStatus(response.scanState?.message || "已扫描当前可见卡片。");
    renderAll();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "扫描失败");
  }
}

async function startAutoScan() {
  try {
    const limitValue = document.querySelector("input[name='scanLimit']:checked")?.value || "200";
    const limit = limitValue === "all" ? null : Number(limitValue);
    const response = await sendScannerMessage({
      type: "REVIVAL_START_SCAN",
      limit,
      mode: limit ? "limit" : "all",
      autoScroll: Boolean(elements.autoScrollToggle.checked)
    });
    if (!response?.ok) throw new Error(response?.error || "无法开始扫描");
    hydrateFromScanState(response.scanState);
    setStatus(response.scanState?.message || "正在扫描旧收藏...");
    renderAll();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "扫描失败");
  }
}

async function pauseScan() {
  try {
    const response = await sendScannerMessage({ type: "REVIVAL_PAUSE_SCAN" });
    if (response?.scanState) hydrateFromScanState(response.scanState);
    setStatus("已暂停，当前数量和选择会保留。");
    renderAll();
  } catch {
    setStatus("暂停失败，可以保留当前结果后重试。");
  }
}

async function resumeScan() {
  try {
    const response = await sendScannerMessage({ type: "REVIVAL_RESUME_SCAN" });
    if (!response?.ok) throw new Error(response?.error || "无法继续扫描");
    hydrateFromScanState(response.scanState);
    setStatus(response.scanState?.message || "已继续扫描。");
    renderAll();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "继续失败");
  }
}

async function sendScannerMessage(message) {
  await saveSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("没有找到当前标签页");
  if (!/^https?:\/\//.test(tab.url || "")) throw new Error("请在小红书网页版页面中使用这个扩展");
  state.tabUrl = tab.url || "";
  updatePageHealth(state.tabUrl, undefined);
  if (!isXhsUrl(state.tabUrl)) throw new Error("请在小红书网页版页面中使用这个扩展");
  await ensureScannerScript(tab.id);
  return chrome.tabs.sendMessage(tab.id, message);
}

async function ensureScannerScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "REVIVAL_PING" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/xhs-scanner.js"] });
  }
}

async function ensureWebBridgeScript(tabId) {
  try {
    const injected = await detectPageFlag(tabId, "__collectionRevivalWebBridgeInstalled");
    if (injected) return;
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/web-bridge.js"] });
  } catch {
    // The popup diagnosis will show that the Web Bridge was not injected.
  }
}

async function detectPageFlag(tabId, flagName) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name) => Boolean(window[name]),
      args: [flagName]
    });
    return Boolean(result?.result);
  } catch {
    return false;
  }
}

async function openOrRefreshWebApp() {
  const targetUrl = normalizeWebAppUrl(state.webAppUrl || DEFAULT_WEB_APP_URL);
  const queryUrls = WEB_APP_ORIGINS.map((origin) => `${origin}/old-import*`);
  const tabs = await chrome.tabs.query({ url: queryUrls });
  const existing = tabs[0];
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true, url: targetUrl });
    await chrome.tabs.reload(existing.id);
    await wait(600);
    await ensureWebBridgeScript(existing.id);
    setStatus("已切换到收藏复活扫描页，并尝试恢复连接。");
    return;
  }
  await chrome.tabs.create({ url: targetUrl });
}

function updateDiagnostics(tabUrl, result) {
  const pageType = isWebAppUrl(tabUrl) ? "收藏复活 Web" : isXhsUrl(tabUrl) ? "小红书页面" : "其他页面";
  elements.pageType.textContent = pageType;
  elements.bridgeStatus.textContent = result.bridgeInjected ? "已注入" : isWebAppUrl(tabUrl) ? "未注入，刷新网页" : "不适用";
  elements.scannerStatus.textContent = result.scannerInjected ? "已注入" : isXhsUrl(tabUrl) ? "未注入，重新检测" : "不适用";
  elements.supportStatus.textContent = isXhsUrl(tabUrl)
    ? result.pageStatus?.blocked
      ? "页面受限，已停止"
      : result.pageStatus?.activeTab === "收藏"
        ? "已识别收藏页"
        : "疑似收藏页，需要确认"
    : isWebAppUrl(tabUrl)
      ? "可检测扩展连接"
      : "不支持扫描";
}

function updatePageHealth(tabUrl, pageStatus) {
  const isXhs = isXhsUrl(tabUrl);
  elements.openCollection.classList.toggle("hidden", isXhs);
  elements.startScan.classList.toggle("hidden", !isXhs);
  elements.scanVisible.classList.toggle("hidden", !isXhs);

  if (!isXhs) {
    elements.pageHealth.className = "page-health warn";
    elements.pageHealth.textContent = isWebAppUrl(tabUrl)
      ? "当前是收藏复活网页。要扫描旧收藏，请切到你本人小红书收藏页；要检测连接，可以回到网页点击检测。"
      : "当前标签页不是小红书收藏页。请先打开你本人的小红书网页版收藏页。";
    return;
  }
  if (pageStatus?.blocked) {
    elements.pageHealth.className = "page-health warn";
    elements.pageHealth.textContent = pageStatus.reason || "页面出现登录、验证码或访问限制，请先在浏览器里处理后再扫描。";
    return;
  }
  const activeText = pageStatus?.activeTab ? `当前标签：${pageStatus.activeTab}。` : "";
  elements.pageHealth.className = pageStatus?.looksCollection ? "page-health ok" : "page-health warn";
  elements.pageHealth.textContent = pageStatus?.looksCollection
    ? `${activeText}已识别本人收藏页或疑似收藏页，可以开始扫描当前可见收藏。`
    : `${activeText}已检测到小红书页面，但还不能确认是收藏页。请先切到“收藏”标签。`;
}

function normalizeItems(items) {
  return (items || [])
    .map((item) => ({
      title: normalizeText(item.title || ""),
      sourceUrl: (item.sourceUrl || "").trim(),
      coverUrl: item.coverUrl || undefined,
      visibleText: normalizeText(item.visibleText || ""),
      rawText: item.rawText,
      author: normalizeText(item.author || "") || undefined,
      noteType: item.noteType || "unknown",
      sourcePlatform: "xiaohongshu",
      isDuplicate: Boolean(item.isDuplicate),
      isMissingTitle: Boolean(item.isMissingTitle || !normalizeText(item.title || "")),
      isMissingLink: Boolean(item.isMissingLink || !item.sourceUrl),
      isLikelyOwnPost: Boolean(item.isLikelyOwnPost),
      containerType: item.containerType,
      activeTab: item.activeTab,
      selectorVersion: item.selectorVersion
    }))
    .filter((item) => item.sourceUrl || item.title || item.visibleText);
}

function scheduleRender() {
  if (state.renderTimer) return;
  state.renderTimer = setTimeout(() => {
    state.renderTimer = undefined;
    renderAll();
  }, 120);
}

function renderAll() {
  renderProgress();
  renderResults();
  updateScanButtons();
}

function renderProgress() {
  const scan = state.scanState;
  const total = state.items.length || scan.totalFound || 0;
  const selected = getSelectedItems().length;
  const isRunning = scan.status === "scanning";
  const isPaused = scan.status === "paused";
  const isComplete = scan.status === "completed";
  const isAllMode = scan.mode === "all" || !scan.limit;
  const percent = isAllMode
    ? isComplete ? 100 : 0
    : Math.max(0, Math.min(100, Math.round((total / Math.max(1, scan.limit || 1)) * 100)));

  elements.progressTitle.textContent = scan.message || (isRunning ? "正在扫描旧收藏" : "等待扫描");
  elements.progressMode.textContent = isAllMode ? "尽可能扫描全部" : `${scan.limit || 200} 条上限`;
  elements.progressTrack.classList.toggle("indeterminate", isAllMode && isRunning);
  elements.progressTrack.classList.toggle("paused", isPaused);
  elements.progressFill.style.width = isAllMode && isRunning ? "" : `${percent}%`;
  elements.progressPrimary.textContent = isAllMode
    ? `已发现 ${total} 条 · 第 ${scan.batch || 0} 批`
    : `${Math.min(total, scan.limit || total)} / ${scan.limit || 200} 条`;
  elements.progressStage.textContent = STAGE_LABELS[scan.stage] || STAGE_LABELS[scan.status] || "等待扫描";
  elements.status.textContent = scan.status === "error" ? (scan.error || scan.message || "扫描异常") : (scan.message || elements.status.textContent);

  const currentIndex = Math.max(0, STAGES.indexOf(scan.stage));
  elements.stageSteps.querySelectorAll("span").forEach((node) => {
    const stage = node.dataset.stage;
    const index = STAGES.indexOf(stage);
    node.classList.toggle("done", isComplete || index < currentIndex);
    node.classList.toggle("active", stage === scan.stage && !isComplete);
  });
  renderStats(computeStats(state.items));
  elements.importSummary.textContent = `将导入 ${selected} 条`;
  elements.skipSummary.textContent = `跳过 ${state.duplicateCount || scan.duplicateCount || 0} 条重复内容`;
}

function renderResults() {
  const visibleItems = getVisibleItems();
  const selectedItems = getSelectedItems();
  elements.count.textContent = `${selectedItems.length} / ${state.items.length} 条`;
  elements.importToWeb.disabled = selectedItems.length === 0;
  elements.exportJson.disabled = selectedItems.length === 0;
  elements.selectAll.disabled = visibleItems.length === 0;
  elements.clearSelection.disabled = visibleItems.length === 0;
  elements.list.innerHTML = "";

  if (state.items.length === 0) {
    elements.list.innerHTML = `<div class="result-card"><strong>暂无结果</strong><small>打开你本人的小红书收藏夹页面后，点击上面的“开始扫描旧收藏”。</small></div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleItems.slice(0, 120).forEach((item) => {
    const key = itemKey(item);
    const card = document.createElement("article");
    card.className = `result-card ${item.isDuplicate ? "duplicate" : ""}`;
    const shortUrl = formatShortUrl(item.sourceUrl);
    card.innerHTML = `
      <label class="result-main">
        <input type="checkbox" />
        <span>
          <strong class="result-title"></strong>
          <span class="result-meta"></span>
          <small></small>
        </span>
      </label>
    `;
    const checkbox = card.querySelector("input");
    checkbox.checked = state.selectedKeys.has(key);
    checkbox.disabled = item.isDuplicate;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedKeys.add(key);
      else state.selectedKeys.delete(key);
      void saveSelection();
      renderAll();
    });
    card.querySelector(".result-title").textContent = item.title || "标题待补充";
    const meta = card.querySelector(".result-meta");
    meta.appendChild(createPill(item.author || "作者未知"));
    meta.appendChild(createPill(item.noteType || "类型未知"));
    if (shortUrl) meta.appendChild(createPill(shortUrl));
    if (item.isDuplicate) meta.appendChild(createPill("重复", "warn"));
    if (item.isMissingLink) meta.appendChild(createPill("无链接", "warn"));
    if (item.isLikelyOwnPost) meta.appendChild(createPill("疑似本人发布", "warn"));
    const small = card.querySelector("small");
    small.textContent = item.visibleText || "只保存可见短文本，不复制原帖全文";
    if (item.sourceUrl) {
      const copy = document.createElement("button");
      copy.className = "copy-link";
      copy.textContent = "复制链接";
      copy.addEventListener("click", () => navigator.clipboard?.writeText(item.sourceUrl));
      card.appendChild(copy);
    }
    fragment.appendChild(card);
  });
  if (visibleItems.length > 120) {
    const more = document.createElement("article");
    more.className = "result-card";
    more.innerHTML = `<strong>还有 ${visibleItems.length - 120} 条未在 popup 展示</strong><small>大量结果建议导入后在 Web 大页面里整理，popup 只渲染前 120 条以保持流畅。</small>`;
    fragment.appendChild(more);
  }
  elements.list.appendChild(fragment);
}

function createPill(text, tone) {
  const pill = document.createElement("span");
  pill.className = tone ? `pill ${tone}` : "pill";
  pill.textContent = text;
  return pill;
}

function renderStats(stats) {
  const cells = [
    [stats.total, "已发现"],
    [state.scanState.lastAdded || 0, "本轮新增"],
    [stats.duplicates, "重复"],
    [stats.missingLinks, "缺链接"],
    [stats.pendingImport, "待导入"]
  ];
  elements.statsGrid.innerHTML = cells.map(([value, label]) => `<span><strong>${value}</strong><small>${label}</small></span>`).join("");
}

function computeStats(items) {
  return {
    total: items.length,
    withLinks: items.filter((item) => item.sourceUrl).length,
    missingTitles: items.filter((item) => item.isMissingTitle || !item.title).length,
    missingLinks: items.filter((item) => item.isMissingLink || !item.sourceUrl).length,
    duplicates: state.duplicateCount || items.filter((item) => item.isDuplicate).length,
    pendingImport: getSelectedItems().length
  };
}

async function setAllSelected(selected) {
  const visibleKeys = getVisibleItems().filter((item) => !item.isDuplicate).map(itemKey);
  if (selected) visibleKeys.forEach((key) => state.selectedKeys.add(key));
  else visibleKeys.forEach((key) => state.selectedKeys.delete(key));
  await saveSelection();
  renderAll();
}

function getVisibleItems() {
  return state.items.filter((item) => {
    if (state.search && !`${item.title} ${item.visibleText} ${item.author}`.toLowerCase().includes(state.search)) return false;
    if (state.filter === "selected") return state.selectedKeys.has(itemKey(item));
    if (state.filter === "duplicate") return item.isDuplicate;
    if (state.filter === "missing-title") return item.isMissingTitle || !item.title;
    if (state.filter === "own") return item.isLikelyOwnPost;
    if (state.filter === "missing-link") return item.isMissingLink || !item.sourceUrl;
    return true;
  });
}

function getSelectedItems() {
  return state.items.filter((item) => state.selectedKeys.has(itemKey(item)) && !item.isDuplicate);
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
    scanSummary: {
      version: chrome.runtime.getManifest().version,
      totalFound: state.items.length,
      duplicateCount: state.duplicateCount || state.scanState.duplicateCount || 0,
      scanMode: state.scanState.mode,
      scanLimit: state.scanState.limit,
      selectorVersion: "xhs-fav-container-v2"
    },
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

async function saveSelection() {
  const stored = await chrome.storage.local.get([CHECKPOINT_KEY, SCAN_STATE_KEY]);
  const checkpoint = {
    ...(stored[CHECKPOINT_KEY] || {}),
    items: state.items,
    selectedKeys: [...state.selectedKeys],
    duplicateCount: state.duplicateCount,
    pageUrl: state.pageUrl,
    savedAt: new Date().toISOString()
  };
  const scanState = {
    ...(stored[SCAN_STATE_KEY] || state.scanState),
    selectedKeys: [...state.selectedKeys],
    selectedCount: state.selectedKeys.size
  };
  await chrome.storage.local.set({ [CHECKPOINT_KEY]: checkpoint, [SCAN_STATE_KEY]: scanState });
}

async function clearCheckpoint() {
  state.items = [];
  state.selectedKeys = new Set();
  state.pageUrl = "";
  state.duplicateCount = 0;
  state.scanState = createEmptyScanState();
  await chrome.storage.local.remove([CHECKPOINT_KEY, SCAN_STATE_KEY]);
  try {
    await sendScannerMessage({ type: "REVIVAL_CLEAR_SCAN_STATE" });
  } catch {
    // It is fine if the current tab is not Xiaohongshu.
  }
  renderAll();
  setStatus("已清空本地扫描断点");
}

function updateScanButtons() {
  const status = state.scanState.status;
  const isScanning = status === "scanning";
  const isPaused = status === "paused";
  const canResume = isPaused || (state.items.length > 0 && status !== "scanning");
  elements.pauseScan.disabled = !isScanning;
  elements.resumeScan.disabled = !canResume || isScanning;
  elements.retryScan.disabled = isScanning;
  elements.startScan.disabled = isScanning || !isXhsUrl(state.tabUrl);
  elements.scanVisible.disabled = isScanning || !isXhsUrl(state.tabUrl);
}

function normalizeWebAppUrl(value) {
  return (value || DEFAULT_WEB_APP_URL).trim().replace(/#.*$/, "");
}

function formatShortUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    return `${url.hostname}/${parts.slice(0, 2).join("/")}`;
  } catch {
    return "";
  }
}

function normalizeText(value) {
  return (value || "").normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200C\uFEFF\u00AD]/g, "").replace(/\s+/g, " ").trim();
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

function isWebAppUrl(value) {
  return WEB_APP_ORIGINS.some((origin) => (value || "").startsWith(origin));
}

function isXhsUrl(value) {
  return /https:\/\/(www\.)?xiaohongshu\.com\//i.test(value || "");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
