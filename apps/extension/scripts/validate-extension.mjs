import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const requiredFiles = [
  "manifest.json",
  "src/popup.html",
  "src/popup.js",
  "src/popup.css",
  "src/content-script.js"
];

for (const file of requiredFiles) {
  if (!existsSync(new URL(`../${file}`, import.meta.url))) {
    throw new Error(`Missing extension file: ${file}`);
  }
}

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Extension must use Manifest V3");
if (!manifest.permissions.includes("activeTab")) throw new Error("activeTab permission is required for user-triggered scanning");
if (!manifest.permissions.includes("scripting")) throw new Error("scripting permission is required for programmatic content script injection");
if (!manifest.permissions.includes("downloads")) throw new Error("downloads permission is required for JSON export");
const contentMatches = manifest.content_scripts?.flatMap((entry) => entry.matches || []) || [];
if (!contentMatches.includes("https://xiaohongshu-green.vercel.app/*")) throw new Error("Web handshake content script match is required");

execFileSync(process.execPath, ["--check", fileURLToPath(new URL("../src/popup.js", import.meta.url))], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", fileURLToPath(new URL("../src/content-script.js", import.meta.url))], { stdio: "inherit" });
const popupJs = readFileSync(new URL("../src/popup.js", import.meta.url), "utf8");
const contentScript = readFileSync(new URL("../src/content-script.js", import.meta.url), "utf8");
const popupMarkers = ["CHECKPOINT_KEY", "pauseScan", "resumeScan", "browser-extension-beta", "autoScrollToggle", "clearCheckpoint"];
const contentMarkers = ["REVIVAL_GET_PAGE_STATUS", "REVIVAL_SCAN_STEP", "scrollOneStep", "blocked", "验证码", "COLLECTION_REVIVAL_EXTENSION_READY", "COLLECTION_REVIVAL_EXTENSION_PING"];
for (const marker of popupMarkers) {
  if (!popupJs.includes(marker)) throw new Error(`Missing popup beta capability marker: ${marker}`);
}
for (const marker of contentMarkers) {
  if (!contentScript.includes(marker)) throw new Error(`Missing content script beta capability marker: ${marker}`);
}

console.log("extension beta manifest and scripts ok");