import { existsSync, readFileSync } from "node:fs";

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

console.log("extension poc manifest ok");
