const fs = require("node:fs");
const path = require("node:path");

const cacheRoot = path.resolve(__dirname, "../node_modules/.cache/storage-runtime-test");
const scopedRoot = path.join(cacheRoot, "node_modules/@revival");
const packages = ["shared-types", "classification-service", "ai-service", "database", "storage-service"];

fs.mkdirSync(scopedRoot, { recursive: true });
fs.writeFileSync(path.join(cacheRoot, "package.json"), JSON.stringify({ type: "commonjs" }));

for (const packageName of packages) {
  const packageRoot = path.join(scopedRoot, packageName);
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: `@revival/${packageName}`,
      type: "commonjs",
      main: `../../../${packageName}/src/index.js`
    })
  );
}
