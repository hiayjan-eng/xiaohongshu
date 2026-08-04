import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const output = resolve(root, "release-artifacts", "extension-beta");
const manifestPath = resolve(output, "manifest.json");
if (!existsSync(manifestPath)) throw new Error("Build output is missing");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.manifest_version !== 3 || manifest.version_name !== "0.5.0-m0-cdp-spike") throw new Error("Chrome/Edge output must be MV3 CDP spike package");
for (const required of ["activeTab", "storage", "sidePanel", "debugger"]) if (!manifest.permissions.includes(required)) throw new Error(`Missing Chromium permission: ${required}`);
if (!manifest.background?.service_worker || !manifest.side_panel?.default_path) throw new Error("Missing service worker or Side Panel");
for (const file of ["src/background.js", "src/sidepanel.js", "src/api-sync/cdp-network-probe.js", "src/api-sync/api-sync-idb.js"]) if (!existsSync(resolve(output, file))) throw new Error(`Missing shared Chromium file: ${file}`);
console.log("Chrome and Edge use the same MV3 unpacked directory");
