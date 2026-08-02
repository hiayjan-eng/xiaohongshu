import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(extensionRoot, "..", "..");
const originArg = process.argv.find((arg) => arg.startsWith("--preview-origin="));
if (!originArg) throw new Error("Artifact validation requires --preview-origin=<exact origin>.");
const previewOrigin = new URL(originArg.slice("--preview-origin=".length)).origin;
const outDir = resolve(repoRoot, "release-artifacts", "extension-m0-full-scan-preview");
const zipPath = resolve(repoRoot, "release-artifacts", "collection-revival-extension-m0-full-scan-preview-v0.3.0.zip");
const read = (path) => readFileSync(resolve(outDir, path), "utf8");
if (!existsSync(outDir) || !existsSync(zipPath) || statSync(zipPath).size === 0) throw new Error("M0 Preview directory or ZIP is missing.");

const manifest = JSON.parse(read("manifest.json"));
if (manifest.manifest_version !== 3) throw new Error("M0 Preview must use Manifest V3.");
if (manifest.version !== "0.3.0" || manifest.version_name !== "0.3.0-m0-preview") throw new Error("M0 Preview version mismatch.");
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
for (const marker of ['id": "m0-preview', 'versionName": "0.3.0-m0-preview', `${previewOrigin}/m0-preview/`, `"${previewOrigin}"`]) {
  if (!profile.includes(marker)) throw new Error(`M0 build profile missing: ${marker}`);
}
if (profile.includes("xiaohongshu-green.vercel.app")) throw new Error("Production origin leaked into M0 build profile.");
const sidepanel = read("src/sidepanel.html");
const sidepanelScript = read("src/sidepanel.js");
for (const marker of ["establishContentConnection", "chrome.scripting.executeScript", "内容脚本注入失败", "扩展未连接", "currentUrlProfileId", "selfProfileLinkStatus", "profileIdMatch", "notesTabCandidateText", "notesTabActiveStateSource", "notesTabMatch"]) {
  if (!sidepanelScript.includes(marker)) throw new Error(`M0 Side Panel handshake recovery is missing: ${marker}`);
}
if (!sidepanel.includes("M0 全量扫描 Preview 0.3.0") || !sidepanel.includes("导入收藏复活")) throw new Error("M0 Side Panel identity/import action is missing.");
const packagedCore = read("src/full-scan-core.js");
for (const marker of ["currentUrlProfileIdHash", "selfProfileLinkFound", "profileIdMatch", "navigation-self-profile", "editProfileSignalFound", "findVisibleActiveNotesTab", "findProfileSubtabGroup", "notesTabActiveStateSource", "notesTabMatch"]) {
  if (!packagedCore.includes(marker)) throw new Error(`M0 self-profile verification is missing: ${marker}`);
}
for (const file of ["src/full-scan-core.js", "src/full-scan-content.js", "src/full-scan-idb.js", "src/background.js", "src/web-bridge.js", "src/sidepanel.js"]) {
  if (!existsSync(resolve(outDir, file))) throw new Error(`M0 package file missing: ${file}`);
}
console.log(JSON.stringify({ status: "PASS", versionName: manifest.version_name, previewOrigin, outDir, zipPath, zipBytes: statSync(zipPath).size }, null, 2));
