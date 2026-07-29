(() => {
  const elements = Object.fromEntries(
    [
      "statusBadge",
      "pageIdentity",
      "profileIdentity",
      "safetyMessage",
      "startScan",
      "pauseScan",
      "resumeScan",
      "stopScan",
      "restartScan",
      "progressMessage",
      "elapsedTime",
      "progressFill",
      "scrollProgress",
      "discoveredCount",
      "validCount",
      "existingCount",
      "invalidCount",
      "recentItems",
      "diagnosticsButton",
      "diagnosticsPanel",
      "diagnosticsOutput"
    ].map((id) => [id, document.getElementById(id)])
  );

  let activeTabId = null;
  let inspection = null;
  let session = null;
  let recentItems = [];
  let elapsedTimer = null;

  elements.startScan.addEventListener("click", () => void control("M0_FULL_SCAN_START"));
  elements.pauseScan.addEventListener("click", () => void control("M0_FULL_SCAN_PAUSE"));
  elements.resumeScan.addEventListener("click", () => void control("M0_FULL_SCAN_RESUME"));
  elements.stopScan.addEventListener("click", () => void control("M0_FULL_SCAN_STOP"));
  elements.restartScan.addEventListener("click", () => void restart());
  elements.diagnosticsButton.addEventListener("click", () => {
    elements.diagnosticsPanel.open = true;
    void refreshDiagnostics();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "M0_FULL_SCAN_PROGRESS") return;
    const progress = message.progress || {};
    session = progress.session || session;
    recentItems = progress.recentItems || recentItems;
    render(progress.runtime);
  });

  void initialize();

  async function initialize() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tabs[0]?.id || null;
    if (!activeTabId) {
      showBoundaryFailure("未找到当前活动标签页。");
      return;
    }
    const pageResponse = await sendToTab({ type: "M0_FULL_SCAN_GET_PAGE_STATUS" });
    inspection = pageResponse?.inspection || null;
    if (!pageResponse?.ok || !inspection?.ok) {
      showBoundaryFailure(inspection?.reason || pageResponse?.error || "无法确认收藏页。");
      return;
    }
    elements.pageIdentity.textContent = "已确认收藏 → 笔记";
    elements.profileIdentity.textContent = `账号 …${inspection.identity.profileIdHash.slice(-4)}`;
    elements.safetyMessage.textContent = "已锁定收藏面板及其滚动容器，本人笔记面板不在扫描 root 内。";
    const stored = await sendRuntimeMessage({
      type: "M0_FULL_SCAN_GET_SESSION",
      favoritesPageIdentity: inspection.identity.favoritesPageIdentity
    });
    session = stored?.session || null;
    recentItems = stored?.recentItems || [];
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
    const reset = await sendRuntimeMessage({
      type: "M0_FULL_SCAN_RESET_SESSION",
      identity: inspection.identity
    });
    session = reset?.session || null;
    recentItems = [];
    const started = await sendToTab({ type: "M0_FULL_SCAN_START" });
    session = started?.session || session;
    setControlsBusy(false);
    render();
  }

  async function refreshDiagnostics() {
    const runtime = activeTabId
      ? await sendToTab({ type: "M0_FULL_SCAN_GET_RUNTIME_DIAGNOSTICS" })
      : null;
    const database = session?.sessionId
      ? await sendRuntimeMessage({ type: "M0_FULL_SCAN_GET_DIAGNOSTICS", sessionId: session.sessionId })
      : null;
    elements.diagnosticsOutput.textContent = JSON.stringify(
      {
        pageConfirmed: inspection?.ok === true,
        profileIdHash: inspection?.identity?.profileIdHash || "",
        pageIdentityHash: inspection?.identity?.favoritesPageIdentity
          ? hashForDisplay(inspection.identity.favoritesPageIdentity)
          : "",
        pageDiagnostics: inspection?.diagnostics || null,
        runtime: runtime?.diagnostics || null,
        session: sanitizeSession(database?.diagnostics?.session || session),
        verification: database?.diagnostics?.verification || null
      },
      null,
      2
    );
  }

  function render(runtime) {
    const status = session?.status || "ready";
    const statusLabels = {
      ready: "准备",
      scanning: "扫描中",
      paused: "暂停",
      needs_user: "需用户处理",
      completed: "完成",
      stopped: "已停止"
    };
    elements.statusBadge.dataset.status = status;
    elements.statusBadge.textContent = statusLabels[status] || status;
    elements.discoveredCount.textContent = formatNumber(session?.discoveredCount);
    elements.validCount.textContent = formatNumber(session?.validCount);
    elements.existingCount.textContent = formatNumber(session?.existingCount);
    elements.invalidCount.textContent = formatNumber(session?.invalidCount);
    elements.progressMessage.textContent = sessionMessage(session);
    const scrollHeight = Number(session?.lastScrollHeight) || 0;
    const scrollTop = Number(session?.lastScrollTop) || 0;
    const ratio = scrollHeight > 0 ? Math.min(100, Math.round((scrollTop / scrollHeight) * 100)) : 0;
    elements.progressFill.style.width = status === "completed" ? "100%" : `${Math.max(3, ratio)}%`;
    elements.scrollProgress.textContent = scrollHeight
      ? `滚动位置：${formatNumber(scrollTop)} / ${formatNumber(scrollHeight)} · 稳定空轮 ${session?.stableNoGrowthCycles || 0}/5`
      : "滚动位置：—";
    renderRecentItems();
    elements.startScan.disabled = !inspection?.ok || status === "scanning";
    elements.pauseScan.disabled = status !== "scanning";
    elements.resumeScan.disabled = !["paused", "needs_user", "stopped"].includes(status);
    elements.stopScan.disabled = !["scanning", "paused", "needs_user"].includes(status);
    if (runtime) {
      elements.safetyMessage.textContent =
        `流式缓冲峰值 ${runtime.maxBufferedItems || 0} 条，Side Panel 最近项 ${runtime.recentItemCount || 0}/12。`;
    }
    updateElapsed();
  }

  function renderRecentItems() {
    elements.recentItems.replaceChildren();
    if (!recentItems.length) {
      const empty = document.createElement("li");
      empty.className = "empty-row";
      empty.textContent = "扫描后只在这里保留最近 12 条。";
      elements.recentItems.append(empty);
      return;
    }
    for (const item of recentItems.slice(-12).reverse()) {
      const row = document.createElement("li");
      const title = document.createElement("strong");
      const meta = document.createElement("span");
      title.textContent = item.title || "标题待补充";
      meta.textContent = `${item.author || "作者未知"} · …${String(item.sourceId || "").slice(-6)}`;
      row.append(title, meta);
      elements.recentItems.append(row);
    }
  }

  function updateElapsed() {
    clearInterval(elapsedTimer);
    const startedAt = Date.parse(session?.startedAt || "");
    if (!Number.isFinite(startedAt)) {
      elements.elapsedTime.textContent = "00:00";
      return;
    }
    const tick = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      elements.elapsedTime.textContent =
        `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    };
    tick();
    if (session?.status === "scanning") elapsedTimer = setInterval(tick, 1000);
  }

  function sessionMessage(value) {
    if (!value) return "等待开始";
    if (value.status === "completed") return `本次扫描完成，共发现 ${formatNumber(value.discoveredCount)} 条`;
    if (value.status === "needs_user") return value.lastErrorMessage || "需要用户处理当前页面";
    if (value.status === "paused") return `已安全暂停，已保存 ${formatNumber(value.validCount)} 条`;
    if (value.status === "stopped") return `已停止并保留 ${formatNumber(value.validCount)} 条进度`;
    if (value.status === "scanning") return `正在自动加载并保存，第 ${formatNumber(value.itemsCheckpoint)} 条 checkpoint`;
    return "准备扫描全部可访问收藏";
  }

  function showBoundaryFailure(message) {
    inspection = { ok: false };
    elements.pageIdentity.textContent = "未确认收藏页";
    elements.profileIdentity.textContent = "未读取";
    elements.safetyMessage.textContent = `${message} 为避免导入本人发布内容，本次未开始扫描。`;
    render();
  }

  function setControlsBusy(busy) {
    for (const button of [elements.startScan, elements.pauseScan, elements.resumeScan, elements.stopScan]) {
      button.disabled = busy;
    }
  }

  function sendToTab(message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(activeTabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    });
  }

  function sanitizeSession(value) {
    if (!value) return null;
    return {
      ...value,
      sessionId: hashForDisplay(value.sessionId),
      importBatchId: hashForDisplay(value.importBatchId),
      favoritesPageIdentity: hashForDisplay(value.favoritesPageIdentity),
      lastSourceId: value.lastSourceId ? `…${String(value.lastSourceId).slice(-6)}` : ""
    };
  }

  function hashForDisplay(value) {
    let hash = 2166136261;
    for (const character of String(value || "")) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
  }
})();
