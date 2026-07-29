import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..", "..");
const isPreview = process.argv.includes("--preview");
const unsupportedArgs = process.argv.slice(2).filter((arg) => arg !== "--preview");
if (unsupportedArgs.length) throw new Error(`Unsupported extension build option: ${unsupportedArgs.join(", ")}`);

const previewOrigin = "https://xiaohongshu-git-v01-core-library-release-ayj.vercel.app";
const sourceManifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const profile = isPreview
  ? {
      id: "v0.1-phase2-preview",
      label: "Preview 测试包 0.2.5-preview",
      version: "0.2.5",
      defaultWebAppUrl: `${previewOrigin}/old-import`,
      webAppOrigins: [previewOrigin],
      outDirName: "extension-beta-preview-v0.2.5",
      zipFileName: "collection-revival-extension-beta-preview-v0.2.5.zip"
    }
  : {
      id: "production",
      label: "Production Beta",
      version: sourceManifest.version,
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

const outputManifest = structuredClone(sourceManifest);
if (isPreview) {
  outputManifest.version = profile.version;
  outputManifest.name = "收藏复活扫描 Preview 测试包";
  outputManifest.host_permissions = [...new Set([...(outputManifest.host_permissions || []), `${previewOrigin}/*`])];
  outputManifest.content_scripts = (outputManifest.content_scripts || []).map((entry) => {
    if (!(entry.js || []).includes("src/web-bridge.js")) return entry;
    return { ...entry, matches: [...new Set([...(entry.matches || []), `${previewOrigin}/*`])] };
  });
}
writeFileSync(resolve(outDir, "manifest.json"), `${JSON.stringify(outputManifest, null, 2)}\n`);

for (const file of ["popup.html", "popup.js", "popup.css", "web-bridge.js", "xhs-scanner.js", "background.js", "build-profile.js"]) {
  copyFileSync(resolve(root, "src", file), resolve(srcOut, file));
}

if (isPreview) {
  writeFileSync(buildProfilePath, `globalThis.__COLLECTION_REVIVAL_BUILD_PROFILE__ = ${JSON.stringify({
    id: profile.id,
    label: profile.label,
    defaultWebAppUrl: profile.defaultWebAppUrl,
    webAppOrigins: profile.webAppOrigins
  }, null, 2)};\n`);
  const backgroundPath = resolve(srcOut, "background.js");
  const background = readFileSync(backgroundPath, "utf8").replace(
    /const WEB_APP_URL_PATTERNS = \[[\s\S]*?\];/,
    `const WEB_APP_URL_PATTERNS = ${JSON.stringify([`${previewOrigin}/*`], null, 2)};`
  );
  writeFileSync(backgroundPath, background);
}

if (!existsSync(resolve(outDir, "manifest.json")) || !existsSync(resolve(srcOut, "popup.js")) || !existsSync(buildProfilePath)) {
  throw new Error("Extension build failed: missing output files");
}

execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force`], { stdio: "inherit" });
console.log(`${profile.label} copied to ${outDir}`);
console.log(`extension zip created at ${zipPath}`);