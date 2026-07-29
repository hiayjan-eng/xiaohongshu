(() => {
  if (globalThis.__collectionRevivalM0FullScanContentInstalled) return;
  globalThis.__collectionRevivalM0FullScanContentInstalled = true;

  const Core = globalThis.CollectionRevivalFullScanCore;
  if (!Core) throw new Error("M0 full scan core must load before the content adapter.");

  let controller = createController();
  let autoResumeStarted = false;

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
        return { ok: true, inspection: publicInspection(controller.inspectPage()) };
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
