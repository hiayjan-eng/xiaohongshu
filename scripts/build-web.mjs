import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = resolve(rootDir, "apps", "web");

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