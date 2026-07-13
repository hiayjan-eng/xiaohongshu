import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const requiredFiles = [
  "manifest.json",
  "src/popup.html",
  "src/popup.js",
  "src/popup.css",
  "src/web-bridge.js",
  "src/xhs-scanner.js"
];

for (const file of requiredFiles) {
  if (!existsSync(new URL(`../${file}`, import.meta.url))) {
    throw new Error(`Missing extension file: ${file}`);
  }
}

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Extension must use Manifest V3");
if (manifest.version !== "0.2.1") throw new Error("Extension version must be 0.2.1");
if (!manifest.permissions.includes("activeTab")) throw new Error("activeTab permission is required for user-triggered scanning");
if (!manifest.permissions.includes("scripting")) throw new Error("scripting permission is required for programmatic content script injection");
if (!manifest.permissions.includes("storage")) throw new Error("storage permission is required for checkpoint restore");
if (!manifest.permissions.includes("downloads")) throw new Error("downloads permission is required for JSON export");

const contentScripts = manifest.content_scripts ?? [];
const contentMatches = contentScripts.flatMap((entry) => entry.matches || []);
if (!contentMatches.includes("https://xiaohongshu-green.vercel.app/*")) throw new Error("Web handshake content script match is required");
if (!contentMatches.includes("http://localhost:5173/*")) throw new Error("Localhost web handshake match is required");
if (!contentMatches.includes("https://www.xiaohongshu.com/*")) throw new Error("Xiaohongshu scanner match is required");
if (!contentMatches.includes("https://xiaohongshu.com/*")) throw new Error("Xiaohongshu root scanner match is required");

const webBridgeEntry = contentScripts.find((entry) => (entry.js || []).includes("src/web-bridge.js"));
const scannerEntry = contentScripts.find((entry) => (entry.js || []).includes("src/xhs-scanner.js"));
if (!webBridgeEntry) throw new Error("Missing Web Bridge content script entry");
if (!scannerEntry) throw new Error("Missing Xiaohongshu scanner content script entry");

for (const script of ["popup.js", "web-bridge.js", "xhs-scanner.js"]) {
  execFileSync(process.execPath, ["--check", fileURLToPath(new URL(`../src/${script}`, import.meta.url))], { stdio: "inherit" });
}

const popupJs = readFileSync(new URL("../src/popup.js", import.meta.url), "utf8");
const webBridge = readFileSync(new URL("../src/web-bridge.js", import.meta.url), "utf8");
const scanner = readFileSync(new URL("../src/xhs-scanner.js", import.meta.url), "utf8");
const popupHtml = readFileSync(new URL("../src/popup.html", import.meta.url), "utf8");

const popupMarkers = ["CHECKPOINT_KEY", "pauseScan", "resumeScan", "browser-extension-beta", "autoScrollToggle", "clearCheckpoint", "openOrRefreshWebApp", "bridgeStatus", "scannerStatus"];
const bridgeMarkers = ["COLLECTION_REVIVAL_EXTENSION_READY", "COLLECTION_REVIVAL_EXTENSION_PING", "COLLECTION_REVIVAL_EXTENSION_PONG", "requestId", "protocolVersion", "collection-revival-web-bridge-v1"];
const scannerMarkers = ["REVIVAL_GET_PAGE_STATUS", "REVIVAL_SCAN_STEP", "scrollOneStep", "blocked", "验证码"];
for (const marker of popupMarkers) {
  if (!popupJs.includes(marker) && !popupHtml.includes(marker)) throw new Error(`Missing popup beta capability marker: ${marker}`);
}
for (const marker of bridgeMarkers) {
  if (!webBridge.includes(marker)) throw new Error(`Missing Web Bridge marker: ${marker}`);
}
for (const marker of scannerMarkers) {
  if (!scanner.includes(marker)) throw new Error(`Missing scanner beta capability marker: ${marker}`);
}

console.log("extension beta manifest and scripts ok");
