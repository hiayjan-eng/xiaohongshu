(() => {
  const ids = [
    "statusBadge", "pageIdentity", "profileIdentity", "selectorVersion", "safetyMessage",
    "startScan", "pauseScan", "resumeScan", "stopScan", "restartScan", "progressMessage",
    "elapsedTime", "progressFill", "scrollProgress", "discoveredCount", "validCount",
    "existingCount", "missingLinkCount", "reviewCount", "resumeCount", "searchForm",
    "searchInput", "recentButton", "randomButton", "reviewSummary", "resultItems",
    "diagnosticsPanel", "diagnosticsButton", "exportDiagnostics", "diagnosticsOutput",
    "importButton", "importMessage"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  const BUILD_PROFILE = globalThis.__COLLECTION_REVIVAL_BUILD_PROFILE__ || {};
  const XHS_HOSTS = new Set(["xiaohongshu.com", "www.xiaohongshu.com"]);
  const FULL_SCAN_CONTENT_FILES = [
    "src/full-scan-core.js",
    "src/xhs-scanner.js",
    "src/full-scan-content.js"
  ];

  let activeTabId = null;
  let inspection = null;
  let session = null;
  let displayedItems = [];
  let elapsedTimer = null;
  let lastDiagnostics = null;

  elements.startScan.addEventListener("click", () => void control("M0_FULL_SCAN_START"));
  elements.pauseScan.addEventListener("click", () => void control("M0_FULL_SCAN_PAUSE"));
  elements.resumeScan.addEventListener("click", () => void control("M0_FULL_SCAN_RESUME"));
  elements.stopScan.addEventListener("click", () => void control("M0_FULL_SCAN_STOP"));
  elements.restartScan.addEventListener("click", () => void restart());
  elements.recentButton.addEventListener("click", () => void loadItems({ limit: 12 }));
  elements.randomButton.addEventListener("click", () => void loadItems({ limit: 50, random: true }));
  elements.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void loadItems({ limit: 50, query: elements.searchInput.value });
  });
  elements.diagnosticsButton.addEventListener("click", () => void refreshDiagnostics());
  elements.exportDiagnostics.addEventListener("click", () => void exportDiagnostics());
  elements.importButton.addEventListener("click", () => void openImportPreview());
  elements.resultItems.addEventListener("click", (event) => void openOriginalFromEvent(event));

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== "M0_FULL_SCAN_PROGRESS" || (sender?.tab?.id && sender.tab.id !== activeTabId)) return;
    const progress = message.progress || {};
    session = progress.session || session;
    if (progress.recentItems?.length) displayedItems = progress.recentItems.slice(-12).reverse();
    render(progress.runtime);
  });

  void initialize();

  async function initialize() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0] || null;
    activeTabId = activeTab?.id || null;
    if (!activeTabId) return showConnectionFailure("未找到当前活动标签页，无法建立内容脚本握手。");
    const connection = await establishContentConnection(activeTab);
    if (!connection.ok) return showConnectionFailure(connection.error);
    const pageResponse = connection.response;
    inspection = pageResponse?.inspection || null;
    if (!pageResponse?.ok || !inspection?.ok) {
      return showBoundaryFailure(inspection?.reason || pageResponse?.error || "无法确认收藏页。");
    }
    elements.pageIdentity.textContent = "已确认：收藏 → 笔记";
    elements.profileIdentity.textContent = `账号 •${inspection.identity.profileIdHash.slice(-4)}`;
    elements.selectorVersion.textContent = inspection.identity.selectorVersion;
    elements.safetyMessage.textContent = "已锁定可见收藏面板及真实滚动容器；本人发布与点赞面板不在扫描 root 内。";
    const stored = await sendRuntimeMessage({
      type: "M0_FULL_SCAN_GET_SESSION",
      favoritesPageIdentity: inspection.identity.favoritesPageIdentity
    });
    session = stored?.session || null;
    displayedItems = (stored?.recentItems || []).slice().reverse();
    render();
  }

  async function control(type) {
    if (!activeTabId) return;
    setControlsBusy(true);
    const response = await sendToTab({ type });
    setControlsBusy(false);
    if (!response?.ok) {
      elements.safetyMessage.textContent = response?.error || "操作失败。";
      return;
    }
    session = response.session || session;
    render();
  }

  async function restart() {
    if (!inspection?.identity || !activeTabId) return;
    setControlsBusy(true);
    await sendToTab({ type: "M0_FULL_SCAN_STOP" });
    const reset = await sendRuntimeMessage({ type: "M0_FULL_SCAN_RESET_SESSION", identity: inspection.identity });
    session = reset?.session || null;
    displayedItems = [];
    const started = await sendToTab({ type: "M0_FULL_SCAN_START" });
    session = started?.session || session;
    setControlsBusy(false);
    render();
  }

  async function loadItems(options) {
    if (!session?.sessionId) return;
    const response = await sendRuntimeMessage({
      type: "M0_FULL_SCAN_LIST_ITEMS",
      sessionId: session.sessionId,
      options
    });
    if (!response?.ok) {
      elements.reviewSummary.textContent = response?.error || "读取结果失败。";
      return;
    }
    displayedItems = response.items || [];
    elements.reviewSummary.textContent = options.random
      ? `随机抽查 ${displayedItems.length} 条；抽样顺序由当前 session 稳定生成。`
      : options.query
        ? `搜索到 ${formatNumber(response.totalMatched)} 条，当前显示前 ${displayedItems.length} 条。`
        : `最近显示 ${displayedItems.length} 条。`;
    renderItems();
  }

  async function refreshDiagnostics() {
    if (!session?.sessionId) return;
    const runtime = activeTabId ? await sendToTab({ type: "M0_FULL_SCAN_GET_RUNTIME_DIAGNOSTICS" }) : null;
    const database = await sendRuntimeMessage({ type: "M0_FULL_SCAN_GET_DIAGNOSTICS", sessionId: session.sessionId });
    lastDiagnostics = {
      generatedAt: new Date().toISOString(),
      extensionVersion: chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version,
      buildProfile: BUILD_PROFILE.id || "unknown",
      pageConfirmed: inspection?.ok === true,
      profileIdHash: inspection?.identity?.profileIdHash || "",
      pageIdentityHash: hashForDisplay(inspection?.identity?.favoritesPageIdentity || ""),
      pageDiagnostics: inspection?.diagnostics || null,
      runtime: sanitizeRuntime(runtime?.diagnostics),
      session: sanitizeSession(database?.diagnostics?.session || session),
      verification: sanitizeVerification(database?.diagnostics?.verification)
    };
    elements.diagnosticsOutput.textContent = JSON.stringify(lastDiagnostics, null, 2);
  }

  async function exportDiagnostics() {
    if (!lastDiagnostics) await refreshDiagnostics();
    if (!lastDiagnostics) return;
    const blob = new Blob([`${JSON.stringify(lastDiagnostics, null, 2)}\n`], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url,
      filename: `collection-revival-m0-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      saveAs: true
    });
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function openImportPreview() {
    if (session?.status !== "completed") return;
    elements.importButton.disabled = true;
    elements.importMessage.textContent = "正在创建本地导入批次…";
    const response = await sendRuntimeMessage({ type: "M0_PREVIEW_PREPARE_IMPORT", sessionId: session.sessionId });
    if (!response?.ok || !response.previewUrl) {
      elements.importMessage.textContent = response?.error || "无法打开 M0 Preview 导入页。";
      render();
      return;
    }
    await chrome.tabs.create({ url: response.previewUrl });
    elements.importMessage.textContent = "已打开 M0 Preview。请在目标页核对新增、已存在和待检查数量后确认导入。";
    render();
  }

  async function openOriginalFromEvent(event) {
    const button = event.target.closest?.("button[data-item-index]");
    if (!button) return;
    const item = displayedItems[Number(button.dataset.itemIndex)];
    const url = resolveOriginalUrl(item);
    if (!url) {
      elements.reviewSummary.textContent = "这条记录没有可确认的小红书原帖链接，已标记为待检查。";
      return;
    }
    await chrome.tabs.create({ url });
  }

  function render(runtime) {
    const status = session?.status || "ready";
    const labels = { ready: "准备", scanning: "扫描中", paused: "已暂停", needs_user: "需处理", completed: "扫描完成", stopped: "已停止" };
    elements.statusBadge.dataset.status = status;
    elements.statusBadge.textContent = labels[status] || status;
    elements.discoveredCount.textContent = formatNumber(session?.discoveredCount);
    elements.validCount.textContent = formatNumber(session?.validCount);
    elements.existingCount.textContent = formatNumber(session?.existingCount);
    elements.missingLinkCount.textContent = formatNumber(session?.missingLinkCount);
    elements.reviewCount.textContent = formatNumber(session?.reviewCount ?? session?.invalidCount);
    elements.resumeCount.textContent = formatNumber(session?.resumeCount);
    elements.progressMessage.textContent = sessionMessage(session);
    elements.selectorVersion.textContent = session?.selectorVersion || inspection?.identity?.selectorVersion || "—";
    const scrollHeight = Number(session?.lastScrollHeight) || 0;
    const scrollTop = Number(session?.lastScrollTop) || 0;
    const ratio = scrollHeight > 0 ? Math.min(100, Math.round((scrollTop / Math.max(1, scrollHeight - 1)) * 100)) : 0;
    elements.progressFill.style.width = status === "completed" ? "100%" : `${Math.max(3, ratio)}%`;
    elements.scrollProgress.textContent = scrollHeight
      ? `滚动位置：${formatNumber(scrollTop)} / ${formatNumber(scrollHeight)} · 稳定空轮 ${session?.stableNoGrowthCycles || 0}/5`
      : "滚动位置：—";
    renderItems();
    elements.startScan.disabled = !inspection?.ok || status === "scanning";
    elements.pauseScan.disabled = status !== "scanning";
    elements.resumeScan.disabled = !["paused", "needs_user", "stopped"].includes(status);
    elements.stopScan.disabled = !["scanning", "paused", "needs_user"].includes(status);
    elements.importButton.disabled = status !== "completed" || BUILD_PROFILE.id !== "m0-preview";
    if (runtime) elements.safetyMessage.textContent = `流式缓冲峰值 ${runtime.maxBufferedItems || 0} 条；Side Panel 最近项 ${runtime.recentItemCount || 0}/12；滚动模式 ${runtime.scrollMode || "unknown"}。`;
    updateElapsed();
  }

  function renderItems() {
    elements.resultItems.replaceChildren();
    if (!displayedItems.length) {
      const empty = document.createElement("li");
      empty.className = "empty-row";
      empty.textContent = "扫描后显示最近记录；全量数据保存在 Extension IndexedDB。";
      elements.resultItems.append(empty);
      return;
    }
    displayedItems.forEach((item, index) => {
      const row = document.createElement("li");
      const title = document.createElement("strong");
      const meta = document.createElement("span");
      const open = document.createElement("button");
      title.textContent = item.title || "标题待检查";
      meta.textContent = `${item.author || "作者未知"} · •${String(item.sourceId || "").slice(-6)}`;
      open.type = "button";
      open.dataset.itemIndex = String(index);
      open.textContent = "打开原帖";
      row.append(title, meta, open);
      elements.resultItems.append(row);
    });
  }

  function updateElapsed() {
    clearInterval(elapsedTimer);
    const startedAt = Date.parse(session?.startedAt || "");
    if (!Number.isFinite(startedAt)) return void (elements.elapsedTime.textContent = "00:00");
    const endedAt = session?.completedAt ? Date.parse(session.completedAt) : Date.now();
    const tick = () => {
      const seconds = Math.max(0, Math.floor(((session?.status === "completed" ? endedAt : Date.now()) - startedAt) / 1000));
      elements.elapsedTime.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    };
    tick();
    if (session?.status === "scanning") elapsedTimer = setInterval(tick, 1000);
  }

  function sessionMessage(value) {
    if (!value) return "等待开始";
    if (value.status === "completed") return `扫描完成：共发现 ${formatNumber(value.discoveredCount)} 条，有效 ${formatNumber(value.validCount)} 条。`;
    if (value.status === "needs_user") return value.lastErrorMessage || "已安全暂停，请处理当前页面后点击继续。";
    if (value.status === "paused") return `已暂停并保存 ${formatNumber(value.validCount)} 条。`;
    if (value.status === "stopped") return `已停止并保留 ${formatNumber(value.validCount)} 条进度。`;
    if (value.status === "scanning") return `正在自动滚动并流式保存，checkpoint ${formatNumber(value.itemsCheckpoint)}。`;
    return "准备扫描全部收藏";
  }

  function showBoundaryFailure(message) {
    inspection = { ok: false };
    elements.pageIdentity.textContent = "未确认收藏页";
    elements.profileIdentity.textContent = "未读取";
    elements.safetyMessage.textContent = `${message} 为避免导入本人发布内容，本次未开始扫描。请确认当前位于“我 → 收藏 → 笔记”。`;
    render();
  }

  function showConnectionFailure(message) {
    inspection = { ok: false };
    elements.pageIdentity.textContent = "扩展未连接";
    elements.profileIdentity.textContent = "握手未建立";
    elements.selectorVersion.textContent = "—";
    elements.safetyMessage.textContent = message;
    render();
  }

  async function establishContentConnection(tab) {
    const boundary = inspectSupportedTab(tab?.url);
    if (!boundary.ok) return boundary;
    const initial = await sendToTab({ type: "M0_FULL_SCAN_GET_PAGE_STATUS" });
    if (!initial?.error) return { ok: true, response: initial };
    if (!isMissingContentReceiver(initial.error)) {
      return { ok: false, error: `内容脚本握手失败：${initial.error}` };
    }
    if (!chrome.scripting?.executeScript) {
      return { ok: false, error: "内容脚本尚未连接，且当前浏览器不支持安全补注入。请刷新小红书标签页后重新打开 Side Panel。" };
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: FULL_SCAN_CONTENT_FILES
      });
    } catch (error) {
      return {
        ok: false,
        error: `内容脚本注入失败：${error instanceof Error ? error.message : String(error)}。请确认扩展已获准访问 xiaohongshu.com，然后刷新该标签页。`
      };
    }
    const retried = await sendToTab({ type: "M0_FULL_SCAN_GET_PAGE_STATUS" });
    if (retried?.error) {
      return {
        ok: false,
        error: `内容脚本已补注入，但握手仍失败：${retried.error}。请刷新该标签页后重新打开 Side Panel。`
      };
    }
    return { ok: true, response: retried };
  }

  function inspectSupportedTab(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !XHS_HOSTS.has(url.hostname.toLowerCase())) {
        return { ok: false, error: "当前活动标签不是受支持的小红书 HTTPS 页面，未执行内容脚本注入。" };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: "无法读取当前活动标签地址，未执行内容脚本注入。" };
    }
  }

  function isMissingContentReceiver(message) {
    return /receiving end does not exist|could not establish connection|message port closed/i.test(String(message || ""));
  }

  function resolveOriginalUrl(item) {
    for (const value of [item?.userCorrectedSourceUrl, item?.canonicalSourceUrl, item?.rawSourceUrl]) {
      try {
        const url = new URL(value);
        if (!["xiaohongshu.com", "www.xiaohongshu.com"].includes(url.hostname.toLowerCase())) continue;
        if (!/^\/(?:explore|discovery\/item|search_result)\/[a-zA-Z0-9_-]{6,80}(?:\/|$)/.test(url.pathname)) continue;
        return url.toString();
      } catch {
        // Try the next source URL.
      }
    }
    return "";
  }

  function sanitizeRuntime(value) { if (!value) return null; const { sessionId: _sessionId, ...safe } = value; return safe; }
  function sanitizeVerification(value) { if (!value) return null; const { sessionId: _sessionId, ...safe } = value; return safe; }
  function sanitizeSession(value) {
    if (!value) return null;
    return {
      status: value.status,
      startedAt: value.startedAt,
      completedAt: value.completedAt,
      updatedAt: value.updatedAt,
      discoveredCount: value.discoveredCount,
      validCount: value.validCount,
      existingCount: value.existingCount,
      invalidCount: value.invalidCount,
      missingLinkCount: value.missingLinkCount,
      reviewCount: value.reviewCount,
      duplicateCount: value.duplicateCount,
      duplicateInsertCount: value.duplicateInsertCount,
      resumeCount: value.resumeCount,
      stableNoGrowthCycles: value.stableNoGrowthCycles,
      selectorVersion: value.selectorVersion,
      extensionVersion: value.extensionVersion,
      lastErrorCode: value.lastErrorCode
    };
  }

  function setControlsBusy(busy) { for (const button of [elements.startScan, elements.pauseScan, elements.resumeScan, elements.stopScan]) button.disabled = busy; }
  function sendToTab(message) {
    return new Promise((resolve) => chrome.tabs.sendMessage(activeTabId, message, (response) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
      resolve(response || { ok: false, error: "内容脚本没有返回响应。" });
    }));
  }
  function sendRuntimeMessage(message) { return new Promise((resolve) => chrome.runtime.sendMessage(message, (response) => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : response))); }
  function hashForDisplay(value) { let hash = 2166136261; for (const character of String(value || "")) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, "0"); }
  function formatNumber(value) { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
})();
