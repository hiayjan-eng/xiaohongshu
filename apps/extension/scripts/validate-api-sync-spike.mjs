import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const files = ["api-sync/api-sync-core.js", "api-sync/api-sync-idb.js", "api-sync/api-sync-provider.js", "api-sync/api-probe-main.js", "api-sync/api-probe-content.js", "background.js", "sidepanel.js"];
for (const file of files) {
  const path = fileURLToPath(new URL(`../src/${file}`, import.meta.url));
  if (!existsSync(path)) throw new Error(`Missing API sync file: ${file}`);
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
}
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
if (manifest.manifest_version !== 3 || manifest.version_name !== "0.4.3-m0-api-spike") throw new Error("M0 API spike must be MV3 version 0.4.3-m0-api-spike");
if (!manifest.permissions.includes("scripting") || !manifest.permissions.includes("sidePanel") || !manifest.host_permissions.includes("https://www.xiaohongshu.com/*")) throw new Error("Missing required Chromium extension permissions");
const xhs = manifest.content_scripts.find((item) => item.js?.includes("src/api-sync/api-probe-content.js"));
const main = manifest.content_scripts.find((item) => item.js?.includes("src/api-sync/api-probe-main.js"));
if (!xhs || xhs.run_at !== "document_start" || !xhs.matches.includes("https://www.xiaohongshu.com/*")) throw new Error("API probe bridge must target Xiaohongshu at document_start");
if (!main || main.world !== "MAIN" || main.run_at !== "document_start" || !main.matches.includes("https://www.xiaohongshu.com/*")) throw new Error("MAIN probe must persist through reload at document_start");
const background = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
for (const marker of ["targetTabId", "chrome.tabs.get", "M0_API_PROBE_MAIN_READY", "M0_API_PROBE_BRIDGE_READY", "createProbeSession", "M0_API_PROBE_RECORD", "M0_API_SYNC_CONFIRM", "DYNAMIC_SIGNATURE_REQUIRED", "api-sync/api-sync-idb.js"]) if (!background.includes(marker)) throw new Error(`Missing safety marker: ${marker}`);
if (background.includes('files: ["src/api-sync/api-probe-main.js"]')) throw new Error("MAIN probe must not rely on one-shot executeScript injection");
const probe = readFileSync(new URL("../src/api-sync/api-probe-main.js", import.meta.url), "utf8");
for (const forbidden of ["Cookie", "localStorage", "console.log", "Authorization"]) if (probe.includes(forbidden)) throw new Error(`Probe must not persist or print sensitive data: ${forbidden}`);
console.log("M0 API sync spike static validation ok");
