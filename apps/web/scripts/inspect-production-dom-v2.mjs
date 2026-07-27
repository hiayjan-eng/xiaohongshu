import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve("apps/web/test-results/production-smoke-diagnostic");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const report = { inspectedAt: new Date().toISOString(), routes: [] };
try {
  for (const path of ["/", "/import", "/albums", "/search", "/settings", "/settings/data-migration"]) {
    const response = await page.goto(`https://xiaohongshu-green.vercel.app${path}`, { waitUntil: "networkidle" });
    const dom = await page.evaluate(() => ({
      href: location.href, title: document.title,
      rootFirstElement: document.querySelector("#root")?.firstElementChild?.outerHTML.slice(0, 1200) ?? null,
      rootClasses: Array.from(document.querySelector("#root")?.children ?? []).map((element) => element.className),
      mainClasses: Array.from(document.querySelectorAll("main")).map((element) => element.className),
      navClasses: Array.from(document.querySelectorAll("nav")).map((element) => element.className),
      headings: Array.from(document.querySelectorAll("h1,h2")).map((element) => element.textContent?.trim()).filter(Boolean).slice(0, 8),
      buttons: Array.from(document.querySelectorAll("button,a")).map((element) => ({ text: element.textContent?.trim(), href: element.getAttribute("href") })).filter((item) => item.text || item.href).slice(0, 20),
      visibleText: document.body.innerText.slice(0, 800)
    }));
    report.routes.push({ route: path, status: response?.status() ?? null, ...dom });
  }
} finally {
  await context.close();
  await browser.close();
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, "dom-routes.json"), JSON.stringify(report, null, 2));
}
