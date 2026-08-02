import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(extensionRoot, "..", "..");
const originArg = process.argv.find((arg) => arg.startsWith("--preview-origin="));
if (!originArg) throw new Error("Artifact validation requires --preview-origin=<exact origin>.");
const previewOrigin = new URL(originArg.slice("--preview-origin=".length)).origin;
const outDir = resolve(repoRoot, "release-artifacts", "extension-m0-full-scan-preview");
const zipPath = resolve(repoRoot, "release-artifacts", "collection-revival-extension-m0-full-scan-preview-v0.3.4.zip");
const read = (path) => readFileSync(resolve(outDir, path), "utf8");
if (!existsSync(outDir) || !existsSync(zipPath) || statSync(zipPath).size === 0) throw new Error("M0 Preview directory or ZIP is missing.");

const manifest = JSON.parse(read("manifest.json"));
if (manifest.manifest_version !== 3) throw new Error("M0 Preview must use Manifest V3.");
if (manifest.version !== "0.3.4" || manifest.version_name !== "0.3.4-m0-preview") throw new Error("M0 Preview version mismatch.");
if (manifest.side_panel?.default_path !== "src/sidepanel.html") throw new Error("M0 Side Panel is not registered.");
if (manifest.background?.service_worker !== "src/background.js") throw new Error("M0 background service worker is not registered.");
const serialized = JSON.stringify(manifest);
if (serialized.includes("*.vercel.app") || serialized.includes("xiaohongshu-green.vercel.app") || serialized.includes("localhost")) throw new Error("M0 manifest contains a wildcard, Production, or localhost origin.");
const expectedPermissions = new Set(["https://www.xiaohongshu.com/*", "https://xiaohongshu.com/*", `${previewOrigin}/*`]);
if (manifest.host_permissions.length !== expectedPermissions.size || manifest.host_permissions.some((value) => !expectedPermissions.has(value))) throw new Error("M0 host permissions are not exact.");
const bridge = manifest.content_scripts.find((entry) => (entry.js || []).includes("src/web-bridge.js"));
if (bridge?.matches?.length !== 1 || bridge.matches[0] !== `${previewOrigin}/*`) throw new Error("M0 Web Bridge origin is not exact.");
if (bridge.js[0] !== "src/build-profile.js") throw new Error("Build profile must load before the Web Bridge.");
const scanner = manifest.content_scripts.find((entry) => (entry.js || []).includes("src/full-scan-content.js"));
if (!scanner || !scanner.js.join("|").includes("full-scan-core.js|src/xhs-scanner.js|src/full-scan-content.js")) throw new Error("M0 scanner scripts are not registered in order.");
const expectedScannerMatches = new Set(["https://xiaohongshu.com/*", "https://www.xiaohongshu.com/*"]);
if (scanner.matches.length !== expectedScannerMatches.size || scanner.matches.some((value) => !expectedScannerMatches.has(value))) {
  throw new Error("M0 packaged content script must match both apex and www Xiaohongshu hosts.");
}

const profile = read("src/build-profile.js");
for (const marker of ['id": "m0-preview', 'versionName": "0.3.4-m0-preview', `${previewOrigin}/m0-preview/`, `"${previewOrigin}"`]) {
  if (!profile.includes(marker)) throw new Error(`M0 build profile missing: ${marker}`);
}
if (profile.includes("xiaohongshu-green.vercel.app")) throw new Error("Production origin leaked into M0 build profile.");
const sidepanel = read("src/sidepanel.html");
const sidepanelScript = read("src/sidepanel.js");
for (const marker of ["establishContentConnection", "chrome.scripting.executeScript", "内容脚本注入失败", "扩展未连接", "currentUrlProfileId", "selfProfileLinkStatus", "profileIdMatch", "notesTabCandidateText", "notesTabActiveStateSource", "notesTabMatch", "M0_FULL_SCAN_WAIT_PAGE_READY", "PAGE_READY_WAIT_MS = 10_000", "chrome.tabs.onActivated", "chrome.tabs.onUpdated", "copySubtabDomDiagnostics", "M0_FULL_SCAN_GET_SUBTAB_DOM_DIAGNOSTICS"]) {
  if (!sidepanelScript.includes(marker)) throw new Error(`M0 Side Panel handshake recovery is missing: ${marker}`);
}
if (!sidepanel.includes("M0 全量扫描 Preview 0.3.4") || !sidepanel.includes("导入收藏复活") || !sidepanel.includes("重新检测当前页面") || !sidepanel.includes("子标签 DOM 诊断") || !sidepanel.includes("复制诊断") || !sidepanel.includes("丢弃本轮错误会话并重新扫描")) throw new Error("M0 Side Panel identity/import/diagnostic action is missing.");
const packagedCore = read("src/full-scan-core.js");
for (const marker of ["confirmTrueEnd", "syncPageBindings", "END_NOT_PROVEN", "fallbackScrollAttempts", "rootRebindCount"]) {
  if (!packagedCore.includes(marker)) throw new Error(`M0 premature completion guard is missing: ${marker}`);
}
for (const marker of ["active-transform-tab-content", "validateCaptureBoundary", "FIRST_BATCH_OWN_POSTS_DETECTED", "#userPostedFeeds"]) {
  if (!packagedCore.includes(marker)) throw new Error(`M0 active favorites root boundary is missing: ${marker}`);
}
for (const marker of ["currentUrlProfileIdHash", "selfProfileLinkFound", "profileIdMatch", "navigation-self-profile", "editProfileSignalFound", "findVisibleActiveNotesTab", "findProfileSubtabGroup", "findRedsProfileNotesState", "readVisibleElementText", "isVisible(activeIndicator)", "adjacent-sibling-class:active", "notesTabActiveStateSource", "notesTabMatch", "collectSubtabDomDiagnostics", "m0-subtab-dom-diagnostic-v1", "sanitizeDomIdentifier"]) {
  if (!packagedCore.includes(marker)) throw new Error(`M0 self-profile verification is missing: ${marker}`);
}
if (packagedCore.includes("activeIndicator.textContent")) throw new Error("Packaged Reds active indicator still requires strict empty textContent.");
const sourceCoreBytes = readFileSync(resolve(extensionRoot, "src", "full-scan-core.js"));
const packagedCoreBytes = readFileSync(resolve(outDir, "src", "full-scan-core.js"));
const sourceCoreSha256 = createHash("sha256").update(sourceCoreBytes).digest("hex");
const packagedCoreSha256 = createHash("sha256").update(packagedCoreBytes).digest("hex");
if (sourceCoreSha256 !== packagedCoreSha256) throw new Error("Source and packaged full-scan-core.js SHA-256 values differ.");
const packagedContent = read("src/full-scan-content.js");
for (const marker of ["M0_FULL_SCAN_GET_SUBTAB_DOM_DIAGNOSTICS", "M0_FULL_SCAN_WAIT_PAGE_READY", "RECOVERABLE_PAGE_CODES", "MAX_PAGE_READY_WAIT_MS = 10_000", "new MutationObserver", "observer.disconnect()"]) {
  if (!packagedContent.includes(marker)) throw new Error(`M0 bounded page readiness observer is missing: ${marker}`);
}
const packagedIdb = read("src/full-scan-idb.js");
const packagedBackground = read("src/background.js");
for (const marker of ["M0_FULL_SCAN_INVALIDATE_SESSION", "M0_FULL_SCAN_DISCARD_CONTAMINATED_SESSION", "discardContaminatedSession"]) {
  if (!`${packagedIdb}\n${packagedBackground}\n${sidepanelScript}`.includes(marker)) throw new Error(`M0 contaminated session isolation is missing: ${marker}`);
}
for (const file of ["src/full-scan-core.js", "src/full-scan-content.js", "src/full-scan-idb.js", "src/background.js", "src/web-bridge.js", "src/sidepanel.js"]) {
  if (!existsSync(resolve(outDir, file))) throw new Error(`M0 package file missing: ${file}`);
}
console.log(JSON.stringify({ status: "PASS", versionName: manifest.version_name, previewOrigin, outDir, zipPath, zipBytes: statSync(zipPath).size, sourceCoreSha256, packagedCoreSha256, coreSha256Match: true }, null, 2));
