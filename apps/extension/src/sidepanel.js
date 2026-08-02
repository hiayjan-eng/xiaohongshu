(() => {
  const $ = (id) => document.getElementById(id);
  const state = { run: null, startedAt: 0 };
  const els = Object.fromEntries(["statusBadge", "statusMessage", "detectApi", "refreshProbe", "progressMessage", "elapsedTime", "progressFill", "probeSummary", "favoriteCount", "albumCount", "membershipCount", "pageCount", "runStatus", "endpointCount", "startRead", "confirmImport", "discardRun", "resultSummary", "probeOutput"].map((id) => [id, $(id)]));
  els.detectApi.addEventListener("click", () => void detect());
  els.refreshProbe.addEventListener("click", () => void refresh());
  els.startRead.addEventListener("click", () => void read());
  els.confirmImport.addEventListener("click", () => void confirm());
  els.discardRun.addEventListener("click", () => void discard());
  chrome.runtime.onMessage.addListener((message) => { if (message?.type === "M0_API_PROBE_UPDATED") void refresh({ passive: true }); });
  setInterval(render, 500); void refresh();
  async function message(value) { return chrome.runtime.sendMessage(value); }
  async function detect() {
    els.detectApi.disabled = true;
    els.statusBadge.textContent = "正在检测";
    els.statusMessage.textContent = "正在创建探测会话。";
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = tab?.id ? await chrome.tabs.sendMessage(tab.id, { type: "M0_API_PROBE_START" }).catch(() => null) : null;
    if (!response?.ok) { els.statusMessage.textContent = "请在已登录的小红书收藏或专辑详情页打开侧边栏。"; els.detectApi.disabled = false; return; }
    els.statusMessage.textContent = "正在检测；MAIN 探测器会在刷新后的 document_start 自动加载。";
    try { await chrome.tabs.reload(tab.id); } catch (error) { els.statusMessage.textContent = error instanceof Error ? error.message : "自动刷新失败"; }
    els.detectApi.disabled = false;
  }
  async function refresh({ passive = false } = {}) {
    if (!passive) { els.refreshProbe.disabled = true; els.statusMessage.textContent = "正在刷新结果。"; }
    try {
      const response = await message({ type: "M0_API_PROBE_GET" });
      if (!response?.ok) throw new Error(response?.error || "无法读取探测会话");
      renderProbes(response.probes || [], response.session);
    } catch (error) { els.statusMessage.textContent = error instanceof Error ? `刷新失败：${error.message}` : "刷新失败"; }
    finally { if (!passive) els.refreshProbe.disabled = false; }
  }
  async function read() { const created = await message({ type: "M0_API_SYNC_CREATE_RUN" }); if (!created?.ok) return showError(created?.error); state.run = created.run; state.startedAt = Date.now(); render(); const response = await message({ type: "M0_API_SYNC_READ", runId: state.run.runId }); if (!response?.ok) { els.statusMessage.textContent = response?.error || "读取未开始。"; els.progressMessage.textContent = "等待可确认的页面原生调用能力"; } }
  async function confirm() { const response = await message({ type: "M0_API_SYNC_CONFIRM", runId: state.run?.runId }); if (!response?.ok) return showError(response?.error); state.run = response.run; render(); }
  async function discard() { const response = await message({ type: "M0_API_SYNC_DISCARD", runId: state.run?.runId }); if (!response?.ok) return showError(response?.error); state.run = response.run; render(); }
  function renderProbes(probes, session = { status: "inactive", mainReady: false, bridgeReady: false, active: false, updatedAt: "" }) {
    const favorites = probes.filter((probe) => probe.kind === "favorites");
    const albums = probes.filter((probe) => probe.kind === "albums");
    const content = probes.filter((probe) => probe.kind === "albumContent");
    const relations = content.map((probe) => probe.relation || {}).filter((relation) => relation.source === "album-content-derived");
    const derivedCount = relations.reduce((max, relation) => Math.max(max, Number(relation.derivedCount) || 0), 0);
    const albumPaths = [...new Set(relations.map((relation) => relation.albumIdPath).filter(Boolean))];
    const notePaths = [...new Set(relations.flatMap((relation) => relation.noteIdPaths || []))];
    const signed = probes.some((probe) => probe.needsDynamicSignature);
    els.endpointCount.textContent = String(probes.length);
    els.probeOutput.textContent = JSON.stringify(probes, null, 2);
    const handshake = `MAIN：${session.mainReady ? "已就绪" : "未存活"}；bridge：${session.bridgeReady ? "已连接" : "未连接"}；session：${session.active ? "active" : "inactive"}`;
    els.probeSummary.textContent = `收藏分页候选：${favorites.length}；专辑列表候选：${albums.length}；专辑内容候选：${content.length}；关系来源：${relations.length ? "专辑内容推导" : "未识别"}；已推导关系：${derivedCount}；albumId 字段：${albumPaths.join("、") || "—"}；noteId 字段：${notePaths.join("、") || "—"}；动态签名：${signed ? "需要" : "未发现"}。${handshake}。`;
    const updated = session.updatedAt ? new Date(session.updatedAt).toLocaleTimeString() : "—";
    if (!session.active) els.statusMessage.textContent = `探测会话未激活；更新时间：${updated}。`;
    else if (!session.bridgeReady) els.statusMessage.textContent = `bridge 未连接；更新时间：${updated}。`;
    else if (!session.mainReady) els.statusMessage.textContent = `探测器未存活；更新时间：${updated}。`;
    else if (!probes.length) els.statusMessage.textContent = `探测器存活，但尚未捕获请求；更新时间：${updated}。`;
    else els.statusMessage.textContent = `已刷新结果：${probes.length} 个候选；更新时间：${updated}。`;
    els.statusBadge.textContent = probes.length ? "已捕获" : session.active ? "正在检测" : "待检测";
  }
  function render() { const run = state.run; if (!run) return; const progress = run.progress || {}; els.favoriteCount.textContent = String(progress.favoriteCount || 0); els.albumCount.textContent = String(progress.albumCount || 0); els.membershipCount.textContent = String(progress.membershipCount || 0); els.pageCount.textContent = String(progress.pageCount || 0); els.runStatus.textContent = run.status || "—"; els.progressFill.style.width = progress.total ? `${Math.min(100, Math.round((progress.favoriteCount || 0) / progress.total * 100))}%` : "35%"; els.elapsedTime.textContent = formatElapsed(state.startedAt ? Date.now() - state.startedAt : 0); els.resultSummary.textContent = JSON.stringify(run.summary || { status: run.status, checkpoint: Boolean(run.checkpoint) }, null, 2); const ready = run.status === "awaiting_confirmation"; els.confirmImport.disabled = !ready; els.discardRun.disabled = !["reading", "paused", "failed", "awaiting_confirmation"].includes(run.status); }
  function formatElapsed(ms) { const seconds = Math.floor(ms / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
  function showError(error) { els.statusMessage.textContent = error || "操作失败"; }
})();
