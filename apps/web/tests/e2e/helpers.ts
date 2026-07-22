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
    contentDomain?: string;
    contentSubDomain?: string;
    savedIntent?: string;
    confidence?: string;
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
  planCards?: Array<{
    id: string;
    savedItemId: string;
    actionCardId: string;
    title: string;
    sourceTitle?: string;
    plannedDate: string;
    estimatedMinutes: number;
    oneNextStep: string;
    doneCriteria?: string;
    status: string;
    cancelledAt?: string;
  }>;
  classificationCorrections?: Array<{ id: string; savedItemId: string; correctedDomain: string; correctedSubDomain: string }>;
  searchLogs: Array<{ query: string; resultCount: number; clickedSavedItemId?: string }>;
  importBatches?: Array<{ id: string; source: string; rawCount: number; importedCount: number; duplicateCount: number; failedCount: number; createdActionCardCount: number; createdAlbumCount: number; status: string }>;
  importBatchItems?: Array<{ id: string; batchId: string; status: string; sourceUrl: string; title: string }>;
  smartAlbums?: Array<{
    id: string;
    title: string;
    status: string;
    confirmedAt?: string;
    archivedAt?: string;
    autoCollectEnabled?: boolean;
    mediumMatchRequiresApproval?: boolean;
    savedItemIds: string[];
    suggestedItemIds?: string[];
    manuallyRemovedItemIds?: string[];
    matchProfile?: { contentDomain?: string; contentSubDomain?: string; savedIntent?: string; keywords?: string[] };
    albumView?: string;
    savedIntent?: string;
    contentDomain?: string;
  }>;
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
  await page.getByTestId("qa-reset-demo").click({ force: true });
  await expect.poll(async () => (await readAppState(page)).savedItems.length).toBeGreaterThanOrEqual(20);
  await expect.poll(async () => (await readAppState(page)).actionCards.length).toBeGreaterThanOrEqual(0);
}

export async function importTestNote(page: Page, note = testNote) {
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "先扫描旧收藏，再补充导入新收藏" })).toBeVisible();
  await page.getByTestId("import-source-url").fill(note.sourceUrl);
  await page.getByTestId("import-title").fill(note.title);
  await page.getByTestId("import-raw-share-text").fill(note.rawShareText);
  await page.getByTestId("import-user-note").fill(note.userNote);
  await submitQuickImportForm(page);
  await expect(page.getByTestId("import-success-panel")).toContainText("整理完成");

  await expect.poll(async () => {
    const state = await readAppState(page);
    return state.savedItems.some((item) => item.sourceUrl === note.sourceUrl);
  }).toBe(true);

  const state = await readAppState(page);
  const item = state.savedItems.find((entry) => entry.sourceUrl === note.sourceUrl);
  expect(item).toBeTruthy();
  return item!;
}

export async function submitQuickImportForm(page: Page) {
  await page.getByTestId("quick-import-form").evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
  });
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


export async function reviveImportedItem(page: Page, itemId: string) {
  const reviveButton = page.getByTestId("revive-imported-item");
  await expect(reviveButton).toBeAttached();
  await expect(reviveButton).toBeVisible();
  await expect(reviveButton).toBeEnabled();
  await reviveButton.scrollIntoViewIfNeeded();
  await reviveButton.click({ trial: true });
  const box = await reviveButton.boundingBox();
  if (!box) throw new Error("Imported item revive button has no clickable bounding box.");
  await Promise.all([
    expect(reviveButton).toHaveCount(0),
    (async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();
    })()
  ]);
  await expect.poll(async () => {
    const state = await readAppState(page);
    return state.actionCards.some((card) => card.savedItemId === itemId);
  }).toBe(true);
  const state = await readAppState(page);
  return state.actionCards.find((card) => card.savedItemId === itemId)!;
}
