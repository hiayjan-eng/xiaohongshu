(() => {
  const $ = (id) => document.getElementById(id);
  const els = Object.fromEntries(["statusBadge", "statusMessage", "startCdp", "stopCdp", "phase", "updatedAt", "progressFill", "summary", "favoriteCount", "albumCount", "albumContentCount", "derivedCount", "filteredCount", "attached", "dataSources", "signature", "candidateOutput"].map((id) => [id, $(id)]));
  let targetTabId = null;
  els.startCdp.addEventListener("click", () => void start());
  els.stopCdp.addEventListener("click", () => void stop());
  els.statusBadge.textContent = "等待授权";
  chrome.runtime.onMessage.addListener((message) => { if (message?.type === "M0_CDP_PROBE_UPDATED") void refresh(true); });
  void refresh(true);
  async function message(value) { return chrome.runtime.sendMessage(value); }
  async function start() {
    if (!window.confirm("将临时使用浏览器调试接口读取当前小红书标签页的网络数据，只在本机内存分析，结束后自动断开。是否开始？")) return;
    els.startCdp.disabled = true;
    els.statusBadge.textContent = "正在连接";
    els.statusMessage.textContent = "正在连接浏览器网络。";
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetTabId = tab?.id || null;
    try {
      const response = await message({ type: "M0_CDP_PROBE_START", targetTabId });
      if (!response?.ok) throw new Error(response?.error || "调试接口连接失败");
      render(response.session);
      els.statusMessage.textContent = "正在刷新页面。";
      await chrome.tabs.reload(targetTabId);
      els.statusMessage.textContent = "正在监听页面与 worker 请求，并检查 SSR 数据。";
    } catch (error) { els.statusMessage.textContent = error instanceof Error ? `检测失败：${error.message}` : "检测失败"; }
    finally { els.startCdp.disabled = false; }
  }
  async function stop() { els.stopCdp.disabled = true; els.statusMessage.textContent = "正在断开调试连接。"; try { const response = await message({ type: "M0_CDP_PROBE_STOP" }); if (!response?.ok) throw new Error(response?.error || "断开失败"); render(response.session); } catch (error) { els.statusMessage.textContent = error instanceof Error ? `结束失败：${error.message}` : "结束失败"; } }
  async function refresh(passive) { try { const response = await message({ type: "M0_CDP_PROBE_GET" }); if (!response?.ok) throw new Error(response?.error || "无法读取检测状态"); render(response.session); } catch (error) { if (!passive) els.statusMessage.textContent = error instanceof Error ? error.message : "无法刷新状态"; } }
  function render(session = {}) {
    const active = Boolean(session.active);
    els.favoriteCount.textContent = String(session.favoriteCount || 0);
    els.albumCount.textContent = String(session.albumCount || 0);
    els.albumContentCount.textContent = String(session.albumContentCount || 0);
    els.derivedCount.textContent = String(session.derivedMembershipCount || 0);
    els.filteredCount.textContent = String(session.filteredCount || 0);
    els.attached.textContent = active ? "已连接" : "已断开";
    els.stopCdp.disabled = !active;
    els.phase.textContent = phaseLabel(session.phase, active);
    els.statusBadge.textContent = active ? "检测中" : session.reason === "timeout" ? "已结束" : "等待授权";
    els.updatedAt.textContent = session.updatedAt ? new Date(session.updatedAt).toLocaleTimeString() : "—";
    els.progressFill.style.width = active ? "55%" : session.candidates?.length ? "100%" : "0";
    els.dataSources.textContent = `数据来源：${(session.dataSources || []).join("、") || "—"}`;
    els.signature.textContent = `业务接口动态签名：${session.needsDynamicSignature ? "需要" : "未发现"}`;
    els.candidateOutput.textContent = JSON.stringify(session.candidates || [], null, 2);
    if (!active && session.reason === "timeout" && !(session.candidates || []).length) els.statusMessage.textContent = "未发现业务数据：页面、worker 与 SSR 均未出现符合结构的收藏数据。";
    else if (!active && session.reason && session.reason !== "inactive") els.statusMessage.textContent = `已断开调试连接：${session.reason}。`;
    else if (active && (session.candidates || []).length) els.statusMessage.textContent = "已发现业务候选，仍在监听页面与 worker 请求。";
  }
  function phaseLabel(phase, active) { if (!active) return "已断开调试连接"; return ({ listening: "正在监听页面与 worker 请求", found: "已发现业务候选", "checking-ssr": "正在检查 SSR 数据" })[phase] || "正在连接浏览器网络"; }
})();
