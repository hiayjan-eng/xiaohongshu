import { expect, test } from "@playwright/test";
import { STORAGE_KEY } from "./helpers";

const VALID_STATE = JSON.stringify({
  schemaVersion: 3,
  user: { id: "runtime-user", name: "Runtime 用户", email: "runtime@example.test", createdAt: "2026-07-18T00:00:00.000Z" },
  savedItems: [],
  actionCards: [],
  planCards: [],
  classificationCorrections: [],
  searchLogs: [],
  smartAlbums: [],
  importBatches: [],
  importBatchItems: []
});

test.describe("Task 8A async localStorage bootstrap", () => {
  test("valid legacy state hydrates without a first-render write or IndexedDB access", async ({ page }) => {
    await page.addInitScript(({ key, raw }) => {
      window.localStorage.setItem(key, raw);
      const originalSet = Storage.prototype.setItem;
      const originalOpen = indexedDB.open.bind(indexedDB);
      Object.defineProperty(window, "__runtimeWrites", { value: [], writable: true });
      Object.defineProperty(window, "__indexedDbOpenCount", { value: 0, writable: true });
      Storage.prototype.setItem = function (storageKey, value) {
        (window as unknown as { __runtimeWrites: string[] }).__runtimeWrites.push(String(storageKey));
        return originalSet.call(this, storageKey, value);
      };
      indexedDB.open = function (...args) {
        (window as unknown as { __indexedDbOpenCount: number }).__indexedDbOpenCount += 1;
        return originalOpen(...args);
      } as typeof indexedDB.open;
    }, { key: STORAGE_KEY, raw: VALID_STATE });

    await page.goto("/dashboard");
    await expect(page.getByText("Runtime 用户")).toBeVisible();
    const result = await page.evaluate((key) => ({
      raw: window.localStorage.getItem(key),
      writes: (window as unknown as { __runtimeWrites: string[] }).__runtimeWrites,
      indexedDbOpenCount: (window as unknown as { __indexedDbOpenCount: number }).__indexedDbOpenCount
    }), STORAGE_KEY);
    expect(result.raw).toBe(VALID_STATE);
    expect(result.writes).toEqual([]);
    expect(result.indexedDbOpenCount).toBe(0);
  });

  test("missing state renders the current product without seeding localStorage", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator(".app-shell")).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  });

  test("corrupt JSON is degraded and remains byte-for-byte unchanged", async ({ page }) => {
    await page.addInitScript((key) => window.localStorage.setItem(key, "{broken-json"), STORAGE_KEY);
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-boot-degraded")).toBeVisible();
    await expect(page.getByRole("heading", { name: "本地数据需要检查" })).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBe("{broken-json");
    await expect(page.locator(".app-shell")).toHaveCount(0);
  });

  test("unsupported schema is blocked without overwriting the source", async ({ page }) => {
    const raw = JSON.stringify({ ...JSON.parse(VALID_STATE), schemaVersion: 999 });
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), { key: STORAGE_KEY, value: raw });
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-boot-degraded")).toBeVisible();
    await page.getByText("查看安全错误码").click();
    await expect(page.getByText("RUNTIME_SCHEMA_UNSUPPORTED").first()).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBe(raw);
  });

  test("storage read failure shows a safe failed screen and never persists", async ({ page }) => {
    await page.addInitScript((key) => {
      const originalGet = Storage.prototype.getItem;
      const originalSet = Storage.prototype.setItem;
      Object.defineProperty(window, "__runtimeWrites", { value: 0, writable: true });
      Storage.prototype.getItem = function (storageKey) {
        if (storageKey === key) throw new DOMException("private note token=secret", "SecurityError");
        return originalGet.call(this, storageKey);
      };
      Storage.prototype.setItem = function (storageKey, value) {
        (window as unknown as { __runtimeWrites: number }).__runtimeWrites += 1;
        return originalSet.call(this, storageKey, value);
      };
    }, STORAGE_KEY);
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-boot-failed")).toBeVisible();
    await expect(page.getByRole("heading", { name: "暂时无法打开本地收藏" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("token=secret");
    expect(await page.evaluate(() => (window as unknown as { __runtimeWrites: number }).__runtimeWrites)).toBe(0);
  });

  test("write failure is visible and does not claim success", async ({ page }) => {
    await page.addInitScript(({ key, raw }) => {
      window.localStorage.setItem(key, raw);
      const originalSet = Storage.prototype.setItem;
      Object.defineProperty(window, "__failRuntimeWrites", { value: false, writable: true });
      Storage.prototype.setItem = function (storageKey, value) {
        if ((window as unknown as { __failRuntimeWrites: boolean }).__failRuntimeWrites) {
          throw new DOMException("quota", "QuotaExceededError");
        }
        return originalSet.call(this, storageKey, value);
      };
    }, { key: STORAGE_KEY, raw: VALID_STATE });
    await page.goto("/settings");
    await expect(page.getByTestId("theme-dawn")).toBeVisible();
    await page.evaluate(() => { (window as unknown as { __failRuntimeWrites: boolean }).__failRuntimeWrites = true; });
    await page.getByTestId("theme-dawn").click();
    await expect(page.getByTestId("runtime-save-error")).toBeVisible();
    await expect(page.getByTestId("runtime-save-error")).toContainText("这次修改还没有保存");
  });

  test("rapid product-setting updates leave the newest value persisted", async ({ page }) => {
    await page.addInitScript(({ key, raw }) => window.localStorage.setItem(key, raw), { key: STORAGE_KEY, raw: VALID_STATE });
    await page.goto("/settings");
    await page.getByTestId("theme-dawn").click();
    await page.getByTestId("theme-mist-blue").click();
    await page.getByTestId("theme-lavender-mint").click();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("collection-revival-theme"))).toBe("lavender-mint");
  });

  test("direct migration route bypasses normal AppState bootstrap", async ({ page }) => {
    await page.addInitScript((key) => {
      Storage.prototype.getItem = function (storageKey) {
        if (storageKey === key) throw new Error("normal boot should not read main state");
        return null;
      };
    }, STORAGE_KEY);
    await page.goto("/settings/data-migration");
    await expect(page.getByTestId("migration-inspection-step")).toBeVisible();
    await expect(page.getByTestId("app-boot-failed")).toHaveCount(0);
  });
});
