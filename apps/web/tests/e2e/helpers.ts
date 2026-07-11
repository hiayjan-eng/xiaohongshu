import { expect, type Page } from "@playwright/test";

export const STORAGE_KEY = "collection-revival-system:v1";
export const ACHIEVEMENT_STORAGE_KEY = "collection-revival-achievements";

export const testNote = {
  sourceUrl: "https://www.xiaohongshu.com/explore/test-revival-note",
  title: "小红书封面设计技巧",
  rawShareText: "收藏一个小红书封面设计教程，适合做内容运营和图文排版参考",
  userNote: "之后做震海会小红书图文时可以参考"
};

type AppState = {
  user: {
    id: string;
    name: string;
    email: string;
    createdAt: string;
  };
  savedItems: Array<{
    id: string;
    sourceUrl: string;
    title: string;
    category: string;
    summary: string;
    keywords: string[];
    entities: Array<{ type: string; value: string }>;
    searchableText: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
  actionCards: Array<{
    id: string;
    savedItemId: string;
    title: string;
    nextAction: string;
    fields: Record<string, string | string[]>;
    tasks: unknown[];
  }>;
  searchLogs: Array<{ query: string; resultCount: number; clickedSavedItemId?: string }>;
  importBatches?: Array<{ id: string; source: string; rawCount: number; importedCount: number; duplicateCount: number; failedCount: number; createdActionCardCount: number; createdAlbumCount: number; status: string }>;
  importBatchItems?: Array<{ id: string; batchId: string; status: string; sourceUrl: string; title: string }>;
  smartAlbums?: Array<{ id: string; title: string; status: string; savedItemIds: string[] }>;
};

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/favicon|net::ERR_ABORTED|status of 404|404 \(Not Found\)/i.test(text)) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

export async function expectNoConsoleErrors(errors: string[]) {
  expect(errors, `Unexpected browser console errors:\n${errors.join("\n")}`).toEqual([]);
}

export async function readAppState(page: Page): Promise<AppState> {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || "null"), STORAGE_KEY);
}

export async function readAchievements(page: Page): Promise<Record<string, string>> {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || "{}"), ACHIEVEMENT_STORAGE_KEY);
}

export async function resetDemoData(page: Page) {
  await page.goto("/qa");
  await expect(page.getByRole("heading", { name: "7 天稳定性检查面板" })).toBeVisible();
  await page.getByTestId("qa-reset-demo").click();
  await expect.poll(async () => (await readAppState(page)).savedItems.length).toBeGreaterThanOrEqual(20);
  await expect.poll(async () => (await readAppState(page)).actionCards.length).toBeGreaterThanOrEqual(20);
}

export async function importTestNote(page: Page, note = testNote) {
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "把旧收藏和新收藏，都放回行动里" })).toBeVisible();
  await page.getByTestId("import-source-url").fill(note.sourceUrl);
  await page.getByTestId("import-title").fill(note.title);
  await page.getByTestId("import-raw-share-text").fill(note.rawShareText);
  await page.getByTestId("import-user-note").fill(note.userNote);
  await page.getByTestId("import-submit").click();
  await expect(page.getByText("行动卡").first()).toBeVisible();

  await expect.poll(async () => {
    const state = await readAppState(page);
    return state.savedItems.some((item) => item.sourceUrl === note.sourceUrl);
  }).toBe(true);

  const state = await readAppState(page);
  const item = state.savedItems.find((entry) => entry.sourceUrl === note.sourceUrl);
  expect(item).toBeTruthy();
  return item!;
}

export async function installWindowOpenSpy(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__openedUrls", {
      value: [],
      writable: true,
      configurable: true
    });
    window.open = ((url?: string | URL) => {
      (window as unknown as { __openedUrls: string[] }).__openedUrls.push(String(url ?? ""));
      return null;
    }) as typeof window.open;
  });
}

export async function getOpenedUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __openedUrls?: string[] }).__openedUrls ?? []);
}

export async function seedEmptyState(page: Page) {
  await page.addInitScript((key) => {
    const emptyState = {
      user: {
        id: "user_local_001",
        name: "本地用户",
        email: "local@revival.app",
        createdAt: "2026-07-06T00:00:00.000Z"
      },
      savedItems: [],
      actionCards: [],
      searchLogs: []
    };
    window.localStorage.setItem(key, JSON.stringify(emptyState));
    window.localStorage.removeItem("collection-revival-achievements");
  }, STORAGE_KEY);
}

