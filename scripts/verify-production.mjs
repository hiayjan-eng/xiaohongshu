const baseUrl = process.env.PRODUCTION_URL || "https://xiaohongshu-green.vercel.app";
const timeoutMs = Number(process.env.PRODUCTION_VERIFY_TIMEOUT_MS || 15000);

const routes = [
  "/",
  "/dashboard",
  "/import",
  "/albums",
  "/old-import",
  "/qa",
  "/real-test",
  "/search",
  "/settings"
];

const expectedTitle = "收藏复活系统";

async function verifyRoute(route) {
  const url = new URL(route, baseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);

  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal });
    const text = await response.text();
    const isHtml = response.headers.get("content-type")?.includes("text/html");
    const hasAppRoot = text.includes('<div id="root"></div>');
    const hasTitle = text.includes(`<title>${expectedTitle}</title>`);

    return {
      route,
      url,
      status: response.status,
      ok: response.ok && Boolean(isHtml) && hasAppRoot && hasTitle,
      contentType: response.headers.get("content-type") || "",
      error: ""
    };
  } catch (error) {
    return {
      route,
      url,
      status: 0,
      ok: false,
      contentType: "",
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all(routes.map(verifyRoute));
const failed = results.filter((result) => !result.ok);

for (const result of results) {
  const marker = result.ok ? "OK" : "FAIL";
  const detail = result.error || `${result.status} ${result.contentType}`;
  console.log(`${marker} ${result.route} ${detail}`);
}

if (failed.length > 0) {
  console.error("\nProduction verification failed:");
  for (const result of failed) {
    const reason = result.error || `status ${result.status}`;
    console.error(`- ${result.route} (${result.url}): ${reason}`);
  }
  process.exit(1);
}

console.log(`\nProduction verification passed for ${results.length} routes at ${baseUrl}`);