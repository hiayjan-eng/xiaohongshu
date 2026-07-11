import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "..", "..", "release-artifacts", "extension-beta");
const srcOut = resolve(outDir, "src");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(srcOut, { recursive: true });

copyFileSync(resolve(root, "manifest.json"), resolve(outDir, "manifest.json"));
for (const file of ["popup.html", "popup.js", "popup.css", "content-script.js"]) {
  copyFileSync(resolve(root, "src", file), resolve(srcOut, file));
}

if (!existsSync(resolve(outDir, "manifest.json")) || !existsSync(resolve(srcOut, "popup.js"))) {
  throw new Error("Extension build failed: missing output files");
}

console.log(`extension beta copied to ${outDir}`);