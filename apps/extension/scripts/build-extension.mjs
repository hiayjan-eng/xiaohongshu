import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..", "..");
const outDir = resolve(repoRoot, "release-artifacts", "extension-beta");
const srcOut = resolve(outDir, "src");
const zipPath = resolve(repoRoot, "release-artifacts", "collection-revival-extension-beta.zip");
const webDownloadDir = resolve(repoRoot, "apps", "web", "public", "downloads");
const webZipPath = resolve(webDownloadDir, "collection-revival-extension-beta.zip");

rmSync(outDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(srcOut, { recursive: true });
mkdirSync(webDownloadDir, { recursive: true });

copyFileSync(resolve(root, "manifest.json"), resolve(outDir, "manifest.json"));
for (const file of ["popup.html", "popup.js", "popup.css", "content-script.js"]) {
  copyFileSync(resolve(root, "src", file), resolve(srcOut, file));
}

if (!existsSync(resolve(outDir, "manifest.json")) || !existsSync(resolve(srcOut, "popup.js"))) {
  throw new Error("Extension build failed: missing output files");
}

execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force`], { stdio: "inherit" });
copyFileSync(zipPath, webZipPath);

console.log(`extension beta copied to ${outDir}`);
console.log(`extension beta zip created at ${zipPath}`);
console.log(`web download copied to ${webZipPath}`);