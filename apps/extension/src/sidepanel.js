(() => {
  const $ = (id) => document.getElementById(id);
  const state = { run: null, startedAt: 0 };
  const els = Object.fromEntries(["statusBadge", "statusMessage", "detectApi", "refreshProbe", "progressMessage", "elapsedTime", "progressFill", "probeSummary", "favoriteCount", "albumCount", "membershipCount", "pageCount", "runStatus", "endpointCount", "startRead", "confirmImport", "discardRun", "resultSummary", "probeOutput"].map((id) => [id, $(id)]));
  els.detectApi.addEventListener("click", () => detect());
  els.refreshProbe.addEventListener("click", () => refresh());
  els.startRead.addEventListener("click", () => read());
  els.confirmImport.addEventListener("click", () => confirm());
  els.discardRun.addEventListener("click", () => discard());
  setInterval(() => render(), 500); void refresh();
  async function message(value) { return chrome.runtime.sendMessage(value); }
  async function detect() {
    els.statusMessage.textContent = "探测器已注入 MAIN world；现在刷新收藏页或切换一次专辑，让页面自身产生请求。";
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.tabs.sendMessage(tabs[0].id, { type: "M0_API_PROBE_START" }).catch(() => null);
    if (!response?.ok) els.statusMessage.textContent = "请在已登录的小红书收藏页中打开侧边栏后再检测。";
    await refresh();
  }
  async function refresh() { const response = await message({ type: "M0_API_PROBE_GET" }); if (response?.ok) renderProbes(response.probes || []); }
  async function read() {
    const created = await message({ type: "M0_API_SYNC_CREATE_RUN" }); if (!created?.ok) return showError(created?.error);
    state.run = created.run; state.startedAt = Date.now(); render();
    const response = await message({ type: "M0_API_SYNC_READ", runId: state.run.runId });
    if (!response?.ok) { els.statusMessage.textContent = response?.error || "读取未开始。"; els.progressMessage.textContent = "等待可确认的页面原生调用能力"; }
  }
  async function confirm() { const response = await message({ type: "M0_API_SYNC_CONFIRM", runId: state.run?.runId }); if (!response?.ok) return showError(response?.error); state.run = response.run; render(); }
  async function discard() { const response = await message({ type: "M0_API_SYNC_DISCARD", runId: state.run?.runId }); if (!response?.ok) return showError(response?.error); state.run = response.run; render(); }
  function renderProbes(probes) { els.endpointCount.textContent = String(probes.length); els.probeOutput.textContent = JSON.stringify(probes, null, 2); const kinds = new Set(probes.map((probe) => probe.kind)); els.probeSummary.textContent = `收藏 ${kinds.has("favorites") ? "已识别" : "未识别"}；专辑 ${kinds.has("albums") ? "已识别" : "未识别"}；关系 ${kinds.has("memberships") ? "已识别" : "未识别"}。`; els.statusBadge.textContent = probes.length ? "已捕获" : "待检测"; }
  function render() { const run = state.run; if (!run) return; const progress = run.progress || {}; els.favoriteCount.textContent = String(progress.favoriteCount || 0); els.albumCount.textContent = String(progress.albumCount || 0); els.membershipCount.textContent = String(progress.membershipCount || 0); els.pageCount.textContent = String(progress.pageCount || 0); els.runStatus.textContent = run.status || "—"; els.progressFill.style.width = progress.total ? `${Math.min(100, Math.round((progress.favoriteCount || 0) / progress.total * 100))}%` : "35%"; els.elapsedTime.textContent = formatElapsed(state.startedAt ? Date.now() - state.startedAt : 0); els.resultSummary.textContent = JSON.stringify(run.summary || { status: run.status, checkpoint: Boolean(run.checkpoint) }, null, 2); const ready = run.status === "awaiting_confirmation"; els.confirmImport.disabled = !ready; els.discardRun.disabled = !["reading", "paused", "failed", "awaiting_confirmation"].includes(run.status); }
  function formatElapsed(ms) { const seconds = Math.floor(ms / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
  function showError(error) { els.statusMessage.textContent = error || "操作失败"; }
})();
