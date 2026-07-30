import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(extensionRoot, "..", "..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");

for (const path of [
  "apps/extension/src/sidepanel.html",
  "apps/extension/src/full-scan-core.js",
  "apps/extension/src/full-scan-idb.js",
  "apps/extension/src/web-bridge.js",
  "apps/web/public/m0-preview/index.html",
  "apps/web/public/m0-preview/m0-preview.js",
  "apps/web/public/m0-preview/m0-preview.css"
]) if (!existsSync(resolve(repoRoot, path))) throw new Error(`Missing M0 Preview file: ${path}`);

for (const path of [
  "apps/extension/src/sidepanel.js",
  "apps/extension/src/full-scan-core.js",
  "apps/extension/src/full-scan-content.js",
  "apps/extension/src/full-scan-idb.js",
  "apps/extension/src/background.js",
  "apps/extension/src/web-bridge.js",
  "apps/web/public/m0-preview/m0-preview.js"
]) execFileSync(process.execPath, ["--check", resolve(repoRoot, path)], { stdio: "inherit" });

const manifest = JSON.parse(read("apps/extension/manifest.json"));
if (manifest.version !== "0.2.3") throw new Error("Production source manifest version changed.");
if (!manifest.host_permissions.includes("https://xiaohongshu-green.vercel.app/*")) throw new Error("Production source origin changed.");
if (JSON.stringify(manifest).includes("0.3.0-m0-preview")) throw new Error("M0 version leaked into the Production source manifest.");
const expectedXhsMatches = new Set(["https://xiaohongshu.com/*", "https://www.xiaohongshu.com/*"]);
const sourceScannerEntry = manifest.content_scripts.find((entry) => (entry.js || []).includes("src/full-scan-content.js"));
if (!sourceScannerEntry || sourceScannerEntry.matches.length !== expectedXhsMatches.size || sourceScannerEntry.matches.some((value) => !expectedXhsMatches.has(value))) {
  throw new Error("M0 content script must match both apex and www Xiaohongshu hosts.");
}
if (![...expectedXhsMatches].every((value) => manifest.host_permissions.includes(value))) {
  throw new Error("M0 host permissions must cover both apex and www Xiaohongshu hosts.");
}

const build = read("apps/extension/scripts/build-extension.mjs");
for (const marker of [
  "--m0-preview",
  "--preview-origin=",
  "0.3.0-m0-preview",
  "extension-m0-full-scan-preview",
  "collection-revival-extension-m0-full-scan-preview-v0.3.0.zip",
  "M0 Preview origin must be one exact HTTPS origin",
  "Production origin is forbidden"
]) assertIncludes(build, marker, "M0 build profile");

const sidepanel = `${read("apps/extension/src/sidepanel.html")}\n${read("apps/extension/src/sidepanel.js")}`;
for (const marker of [
  "M0 全量扫描 Preview 0.3.0",
  "扫描全部收藏",
  "随机 50 条",
  "导出脱敏统计",
  "M0_FULL_SCAN_LIST_ITEMS",
  "M0_PREVIEW_PREPARE_IMPORT",
  "userCorrectedSourceUrl",
  "canonicalSourceUrl",
  "rawSourceUrl",
  "establishContentConnection",
  "chrome.scripting.executeScript",
  "内容脚本注入失败",
  "扩展未连接",
  "currentUrlProfileId",
  "selfProfileLinkStatus",
  "profileIdMatch"
]) assertIncludes(sidepanel, marker, "Side Panel");

const core = read("apps/extension/src/full-scan-core.js");
for (const marker of [
  "m0-real-favorites-v3",
  "OWN_PROFILE_UNCONFIRMED",
  "FAVORITES_TAB_UNCONFIRMED",
  "NOTES_TAB_UNCONFIRMED",
  "EXCLUDED_PANEL_INSIDE_ROOT",
  "document.scrollingElement",
  "REQUIRED_STABLE_CYCLES = 5",
  "waitForActivityToSettle",
  "M0_FULL_SCAN_VERIFY_SESSION",
  "confirmOwnProfile(document, profileId, location)",
  "currentUrlProfileIdHash",
  "selfProfileLinkFound",
  "profileIdMatch",
  "navigation-self-profile",
  "navigation-account-avatar",
  "editProfileSignalFound"
]) assertIncludes(core, marker, "strict page/full scan core");
if (core.includes("root = document.body") || core.includes("element: document.body")) throw new Error("document.body fallback is forbidden.");

const idb = read("apps/extension/src/full-scan-idb.js");
for (const marker of [
  "collection-revival-m0-preview-v1",
  "scanSessions", "favoriteItems", "scanSessionItems", "importBatches",
  "resumeCount", "completedAt", "missingLinkCount", "reviewCount",
  "M0_PREVIEW_IMPORT_META_REQUEST", "M0_PREVIEW_IMPORT_CHUNK_REQUEST", "M0_PREVIEW_IMPORT_RESULT",
  "source:", "url:", "fallback:"
]) assertIncludes(idb, marker, "Preview IndexedDB/import batching");

const background = read("apps/extension/src/background.js");
for (const marker of ["exactPreviewOrigin", "assertTrustedPreviewSender", "WEB_APP_ORIGINS.length !== 1", "BUILD_PROFILE.id !== \"m0-preview\""]) assertIncludes(background, marker, "Preview origin guard");

const preview = `${read("apps/web/public/m0-preview/index.html")}\n${read("apps/web/public/m0-preview/m0-preview.js")}`;
for (const marker of [
  "collection-revival-m0-preview-v1",
  "确认导入", "撤销本次导入",
  "scanSessionId", "importBatchId", "extensionVersion", "importedAt",
  "rollbackBatch", "userCorrectedSourceUrl", "canonicalSourceUrl", "rawSourceUrl"
]) assertIncludes(preview, marker, "M0 Preview Web");
if (preview.includes("localStorage") || preview.includes("collection-revival-system")) throw new Error("M0 Preview must not access Production localStorage.");
if (preview.includes("xiaohongshu-green.vercel.app")) throw new Error("Production origin leaked into M0 Preview Web.");

const changed = new Set([
  ...gitNames(["diff", "--name-only"]),
  ...gitNames(["diff", "--cached", "--name-only"])
]);
const forbidden = [...changed].filter((path) =>
  path === "apps/web/src/App.tsx" ||
  path === "apps/web/src/main.tsx" ||
  path.includes("storage-migration") ||
  path.startsWith("packages/classification-service/") ||
  path.startsWith("packages/search-service/") ||
  path.startsWith("packages/action-card-service/") ||
  path.startsWith("apps/mobile/")
);
if (forbidden.length) throw new Error(`Forbidden scope changed: ${forbidden.join(", ")}`);

console.log("M0 Preview static validation ok");

function gitNames(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
}
function assertIncludes(source, marker, label) {
  if (!source.includes(marker)) throw new Error(`Missing ${label} marker: ${marker}`);
}
