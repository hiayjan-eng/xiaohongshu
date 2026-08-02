(() => {
  if (globalThis.__collectionRevivalM0FullScanContentInstalled) return;
  globalThis.__collectionRevivalM0FullScanContentInstalled = true;

  const Core = globalThis.CollectionRevivalFullScanCore;
  if (!Core) throw new Error("M0 full scan core must load before the content adapter.");

  let controller = createController();
  let autoResumeStarted = false;
  let pageReadyWait = null;
  const RECOVERABLE_PAGE_CODES = new Set([
    "NOTES_TAB_UNCONFIRMED",
    "FAVORITES_TAB_UNCONFIRMED",
    "FAVORITES_PANEL_NOT_FOUND"
  ]);
  const MAX_PAGE_READY_WAIT_MS = 10_000;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!String(message?.type || "").startsWith("M0_FULL_SCAN_")) return false;
    void handleControlMessage(message)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });

  window.setTimeout(() => void autoResumeInterruptedScan(), 0);

  function createController() {
    return new Core.FullScanController({
      document,
      location: window.location,
      MutationObserver,
      sendMessage: sendRuntimeMessage,
      testMode: globalThis.__M0_FULL_SCAN_TEST_MODE__ === true,
      onProgress(progress) {
        try {
          chrome.runtime.sendMessage({ type: "M0_FULL_SCAN_PROGRESS", progress });
        } catch {
          // Side Panel may be closed; Extension IndexedDB remains authoritative.
        }
      }
    });
  }

  async function autoResumeInterruptedScan() {
    if (autoResumeStarted || controller.running) return;
    const inspection = controller.inspectPage();
    if (!inspection.ok) return;
    const stored = await sendRuntimeMessage({
      type: "M0_FULL_SCAN_GET_SESSION",
      favoritesPageIdentity: inspection.identity.favoritesPageIdentity
    }).catch(() => null);
    if (stored?.session?.status !== "scanning") return;
    autoResumeStarted = true;
    controller = createController();
    await controller.start({ resume: true }).catch(() => null);
  }

  async function handleControlMessage(message) {
    switch (message.type) {
      case "M0_FULL_SCAN_GET_PAGE_STATUS":
        return readPageStatus();
      case "M0_FULL_SCAN_WAIT_PAGE_READY":
        return waitForPageReady(message.timeoutMs);
      case "M0_FULL_SCAN_GET_SUBTAB_DOM_DIAGNOSTICS":
        return { ok: true, diagnostics: Core.collectSubtabDomDiagnostics(document) };
      case "M0_FULL_SCAN_START":
        if (controller.running) return { ok: true, session: controller.session, alreadyRunning: true };
        return controller.start({ resume: false, debugPauseAfter: message.debugPauseAfter });
      case "M0_FULL_SCAN_RESUME":
        if (controller.running) return { ok: true, session: controller.session, alreadyRunning: true };
        controller = createController();
        return controller.start({ resume: true, debugPauseAfter: message.debugPauseAfter });
      case "M0_FULL_SCAN_PAUSE":
        return controller.pause("用户暂停");
      case "M0_FULL_SCAN_STOP":
        return controller.stop();
      case "M0_FULL_SCAN_GET_RUNTIME_DIAGNOSTICS":
        return { ok: true, diagnostics: controller.diagnostics(), session: controller.session };
      default:
        return { ok: false, error: `未知全量扫描指令：${message.type}` };
    }
  }

  function readPageStatus() {
    return { ok: true, inspection: publicInspection(controller.inspectPage()) };
  }

  async function waitForPageReady(requestedTimeoutMs) {
    const initial = controller.inspectPage();
    if (initial.ok || !RECOVERABLE_PAGE_CODES.has(initial.code)) {
      return { ok: true, inspection: publicInspection(initial), timedOut: false };
    }
    if (pageReadyWait) return pageReadyWait;

    const parsedTimeout = Number(requestedTimeoutMs);
    const timeoutMs = Number.isFinite(parsedTimeout)
      ? Math.min(MAX_PAGE_READY_WAIT_MS, Math.max(50, Math.round(parsedTimeout)))
      : MAX_PAGE_READY_WAIT_MS;
    const wait = new Promise((resolve) => {
      let settled = false;
      let timeoutId = null;
      const observer = new MutationObserver(() => inspectAfterMutation());
      const finishWait = (inspection, timedOut) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        resolve({ ok: true, inspection: publicInspection(inspection), timedOut });
      };
      const inspectAfterMutation = () => {
        const inspection = controller.inspectPage();
        if (inspection.ok || !RECOVERABLE_PAGE_CODES.has(inspection.code)) finishWait(inspection, false);
      };
      observer.observe(document.documentElement || document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "aria-selected", "aria-current", "data-state", "data-active", "hidden"]
      });
      timeoutId = window.setTimeout(() => finishWait(controller.inspectPage(), true), timeoutMs);
      inspectAfterMutation();
    });
    pageReadyWait = wait;
    try {
      return await wait;
    } finally {
      if (pageReadyWait === wait) pageReadyWait = null;
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) return reject(new Error(runtimeError.message));
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function publicInspection(inspection) {
    if (!inspection?.ok) return inspection;
    const { root: _root, scrollContainer: _scrollContainer, ...serializable } = inspection;
    return serializable;
  }
})();
