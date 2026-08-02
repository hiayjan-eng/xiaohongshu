import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(scriptDirectory, "..");
const repoRoot = resolve(extensionRoot, "..", "..");
const playwrightModule = pathToFileURL(resolve(repoRoot, "apps", "web", "node_modules", "@playwright", "test", "index.mjs")).href;
const { chromium } = await import(playwrightModule);
const suite = process.argv.find((arg) => arg.startsWith("--suite="))?.slice("--suite=".length) || "all";
const supportedSuites = ["all", "page-identity", "side-panel", "import-bridge", "batch-rollback", "original-link", "preview-namespace"];
if (!supportedSuites.includes(suite)) throw new Error(`Unsupported M0 Preview suite: ${suite}`);

const browser = await chromium.launch({ headless: true, executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
try {
  const results = {};
  if (["all", "page-identity"].includes(suite)) results.pageIdentity = await testPageIdentity();
  if (["all", "side-panel"].includes(suite)) results.sidePanel = await testSidePanel();
  if (["all", "import-bridge", "batch-rollback", "original-link", "preview-namespace"].includes(suite)) {
    results[suite === "all" ? "previewFlow" : suite] = await testPreviewFlow(suite);
  }
  console.log(JSON.stringify({ status: "PASS", suite, ...results }, null, 2));
} finally {
  await browser.close();
}

async function testPageIdentity() {
  const fixtureHtml = await readFile(resolve(extensionRoot, "tests", "fixtures", "full-scan-virtual-list.html"), "utf8");
  const coreSource = await readFile(resolve(extensionRoot, "src", "full-scan-core.js"), "utf8");
  const contentSource = await readFile(resolve(extensionRoot, "src", "full-scan-content.js"), "utf8");
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const host of ["xiaohongshu.com", "www.xiaohongshu.com"]) {
    await page.route(`https://${host}/**`, async (route) => {
      if (route.request().resourceType() === "document") await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixtureHtml });
      else await route.abort();
    });
  }
  const inspect = async () => page.evaluate(() => {
    const value = globalThis.CollectionRevivalFullScanCore.inspectFavoritesPage({ document, location });
    return { ok: value.ok, code: value.code, diagnostics: value.diagnostics };
  });
  try {
    const apexUrl = "https://xiaohongshu.com/user/profile/m0fixtureprofile?tab=fav&subTab=note&total=20";
    await page.goto(apexUrl, { waitUntil: "domcontentloaded" });
    await installContentRuntimeMock(page);
    await page.addScriptTag({ content: coreSource });
    await page.addScriptTag({ content: contentSource });
    const apexHandshake = await sendContentStatus(page);
    assert.equal(apexHandshake.ok, true);
    assert.equal(apexHandshake.inspection.ok, true);

    await page.reload({ waitUntil: "domcontentloaded" });
    await installContentRuntimeMock(page);
    await page.addScriptTag({ content: coreSource });
    await page.addScriptTag({ content: contentSource });
    const apexRefreshHandshake = await sendContentStatus(page);
    assert.equal(apexRefreshHandshake.ok, true);
    assert.equal(apexRefreshHandshake.inspection.ok, true);

    await page.goto("https://www.xiaohongshu.com/user/profile/m0fixtureprofile?tab=fav&subTab=note&total=20", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: coreSource });
    const confirmed = await inspect();
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.diagnostics.selectorVersion, "m0-real-favorites-v5");
    assert.equal(confirmed.diagnostics.ownPostsPanelCount, 1);
    assert.equal(confirmed.diagnostics.editProfileSignalFound, false, "matching self link must pass without an edit-profile button");
    assert.equal(confirmed.diagnostics.selfProfileLinkFound, true);
    assert.equal(confirmed.diagnostics.profileIdMatch, true);
    assert.equal(confirmed.diagnostics.currentUrlProfileIdHash.length, 8);
    assert.equal(confirmed.diagnostics.notesTabCandidateText, "笔记 · 3464");
    assert.equal(confirmed.diagnostics.notesTabActiveStateSource, "aria-selected");
    assert.equal(confirmed.diagnostics.notesTabMatch, true);
    for (const notesText of ["笔记", "笔记 · 3464", "笔记 3464", "笔记·3464"]) {
      await page.evaluate((text) => { document.querySelector('[data-revival-subtab="notes"]').textContent = text; }, notesText);
      const supportedFormat = await inspect();
      assert.equal(supportedFormat.ok, true, `supported notes tab text must pass: ${notesText}`);
      assert.equal(supportedFormat.diagnostics.notesTabCandidateText, notesText);
      assert.equal(supportedFormat.diagnostics.notesTabMatch, true);
    }
    const subtabDomDiagnostics = await page.evaluate(() => {
      document.querySelector('[data-revival-subtab="notes"]').id = "5f02f6f1000000000101cc87";
      document.querySelector('[data-revival-subtab="albums"]').setAttribute("href", "https://www.xiaohongshu.com/explore/example?token=secret-fixture-token");
      return globalThis.CollectionRevivalFullScanCore.collectSubtabDomDiagnostics(document);
    });
    assert.equal(subtabDomDiagnostics.diagnosticVersion, "m0-subtab-dom-diagnostic-v1");
    assert.ok(subtabDomDiagnostics.candidates.notes.length >= 2);
    assert.ok(subtabDomDiagnostics.candidates.albums.length >= 1);
    assert.ok(subtabDomDiagnostics.candidates.files.length >= 1);
    assert.ok(subtabDomDiagnostics.candidates.notes.some((candidate) => candidate.id.startsWith("[redacted:")));
    assert.ok(subtabDomDiagnostics.candidates.albums.some((candidate) => candidate.hasHref === true));
    assert.ok(subtabDomDiagnostics.candidates.notes.some((candidate) => candidate.hasUnderline === true));
    const serializedSubtabDomDiagnostics = JSON.stringify(subtabDomDiagnostics);
    assert.equal(serializedSubtabDomDiagnostics.includes("5f02f6f1000000000101cc87"), false);
    assert.equal(serializedSubtabDomDiagnostics.includes("secret-fixture-token"), false);
    for (const candidate of Object.values(subtabDomDiagnostics.candidates).flat()) {
      assert.equal(typeof candidate.tagName, "string");
      assert.equal(typeof candidate.className, "string");
      assert.equal(typeof candidate.boundingRectVisible, "boolean");
      assert.equal(typeof candidate.hasUnderline, "boolean");
      assert.equal(typeof candidate.hasSelectedIcon, "boolean");
      assert.equal(typeof candidate.hasActiveDescendant, "boolean");
      assert.ok(candidate.computed.display);
      assert.ok(candidate.computed.visibility);
    }

    await page.evaluate(() => history.replaceState(null, "", "/user/profile/m0fixtureprofile?tab=note"));
    assert.equal((await inspect()).code, "FAVORITES_ROUTE_UNCONFIRMED");
    await page.evaluate(() => {
      history.replaceState(null, "", "/user/profile/m0fixtureprofile?tab=fav&subTab=note");
      document.querySelector('nav[aria-label="侧边导航"] a').setAttribute("href", "/user/profile/differentprofile");
    });
    const mismatchedSelfLink = await inspect();
    assert.equal(mismatchedSelfLink.code, "OWN_PROFILE_UNCONFIRMED");
    assert.equal(mismatchedSelfLink.diagnostics.selfProfileLinkFound, true);
    assert.equal(mismatchedSelfLink.diagnostics.profileIdMatch, false);

    await page.evaluate(() => {
      document.querySelector('nav[aria-label="侧边导航"]').remove();
      const edit = document.createElement("button");
      edit.dataset.testid = "profile-edit-button";
      edit.textContent = "编辑资料";
      document.body.prepend(edit);
    });
    const editOnly = await inspect();
    assert.equal(editOnly.code, "OWN_PROFILE_UNCONFIRMED");
    assert.equal(editOnly.diagnostics.selfProfileLinkFound, false);
    assert.equal(editOnly.diagnostics.profileIdMatch, false);
    assert.equal(editOnly.diagnostics.editProfileSignalFound, true);

    await page.goto("https://www.xiaohongshu.com/user/profile/otherprofile?tab=fav&subTab=note&total=20", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: coreSource });
    const otherProfile = await inspect();
    assert.equal(otherProfile.code, "OWN_PROFILE_UNCONFIRMED");
    assert.equal(otherProfile.diagnostics.profileIdMatch, false);

    await page.goto("https://www.xiaohongshu.com/user/profile/m0fixtureprofile?tab=fav&subTab=note&total=20", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: coreSource });
    await page.evaluate(() => document.querySelector('[data-revival-tab="favorites"]').setAttribute("aria-selected", "false"));
    assert.equal((await inspect()).code, "FAVORITES_TAB_UNCONFIRMED");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: coreSource });
    await page.evaluate(() => {
      const notes = document.querySelector('[data-revival-subtab="notes"]');
      notes.setAttribute("aria-selected", "false");
      notes.classList.remove("active");
    });
    const inactiveCountedNotes = await inspect();
    assert.equal(inactiveCountedNotes.code, "NOTES_TAB_UNCONFIRMED");
    assert.equal(inactiveCountedNotes.diagnostics.notesTabCandidateText, "笔记 · 3464");
    assert.equal(inactiveCountedNotes.diagnostics.notesTabActiveStateSource, "none");
    assert.equal(inactiveCountedNotes.diagnostics.notesTabMatch, false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: coreSource });
    await page.evaluate(() => {
      const notes = document.querySelector('[data-revival-subtab="notes"]');
      const albums = document.querySelector('[data-revival-subtab="albums"]');
      notes.setAttribute("aria-selected", "false");
      notes.classList.remove("active");
      albums.setAttribute("aria-selected", "true");
      albums.classList.add("active");
    });
    const activeAlbums = await inspect();
    assert.equal(activeAlbums.code, "NOTES_TAB_UNCONFIRMED");
    assert.equal(activeAlbums.diagnostics.notesTabMatch, false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: coreSource });
    await page.evaluate(() => {
      const notes = document.querySelector('[data-revival-subtab="notes"]');
      notes.textContent = "动态";
      notes.setAttribute("aria-selected", "false");
      notes.classList.remove("active");
      const bodyText = document.createElement("p");
      bodyText.textContent = "笔记";
      document.body.append(bodyText);
    });
    const bodyNotesText = await inspect();
    assert.equal(bodyNotesText.code, "NOTES_TAB_UNCONFIRMED");
    assert.equal(bodyNotesText.diagnostics.notesTabCandidateText, "");
    assert.equal(bodyNotesText.diagnostics.notesTabMatch, false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: coreSource });
    await installRealRedsNotesSubtab(page);
    const realRedsNotes = await inspect();
    assert.equal(realRedsNotes.ok, true);
    assert.equal(realRedsNotes.diagnostics.notesTabCandidateText, "笔记 · 3470");
    assert.equal(realRedsNotes.diagnostics.notesTabActiveStateSource, "adjacent-sibling-class:active");
    assert.equal(realRedsNotes.diagnostics.notesTabMatch, true);

    for (const [name, indicatorText] of [["zero-width", "\u200B"], ["nbsp", "\u00A0"]]) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.addScriptTag({ content: coreSource });
      await installRealRedsNotesSubtab(page, { indicatorText });
      const whitespaceIndicator = await inspect();
      assert.equal(whitespaceIndicator.ok, true, `${name} active indicator must pass`);
      assert.equal(whitespaceIndicator.diagnostics.notesTabMatch, true);
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: coreSource });
    await installRealRedsNotesSubtab(page, { assistiveText: "专辑 · 17" });
    const assistiveTextIndicator = await inspect();
    assert.equal(assistiveTextIndicator.ok, true);
    assert.equal(assistiveTextIndicator.diagnostics.notesTabMatch, true);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: coreSource });
    await installRealRedsNotesSubtab(page, { indicatorText: "专辑 · 17" });
    const activeAlbumBesideNotes = await inspect();
    assert.equal(activeAlbumBesideNotes.code, "NOTES_TAB_UNCONFIRMED");
    assert.equal(activeAlbumBesideNotes.diagnostics.notesTabMatch, false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: coreSource });
    await installRealRedsNotesSubtab(page, { indicatorText: "文件 · 1" });
    const activeFileBesideNotes = await inspect();
    assert.equal(activeFileBesideNotes.code, "NOTES_TAB_UNCONFIRMED");
    assert.equal(activeFileBesideNotes.diagnostics.notesTabMatch, false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: coreSource });
    await installRealRedsNotesSubtab(page, { indicatorActive: false });
    const inactiveRealRedsNotes = await inspect();
    assert.equal(inactiveRealRedsNotes.code, "NOTES_TAB_UNCONFIRMED");
    assert.equal(inactiveRealRedsNotes.diagnostics.notesTabMatch, false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: coreSource });
    await installRealRedsNotesSubtab(page, { sticky: false });
    const unrelatedActiveSibling = await inspect();
    assert.equal(unrelatedActiveSibling.code, "NOTES_TAB_UNCONFIRMED");
    assert.equal(unrelatedActiveSibling.diagnostics.notesTabMatch, false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.querySelector('nav[aria-label="收藏子标签"]').remove());
    await installContentRuntimeMock(page);
    await page.addScriptTag({ content: coreSource });
    await page.addScriptTag({ content: contentSource });
    const initiallyMissingNotes = await sendContentStatus(page);
    assert.equal(initiallyMissingNotes.inspection.code, "NOTES_TAB_UNCONFIRMED");
    const delayedReadyPromise = sendContentMessage(page, { type: "M0_FULL_SCAN_WAIT_PAGE_READY", timeoutMs: 1_000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    await installRealRedsNotesSubtab(page);
    const delayedReady = await delayedReadyPromise;
    assert.equal(delayedReady.ok, true);
    assert.equal(delayedReady.timedOut, false);
    assert.equal(delayedReady.inspection.ok, true);
    assert.equal(delayedReady.inspection.diagnostics.notesTabActiveStateSource, "adjacent-sibling-class:active");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.querySelector('nav[aria-label="收藏子标签"]').remove());
    await installContentRuntimeMock(page);
    await page.addScriptTag({ content: coreSource });
    await page.addScriptTag({ content: contentSource });
    const missingNotesTimeout = await sendContentMessage(page, { type: "M0_FULL_SCAN_WAIT_PAGE_READY", timeoutMs: 80 });
    assert.equal(missingNotesTimeout.ok, true);
    assert.equal(missingNotesTimeout.timedOut, true);
    assert.equal(missingNotesTimeout.inspection.code, "NOTES_TAB_UNCONFIRMED");

    for (const [mode, code] of [["risk", "RISK_CONTROL"], ["login", "LOGIN_EXPIRED"], ["network", "NETWORK_ERROR"]]) {
      await page.goto(`https://www.xiaohongshu.com/user/profile/m0fixtureprofile?tab=fav&subTab=note&total=20&mode=${mode}`, { waitUntil: "domcontentloaded" });
      await page.addScriptTag({ content: coreSource });
      assert.equal((await inspect()).code, code);
    }
    return { strictFavoritesConfirmed: true, subtabDomDiagnosticsSanitized: true, countedActiveNotesPassed: true, realRedsDecorationPassed: true, zeroWidthIndicatorPassed: true, nbspIndicatorPassed: true, assistiveTextIndicatorPassed: true, activeAlbumBesideNotesBlocked: true, activeFileBesideNotesBlocked: true, noActiveAdjacentNodeBlocked: true, delayedSubtabMutationPassed: true, permanentMissingSubtabTimedOut: true, inactiveRealRedsNotesBlocked: true, unrelatedActiveSiblingBlocked: true, inactiveCountedNotesBlocked: true, activeAlbumsBlocked: true, bodyNotesTextBlocked: true, selfLinkWithoutEditButton: true, mismatchedSelfLinkBlocked: true, editProfileOnlyBlocked: true, otherProfileBlocked: true, inactiveFavoritesBlocked: true, inactiveNotesBlocked: true, noWwwHandshake: true, noWwwRefreshHandshake: true, ownPostFalseImportCount: 0, blockersSafePaused: 3 };
  } finally {
    await context.close();
  }
}

async function installRealRedsNotesSubtab(page, options = {}) {
  await page.evaluate(({ indicatorText = null, indicatorActive = true, sticky = true, assistiveText = "" }) => {
    const current = document.querySelector('nav[aria-label="收藏子标签"]');
    const wrapper = document.createElement("div");
    if (sticky) wrapper.className = "reds-sticky";
    const group = document.createElement("div");
    group.className = "tertiary center reds-tabs-list reds-tabs-list";
    const notes = document.createElement("div");
    notes.className = "reds-tab-item sub-tab-list";
    const label = document.createElement("span");
    label.textContent = "笔记 · 3470";
    notes.append(label);
    const indicator = document.createElement("div");
    indicator.className = `reds-tab-item${indicatorActive ? " active" : ""} sub-tab-list`;
    if (indicatorText !== null) indicator.textContent = indicatorText;
    else {
      const decoration = document.createElement("span");
      decoration.className = "reds-tab-active-decoration";
      decoration.setAttribute("aria-hidden", "true");
      decoration.style.cssText = "display:block;width:24px;height:2px;background:currentColor";
      indicator.append(decoration);
    }
    if (assistiveText) {
      const assistive = document.createElement("span");
      assistive.textContent = assistiveText;
      assistive.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)";
      indicator.append(assistive);
    }
    group.append(notes, indicator);
    wrapper.append(group);
    if (current) current.replaceWith(wrapper);
    else document.querySelector('[data-revival-favorites-panel]')?.before(wrapper);
  }, options);
}

async function installContentRuntimeMock(page) {
  await page.evaluate(() => {
    globalThis.__m0ContentListener = null;
    globalThis.chrome = {
      runtime: {
        getManifest: () => ({ version: "0.3.2", version_name: "0.3.2-m0-preview" }),
        onMessage: { addListener(listener) { globalThis.__m0ContentListener = listener; } },
        sendMessage(_message, callback) { callback?.({ ok: true, session: null, recentItems: [] }); }
      }
    };
  });
}

async function sendContentStatus(page) {
  return sendContentMessage(page, { type: "M0_FULL_SCAN_GET_PAGE_STATUS" });
}

async function sendContentMessage(page, message) {
  return page.evaluate((contentMessage) => new Promise((resolve, reject) => {
    if (typeof globalThis.__m0ContentListener !== "function") return reject(new Error("M0 content listener was not installed."));
    globalThis.__m0ContentListener(contentMessage, {}, resolve);
  }), message);
}

async function testSidePanel() {
  const html = await readFile(resolve(extensionRoot, "src", "sidepanel.html"), "utf8");
  const css = await readFile(resolve(extensionRoot, "src", "sidepanel.css"), "utf8");
  const profile = 'globalThis.__COLLECTION_REVIVAL_BUILD_PROFILE__={id:"m0-preview",versionName:"0.3.2-m0-preview",defaultWebAppUrl:"https://preview.test/m0-preview/",webAppOrigins:["https://preview.test"]};';
  const sidepanel = await readFile(resolve(extensionRoot, "src", "sidepanel.js"), "utf8");
  const context = await browser.newContext();
  await context.addInitScript(installSidePanelChromeMock);
  await context.route("https://extension.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("sidepanel.html")) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    if (path.endsWith("sidepanel.css")) return route.fulfill({ status: 200, contentType: "text/css", body: css });
    if (path.endsWith("build-profile.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: profile });
    if (path.endsWith("sidepanel.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: sidepanel });
    return route.abort();
  });
  const page = await context.newPage();
  try {
    await page.goto("https://extension.test/sidepanel.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("pageIdentity")?.textContent?.includes("收藏"));
    assert.equal(await page.locator(".eyebrow").textContent(), "M0 全量扫描 Preview 0.3.2");
    assert.equal(await page.locator("#currentUrlProfileId").textContent(), "已脱敏 •1234");
    assert.equal(await page.locator("#selfProfileLinkStatus").textContent(), "找到");
    assert.equal(await page.locator("#profileIdMatch").textContent(), "是");
    assert.equal(await page.locator("#notesTabCandidateText").textContent(), "笔记 · 3464");
    assert.equal(await page.locator("#notesTabActiveStateSource").textContent(), "aria-selected");
    assert.equal(await page.locator("#notesTabMatch").textContent(), "是");
    await page.waitForFunction(() => document.getElementById("subtabDomDiagnosticsOutput")?.textContent?.includes("m0-subtab-dom-diagnostic-v1"));
    assert.equal((await page.locator("#subtabDomDiagnosticsOutput").textContent()).includes("profileId"), false);
    await page.locator("#copySubtabDomDiagnostics").click();
    await page.waitForFunction(() => document.getElementById("copySubtabDomDiagnosticsStatus")?.textContent?.includes("已复制"));
    const copiedSubtabDomDiagnostics = await page.evaluate(() => globalThis.__copiedSubtabDomDiagnostics);
    assert.ok(copiedSubtabDomDiagnostics.includes("m0-subtab-dom-diagnostic-v1"));
    assert.equal(copiedSubtabDomDiagnostics.includes("profileId"), false);
    assert.equal(await page.locator("#startScan").isEnabled(), true);
    await page.locator("#randomButton").click();
    await page.waitForFunction(() => document.querySelectorAll("#resultItems li").length === 2);
    const messages = await page.evaluate(() => globalThis.__sidePanelMessages);
    assert.ok(messages.some((message) => message.type === "M0_FULL_SCAN_LIST_ITEMS" && message.options.random === true));
    const injections = await page.evaluate(() => globalThis.__sidePanelInjections);
    assert.deepEqual(injections, [{
      tabId: 7,
      files: ["src/full-scan-core.js", "src/xhs-scanner.js", "src/full-scan-content.js"]
    }]);
    const manifestHasPopup = await page.evaluate(() => Boolean(chrome.runtime.getManifest().action?.default_popup));
    assert.equal(manifestHasPopup, false, "long task must not depend on a popup");
    await page.evaluate(() => globalThis.__activateSidePanelTab(9, "notesRoute", "https://xiaohongshu.com/user/profile/test?tab=note"));
    await page.waitForFunction(() => document.getElementById("pageIdentity")?.textContent === "未确认收藏页");
    assert.equal(await page.locator("#startScan").isDisabled(), true);
    await page.evaluate(() => globalThis.__activateSidePanelTab(7, "ready", "https://xiaohongshu.com/user/profile/test?tab=fav&subTab=note"));
    await page.waitForFunction(() => document.getElementById("pageIdentity")?.textContent?.includes("收藏"));
    assert.equal(await page.locator("#startScan").isEnabled(), true);

    const delayedReadyPage = await context.newPage();
    await delayedReadyPage.goto("https://extension.test/sidepanel.html?delayedReady=1", { waitUntil: "domcontentloaded" });
    await delayedReadyPage.waitForFunction(() => document.getElementById("pageIdentity")?.textContent === "等待页面渲染…");
    assert.equal(await delayedReadyPage.locator("#startScan").isDisabled(), true);
    await delayedReadyPage.evaluate(() => globalThis.__resolveDelayedPageReady());
    await delayedReadyPage.waitForFunction(() => document.getElementById("pageIdentity")?.textContent?.includes("收藏"));
    assert.equal(await delayedReadyPage.locator("#startScan").isEnabled(), true);
    await delayedReadyPage.close();

    const boundaryFailurePage = await context.newPage();
    await boundaryFailurePage.goto("https://extension.test/sidepanel.html?boundaryFailure=1", { waitUntil: "domcontentloaded" });
    await boundaryFailurePage.waitForFunction(() => document.getElementById("pageIdentity")?.textContent === "未确认收藏页");
    await boundaryFailurePage.waitForFunction(() => document.getElementById("subtabDomDiagnosticsOutput")?.textContent?.includes("m0-subtab-dom-diagnostic-v1"));
    await boundaryFailurePage.locator("#copySubtabDomDiagnostics").click();
    await boundaryFailurePage.waitForFunction(() => document.getElementById("copySubtabDomDiagnosticsStatus")?.textContent?.includes("已复制"));
    assert.ok((await boundaryFailurePage.evaluate(() => globalThis.__copiedSubtabDomDiagnostics)).includes("m0-subtab-dom-diagnostic-v1"));
    await boundaryFailurePage.evaluate(() => globalThis.__setSidePanelPageState("ready", undefined, false));
    await boundaryFailurePage.locator("#redetectPage").click();
    await boundaryFailurePage.waitForFunction(() => document.getElementById("pageIdentity")?.textContent?.includes("收藏"));
    assert.equal(await boundaryFailurePage.locator("#startScan").isEnabled(), true);
    await boundaryFailurePage.close();

    const routeTransitionPage = await context.newPage();
    await routeTransitionPage.goto("https://extension.test/sidepanel.html?routeTransition=1", { waitUntil: "domcontentloaded" });
    await routeTransitionPage.waitForFunction(() => document.getElementById("pageIdentity")?.textContent === "未确认收藏页");
    await routeTransitionPage.evaluate(() => globalThis.__setSidePanelPageState("ready", "https://xiaohongshu.com/user/profile/test?tab=fav&subTab=note"));
    await routeTransitionPage.waitForFunction(() => document.getElementById("pageIdentity")?.textContent?.includes("收藏"));
    assert.equal(await routeTransitionPage.locator("#startScan").isEnabled(), true);
    await routeTransitionPage.evaluate(() => globalThis.__setSidePanelPageState("notesRoute", "https://xiaohongshu.com/user/profile/test?tab=note"));
    await routeTransitionPage.waitForFunction(() => document.getElementById("pageIdentity")?.textContent === "未确认收藏页");
    assert.equal(await routeTransitionPage.locator("#startScan").isDisabled(), true);
    await routeTransitionPage.close();

    const failurePage = await context.newPage();
    await failurePage.goto("https://extension.test/sidepanel.html?injectionFailure=1", { waitUntil: "domcontentloaded" });
    await failurePage.waitForFunction(() => document.getElementById("safetyMessage")?.textContent?.includes("内容脚本注入失败"));
    assert.equal(await failurePage.locator("#pageIdentity").textContent(), "扩展未连接");
    assert.equal((await failurePage.locator("#safetyMessage").textContent()).includes("请确认当前位于"), false);
    await failurePage.close();

    return { opened: true, delayedDomAutoPassed: true, permanentMissingTimedOut: true, manualRedetectPassed: true, routeToFavoritesAutoPassed: true, routeBackToNotesBlocked: true, activeTabChangeDetected: true, subtabDomDiagnosticsCopied: true, boundaryFailureDiagnosticsCopied: true, apexHost: true, safeReinjection: true, explicitInjectionFailure: true, randomReview: 2, popupIndependent: true };
  } finally {
    await context.close();
  }
}

async function testPreviewFlow(requestedSuite) {
  const html = await readFile(resolve(repoRoot, "apps", "web", "public", "m0-preview", "index.html"), "utf8");
  const css = await readFile(resolve(repoRoot, "apps", "web", "public", "m0-preview", "m0-preview.css"), "utf8");
  const script = await readFile(resolve(repoRoot, "apps", "web", "public", "m0-preview", "m0-preview.js"), "utf8");
  const context = await browser.newContext();
  await context.addInitScript(installPreviewBridgeMock, createFixtureItems(20));
  await context.addInitScript(() => localStorage.setItem("collection-revival-system", "production-sentinel"));
  await context.route("https://preview.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/m0-preview/" || path.endsWith("index.html")) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    if (path.endsWith("m0-preview.css")) return route.fulfill({ status: 200, contentType: "text/css", body: css });
    if (path.endsWith("m0-preview.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: script });
    return route.abort();
  });
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  try {
    await page.goto("https://preview.test/m0-preview/?importBatchId=import_batch_1", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("newCount")?.textContent === "20");
    assert.equal(await page.locator("#existingCount").textContent(), "0");

    const linkChecks = await page.evaluate(() => {
      const api = globalThis.CollectionRevivalM0Preview;
      return {
        corrected: api.resolveOriginalUrl({
          userCorrectedSourceUrl: "https://www.xiaohongshu.com/explore/corrected001",
          canonicalSourceUrl: "https://www.xiaohongshu.com/explore/canonical001",
          rawSourceUrl: "https://www.xiaohongshu.com/discovery/item/raw001"
        }),
        profileRejected: api.resolveOriginalUrl({ canonicalSourceUrl: "https://www.xiaohongshu.com/user/profile/not-a-note" }),
        tokenSame: api.buildDedupeKey({ sourceId: "same-source", canonicalSourceUrl: "https://www.xiaohongshu.com/explore/same-source?xsec_token=a" }) === api.buildDedupeKey({ sourceId: "same-source", canonicalSourceUrl: "https://www.xiaohongshu.com/explore/same-source?xsec_token=b" }),
        sameTitleDistinct: api.buildDedupeKey({ sourceId: "source-a", title: "相同标题" }) !== api.buildDedupeKey({ sourceId: "source-b", title: "相同标题" })
      };
    });
    assert.ok(linkChecks.corrected.includes("corrected001"));
    assert.equal(linkChecks.profileRejected, "");
    assert.equal(linkChecks.tokenSame, true);
    assert.equal(linkChecks.sameTitleDistinct, true);

    await page.locator("#confirmImport").click();
    await page.waitForFunction(() => document.getElementById("libraryCount")?.textContent === "20 条");
    assert.equal(await page.evaluate(() => localStorage.getItem("collection-revival-system")), "production-sentinel");

    await page.goto("https://preview.test/m0-preview/?importBatchId=import_batch_2", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("existingCount")?.textContent === "20");
    assert.equal(await page.locator("#newCount").textContent(), "0");
    await page.locator("#confirmImport").click();
    await page.waitForFunction(() => document.getElementById("importTitle")?.textContent === "导入完成");
    await page.locator("#rollbackImport").click();
    await page.waitForFunction(() => document.getElementById("importTitle")?.textContent === "本批次已撤销");
    assert.equal(await page.locator("#libraryCount").textContent(), "20 条", "rolling back duplicate-only batch must not affect prior batch");

    await page.goto("https://preview.test/m0-preview/?importBatchId=import_batch_1", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("importTitle")?.textContent === "本批次已导入");
    await page.locator("#rollbackImport").click();
    await page.waitForFunction(() => document.getElementById("libraryCount")?.textContent === "0 条");

    const databases = await page.evaluate(async () => (await indexedDB.databases()).map((entry) => entry.name));
    assert.deepEqual(databases, ["collection-revival-m0-preview-v1"]);
    return {
      requestedSuite,
      firstImportNew: 20,
      secondImportNew: 0,
      batchRollbackIsolated: true,
      originalLinkPriority: true,
      profileLinkRejected: true,
      productionSentinelUntouched: true,
      databaseNames: databases
    };
  } finally {
    await context.close();
  }
}

function createFixtureItems(total) {
  return Array.from({ length: total }, (_, index) => ({
    sourceId: `previewnote${String(index).padStart(6, "0")}`,
    rawSourceUrl: `https://www.xiaohongshu.com/discovery/item/previewnote${String(index).padStart(6, "0")}?xsec_token=token-${index}`,
    canonicalSourceUrl: `https://www.xiaohongshu.com/explore/previewnote${String(index).padStart(6, "0")}?xsec_token=token-${index}`,
    title: index < 2 ? "相同标题但不同 sourceId" : `Preview 收藏 ${index}`,
    author: `作者 ${index % 5}`,
    coverUrl: "",
    visibleExcerpt: `仅用于自动测试的脱敏夹具 ${index}`,
    capturedAt: "2026-07-30T00:00:00.000Z",
    selectorVersion: "m0-real-favorites-v5"
  }));
}

function installPreviewBridgeMock(items) {
  globalThis.__previewFixtureItems = items;
  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (event.source !== window || message.source !== "collection-revival-m0-preview-web") return;
    let response;
    if (message.type === "M0_PREVIEW_IMPORT_META_REQUEST") {
      response = { ok: true, meta: { importBatchId: message.importBatchId, scanSessionId: "scan_fixture", extensionVersion: "0.3.2-m0-preview", totalCount: items.length, reviewCount: 0, selectorVersion: "m0-real-favorites-v5", status: "prepared" } };
    } else if (message.type === "M0_PREVIEW_IMPORT_CHUNK_REQUEST") {
      const offset = Number(message.offset) || 0;
      const limit = Number(message.limit) || 200;
      const chunkItems = items.slice(offset, offset + limit);
      response = { ok: true, chunk: { importBatchId: message.importBatchId, scanSessionId: "scan_fixture", extensionVersion: "0.3.2-m0-preview", items: chunkItems, offset, nextOffset: offset + chunkItems.length, hasMore: offset + chunkItems.length < items.length, totalCount: items.length } };
    } else if (message.type === "M0_PREVIEW_IMPORT_RESULT") response = { ok: true };
    else return;
    window.setTimeout(() => window.postMessage({ source: "collection-revival-extension", type: "M0_PREVIEW_RESPONSE", requestId: message.requestId, requestType: message.type, response }, window.location.origin), 0);
  });
}

function installSidePanelChromeMock() {
  globalThis.__sidePanelMessages = [];
  globalThis.__sidePanelInjections = [];
  globalThis.__copiedSubtabDomDiagnostics = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { async writeText(value) { globalThis.__copiedSubtabDomDiagnostics = String(value); } }
  });
  let contentConnected = false;
  let pageState = location.search.includes("delayedReady=1")
    ? "delayed"
    : location.search.includes("boundaryFailure=1")
      ? "missing"
      : location.search.includes("routeTransition=1")
        ? "notesRoute"
        : "ready";
  let activeTabId = 7;
  let activeTabUrl = pageState === "notesRoute"
    ? "https://xiaohongshu.com/user/profile/test?tab=note"
    : "https://xiaohongshu.com/user/profile/test?tab=fav&subTab=note";
  const tabActivatedListeners = [];
  const tabUpdatedListeners = [];
  const delayedReadyCallbacks = [];
  const session = { sessionId: "scan_sidepanel", status: "completed", discoveredCount: 20, validCount: 20, existingCount: 0, invalidCount: 0, missingLinkCount: 0, reviewCount: 0, resumeCount: 1, lastScrollTop: 100, lastScrollHeight: 100, stableNoGrowthCycles: 6, startedAt: "2026-07-30T00:00:00.000Z", completedAt: "2026-07-30T00:01:00.000Z", selectorVersion: "m0-real-favorites-v5", extensionVersion: "0.3.2-m0-preview" };
  const inspection = { ok: true, identity: { profileIdHash: "abcd1234", favoritesPageIdentity: "fixture-page", selectorVersion: "m0-real-favorites-v5" }, diagnostics: { selectorVersion: "m0-real-favorites-v5", currentUrlProfileIdHash: "abcd1234", selfProfileLinkFound: true, profileIdMatch: true, editProfileSignalFound: false, notesTabCandidateText: "笔记 · 3464", notesTabActiveStateSource: "aria-selected", notesTabMatch: true, ownPostsPanelCount: 1, likesPanelCount: 1 } };
  const subtabDomDiagnostics = {
    diagnosticVersion: "m0-subtab-dom-diagnostic-v1",
    candidates: {
      notes: [{ tagName: "div", id: "", className: "note channel active", role: "tab", ariaSelected: "", ariaCurrent: "", dataState: "", hasHref: false, parent: { tagName: "div", className: "channel-list", role: "", ariaSelected: "", ariaCurrent: "", dataState: "" }, grandparent: null, siblings: { previousClassName: "", nextClassName: "channel" }, computed: { display: "flex", visibility: "visible" }, boundingRectVisible: true, hasUnderline: true, hasSelectedIcon: false, hasActiveDescendant: true }],
      albums: [],
      files: []
    }
  };
  const items = [0, 1].map((index) => ({ sourceId: `sidepanel${index}`, title: `抽查 ${index}`, author: "测试作者", canonicalSourceUrl: `https://www.xiaohongshu.com/explore/sidepanel${index}` }));
  const runtimeListeners = [];
  const currentInspection = () => {
    if (pageState === "ready") return inspection;
    if (pageState === "notesRoute") {
      return { ok: false, code: "FAVORITES_ROUTE_UNCONFIRMED", reason: "当前 URL 未确认处于收藏笔记路由。", diagnostics: inspection.diagnostics };
    }
    return { ok: false, code: "NOTES_TAB_UNCONFIRMED", reason: "未确认可见激活子 tab 为“笔记”。", diagnostics: inspection.diagnostics };
  };
  globalThis.__resolveDelayedPageReady = () => {
    pageState = "ready";
    for (const callback of delayedReadyCallbacks.splice(0)) callback({ ok: true, inspection, timedOut: false });
  };
  globalThis.__setSidePanelPageState = (nextState, nextUrl, notify = true) => {
    pageState = nextState;
    if (nextUrl) activeTabUrl = nextUrl;
    if (notify) {
      const tab = { id: activeTabId, active: true, url: activeTabUrl };
      for (const listener of tabUpdatedListeners) listener(activeTabId, { url: activeTabUrl }, tab);
    }
  };
  globalThis.__activateSidePanelTab = (nextTabId, nextState, nextUrl) => {
    activeTabId = nextTabId;
    pageState = nextState;
    activeTabUrl = nextUrl;
    for (const listener of tabActivatedListeners) listener({ tabId: activeTabId, windowId: 1 });
  };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: "0.3.2", version_name: "0.3.2-m0-preview", action: {} }),
      onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
      sendMessage(message, callback) {
        globalThis.__sidePanelMessages.push(message);
        if (message.type === "M0_FULL_SCAN_GET_SESSION") callback({ ok: true, session, recentItems: items });
        else if (message.type === "M0_FULL_SCAN_LIST_ITEMS") callback({ ok: true, items, totalMatched: 2 });
        else if (message.type === "M0_FULL_SCAN_GET_DIAGNOSTICS") callback({ ok: true, diagnostics: { session, verification: { consistent: true, uniqueSourceIdCount: 20 } } });
        else callback({ ok: true });
      }
    },
    tabs: {
      query: async () => [{ id: activeTabId, active: true, url: activeTabUrl }],
      onActivated: { addListener(listener) { tabActivatedListeners.push(listener); } },
      onUpdated: { addListener(listener) { tabUpdatedListeners.push(listener); } },
      sendMessage(_tabId, message, callback) {
        globalThis.__sidePanelMessages.push(message);
        if (!contentConnected) {
          chrome.runtime.lastError = { message: "Could not establish connection. Receiving end does not exist." };
          callback(undefined);
          chrome.runtime.lastError = null;
          return;
        }
        if (message.type === "M0_FULL_SCAN_GET_PAGE_STATUS") {
          callback({ ok: true, inspection: currentInspection() });
        }
        else if (message.type === "M0_FULL_SCAN_WAIT_PAGE_READY" && pageState === "delayed") delayedReadyCallbacks.push(callback);
        else if (message.type === "M0_FULL_SCAN_WAIT_PAGE_READY") callback({ ok: true, inspection: currentInspection(), timedOut: pageState === "missing" });
        else if (message.type === "M0_FULL_SCAN_GET_SUBTAB_DOM_DIAGNOSTICS") callback({ ok: true, diagnostics: subtabDomDiagnostics });
        else if (message.type === "M0_FULL_SCAN_GET_RUNTIME_DIAGNOSTICS") callback({ ok: true, diagnostics: { maxBufferedItems: 25, recentItemCount: 12, scrollMode: "element" } });
        else callback({ ok: true, session });
      },
      create: async () => ({ id: 8 })
    },
    scripting: {
      async executeScript(details) {
        globalThis.__sidePanelInjections.push({ tabId: details.target.tabId, files: [...details.files] });
        if (location.search.includes("injectionFailure=1")) throw new Error("Cannot access contents of the page");
        contentConnected = true;
        return [];
      }
    },
    downloads: { download: async () => 1 }
  };
}
