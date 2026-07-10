import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = resolve(rootDir, "apps", "web");
const webDistDir = resolve(webDir, "dist");
const rootDistDir = resolve(rootDir, "dist");

function runNodeScript(label, scriptPath, args = []) {
  if (!existsSync(scriptPath)) {
    console.error(`[build-web] Missing ${label}: ${scriptPath}`);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: webDir,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[build-web] Failed to start ${label}:`, result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runNodeScript("TypeScript", resolve(webDir, "node_modules", "typescript", "bin", "tsc"), [
  "-p",
  "tsconfig.json",
  "--noEmit",
]);
runNodeScript("Vite", resolve(webDir, "node_modules", "vite", "bin", "vite.js"), ["build"]);

if (!existsSync(resolve(webDistDir, "index.html"))) {
  console.error(`[build-web] Missing Vite output: ${webDistDir}`);
  process.exit(1);
}

await rm(rootDistDir, { recursive: true, force: true });
await cp(webDistDir, rootDistDir, { recursive: true });

const hostingConfig = resolve(rootDir, ".openai", "hosting.json");
if (existsSync(hostingConfig)) {
  await mkdir(resolve(rootDistDir, ".openai"), { recursive: true });
  await cp(hostingConfig, resolve(rootDistDir, ".openai", "hosting.json"));
}

await writeFile(resolve(rootDistDir, "_redirects"), "/* /index.html 200\n", "utf8");
await writeFile(resolve(rootDistDir, "404.html"), await import("node:fs/promises").then((fs) => fs.readFile(resolve(rootDistDir, "index.html"), "utf8")), "utf8");
console.log(`[build-web] Copied static site to ${rootDistDir}`);