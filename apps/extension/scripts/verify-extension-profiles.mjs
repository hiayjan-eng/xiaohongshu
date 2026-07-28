import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(extensionRoot, "..", "..");
const previewOrigin = "https://xiaohongshu-git-p0-core-revival-loop-rescue-ayj.vercel.app";
const previewDir = resolve(repoRoot, "release-artifacts", "extension-beta-preview");
const previewZip = resolve(repoRoot, "release-artifacts", "collection-revival-extension-beta-preview-v0.2.4.zip");

function read(path) {
  if (!existsSync(path)) throw new Error(`Missing required file: ${path}`);
  return readFileSync(path, "utf8");
}

const sourceManifest = JSON.parse(read(resolve(extensionRoot, "manifest.json")));
const sourceProfile = read(resolve(extensionRoot, "src", "build-profile.js"));
if (sourceManifest.version !== "0.2.3") throw new Error("Production extension source must remain on 0.2.3.");
if (JSON.stringify(sourceManifest).includes(previewOrigin)) throw new Error("Production extension source must not target Preview.");
if (!sourceProfile.includes('id: "production"') || !sourceProfile.includes("https://xiaohongshu-green.vercel.app/old-import")) throw new Error("Production extension source must keep the production import target.");

const manifest = JSON.parse(read(resolve(previewDir, "manifest.json")));
const profile = read(resolve(previewDir, "src", "build-profile.js"));
const popup = read(resolve(previewDir, "src", "popup.js"));
const background = read(resolve(previewDir, "src", "background.js"));
if (!existsSync(previewZip)) throw new Error("Preview 0.2.4 zip is missing.");
if (manifest.version !== "0.2.4") throw new Error("Preview manifest must be 0.2.4.");
if (!manifest.host_permissions.includes(`${previewOrigin}/*`)) throw new Error("Preview manifest must include the exact Preview origin.");
const bridgeEntry = (manifest.content_scripts || []).find((entry) => (entry.js || []).includes("src/web-bridge.js"));
if (!bridgeEntry?.matches?.includes(`${previewOrigin}/*`)) throw new Error("Preview Web Bridge must match the exact Preview origin.");
if (JSON.stringify(manifest).includes("*.vercel.app")) throw new Error("Preview manifest must not use a wildcard Vercel origin.");
if (!profile.includes("Preview 测试包 0.2.4") || !profile.includes(`${previewOrigin}/old-import`)) throw new Error("Preview build profile must identify the 0.2.4 test package and exact import target.");
if (!popup.includes("BUILD_PROFILE") || !popup.includes("defaultWebAppUrl")) throw new Error("Popup must consume the build profile import target.");
if (!background.includes(`${previewOrigin}/*`) || background.includes("xiaohongshu-green.vercel.app/*")) throw new Error("Preview background bridge must allow only the exact Preview origin.");
console.log("production and Preview extension package profiles ok");