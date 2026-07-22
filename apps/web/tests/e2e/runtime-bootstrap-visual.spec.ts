import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { STORAGE_KEY } from "./helpers";

const screenshotDirectory = path.resolve(process.cwd(), "test-results/task8a-runtime-bootstrap");
const expectNoHorizontalOverflow = async (page: import("@playwright/test").Page) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
};
const READY_STATE = JSON.stringify({
  schemaVersion: 3,
  user: { id: "visual", name: "本地用户", email: "visual@example.test", createdAt: "2026-07-18T00:00:00.000Z" },
  savedItems: [], actionCards: [], planCards: [], classificationCorrections: [], searchLogs: [], smartAlbums: [], importBatches: [], importBatchItems: []
});

test.beforeAll(() => mkdirSync(screenshotDirectory, { recursive: true }));

test("captures Task 8A desktop boot states", async ({ page }) => {
  await page.addInitScript(({ key, raw }) => {
    window.localStorage.setItem(key, raw);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    Object.defineProperty(window, "__REVIVAL_RUNTIME_BOOT_GATE__", { value: gate, configurable: true });
    Object.defineProperty(window, "__releaseRuntimeBoot", { value: release, configurable: true });
  }, { key: STORAGE_KEY, raw: READY_STATE });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("app-boot-loading")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-1440-loading.png"), fullPage: true });
  await page.evaluate(() => (window as unknown as { __releaseRuntimeBoot: () => void }).__releaseRuntimeBoot());
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-1440-ready.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId("app-boot-loading")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(screenshotDirectory, "mobile-390-loading.png"), fullPage: true });
  await page.evaluate(() => (window as unknown as { __releaseRuntimeBoot: () => void }).__releaseRuntimeBoot());
  await expect(page.locator(".app-shell")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(screenshotDirectory, "mobile-390-ready.png"), fullPage: true });

});

test("captures Task 8A desktop degraded and failed states", async ({ page }) => {
  await page.addInitScript((key) => window.localStorage.setItem(key, "{broken-json"), STORAGE_KEY);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("app-boot-degraded")).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-1440-degraded.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(screenshotDirectory, "mobile-390-degraded.png"), fullPage: true });
});

test("captures Task 8A desktop failed state", async ({ page }) => {
  await page.addInitScript((key) => {
    const originalGet = Storage.prototype.getItem;
    Object.defineProperty(window, "__failRuntimeRead", { value: true, writable: true });
    Storage.prototype.getItem = function (storageKey) {
      if (storageKey === key && (window as unknown as { __failRuntimeRead: boolean }).__failRuntimeRead) throw new DOMException("blocked", "SecurityError");
      return originalGet.call(this, storageKey);
    };
  }, STORAGE_KEY);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("app-boot-failed")).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-1440-failed.png"), fullPage: true });
});
