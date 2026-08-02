import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..", "..");
const args = process.argv.slice(2);
const isLegacyPreview = args.includes("--preview");
const isM0Preview = args.includes("--m0-preview");
const originArg = args.find((arg) => arg.startsWith("--preview-origin="));
const unsupportedArgs = args.filter((arg) => arg !== "--preview" && arg !== "--m0-preview" && !arg.startsWith("--preview-origin="));
if (unsupportedArgs.length) throw new Error(`Unsupported extension build option: ${unsupportedArgs.join(", ")}`);
if (isLegacyPreview && isM0Preview) throw new Error("Choose only one Preview build profile.");

const sourceManifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const legacyPreviewOrigin = "https://xiaohongshu-git-p0-core-revival-loop-rescue-ayj.vercel.app";
const m0PreviewOrigin = isM0Preview ? validatePreviewOrigin(originArg?.slice("--preview-origin=".length) || "") : "";
const profile = isM0Preview
  ? {
      id: "m0-preview",
      label: "M0 全量扫描 Preview 0.3.3",
      version: "0.3.3",
      versionName: "0.3.3-m0-preview",
      defaultWebAppUrl: `${m0PreviewOrigin}/m0-preview/`,
      webAppOrigins: [m0PreviewOrigin],
      outDirName: "extension-m0-full-scan-preview",
      zipFileName: "collection-revival-extension-m0-full-scan-preview-v0.3.3.zip"
    }
  : isLegacyPreview
    ? {
        id: "p0-preview",
        label: "Preview 测试包 0.2.4",
        version: "0.2.4",
        versionName: "0.2.4-preview",
        defaultWebAppUrl: `${legacyPreviewOrigin}/old-import`,
        webAppOrigins: [legacyPreviewOrigin],
        outDirName: "extension-beta-preview",
        zipFileName: "collection-revival-extension-beta-preview-v0.2.4.zip"
      }
    : {
        id: "production",
        label: "Production Beta",
        version: sourceManifest.version,
        versionName: sourceManifest.version_name || sourceManifest.version,
        defaultWebAppUrl: "https://xiaohongshu-green.vercel.app/old-import",
        webAppOrigins: ["https://xiaohongshu-green.vercel.app", "http://localhost:5173", "http://127.0.0.1:5173"],
        outDirName: "extension-beta",
        zipFileName: `collection-revival-extension-beta-v${sourceManifest.version}.zip`
      };

const outDir = resolve(repoRoot, "release-artifacts", profile.outDirName);
const srcOut = resolve(outDir, "src");
const zipPath = resolve(repoRoot, "release-artifacts", profile.zipFileName);
const buildProfilePath = resolve(srcOut, "build-profile.js");

rmSync(outDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(srcOut, { recursive: true });

const outputManifest = buildManifest(sourceManifest, profile, isM0Preview);
writeFileSync(resolve(outDir, "manifest.json"), `${JSON.stringify(outputManifest, null, 2)}\n`);

for (const file of [
  "popup.html", "popup.js", "popup.css", "sidepanel.html", "sidepanel.js", "sidepanel.css",
  "web-bridge.js", "xhs-scanner.js", "full-scan-core.js", "full-scan-content.js",
  "full-scan-idb.js", "background.js", "build-profile.js"
]) copyFileSync(resolve(root, "src", file), resolve(srcOut, file));

writeFileSync(buildProfilePath, `globalThis.__COLLECTION_REVIVAL_BUILD_PROFILE__ = ${JSON.stringify({
  id: profile.id,
  label: profile.label,
  versionName: profile.versionName,
  defaultWebAppUrl: profile.defaultWebAppUrl,
  webAppOrigins: profile.webAppOrigins
}, null, 2)};\n`);

if (!existsSync(resolve(outDir, "manifest.json")) || !existsSync(resolve(srcOut, "sidepanel.js")) || !existsSync(buildProfilePath)) {
  throw new Error("Extension build failed: missing output files");
}

execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force`], { stdio: "inherit" });
console.log(`${profile.label} copied to ${outDir}`);
console.log(`extension zip created at ${zipPath}`);

function buildManifest(manifest, currentProfile, m0) {
  const output = structuredClone(manifest);
  output.version = currentProfile.version;
  output.version_name = currentProfile.versionName;
  if (m0) {
    output.name = "收藏复活 M0 全量扫描 Preview";
    output.description = "在严格确认本人小红书收藏笔记页后，自动滚动、流式保存、恢复、复核并批次导入独立 M0 Preview。";
    output.action = { default_title: "打开收藏复活 M0 全量扫描 Preview" };
    output.host_permissions = [
      "https://www.xiaohongshu.com/*",
      "https://xiaohongshu.com/*",
      `${currentProfile.webAppOrigins[0]}/*`
    ];
    output.content_scripts = [
      {
        matches: [`${currentProfile.webAppOrigins[0]}/*`],
        js: ["src/build-profile.js", "src/web-bridge.js"],
        run_at: "document_start"
      },
      {
        matches: ["https://www.xiaohongshu.com/*", "https://xiaohongshu.com/*"],
        js: ["src/full-scan-core.js", "src/xhs-scanner.js", "src/full-scan-content.js"],
        run_at: "document_idle"
      }
    ];
  } else if (currentProfile.id === "p0-preview") {
    output.version = currentProfile.version;
    output.version_name = currentProfile.versionName;
    output.name = "收藏复活扫描 Preview 测试包";
    output.host_permissions = [...new Set([...(output.host_permissions || []), `${currentProfile.webAppOrigins[0]}/*`])];
    output.content_scripts = (output.content_scripts || []).map((entry) => {
      if (!(entry.js || []).includes("src/web-bridge.js")) return entry;
      return { ...entry, matches: [...new Set([...(entry.matches || []), `${currentProfile.webAppOrigins[0]}/*`])] };
    });
  }
  return output;
}

function validatePreviewOrigin(value) {
  if (!value) throw new Error("--m0-preview requires --preview-origin=https://<exact-preview-host>");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || value.includes("*")) {
    throw new Error("M0 Preview origin must be one exact HTTPS origin without a path or wildcard.");
  }
  if (!url.hostname.endsWith(".vercel.app")) throw new Error("M0 Preview origin must be a Vercel Preview origin.");
  if (url.hostname === "xiaohongshu-green.vercel.app") throw new Error("Production origin is forbidden for the M0 Preview build.");
  return url.origin;
}
