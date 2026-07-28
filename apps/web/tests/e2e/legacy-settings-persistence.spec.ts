import { expect, test, type Page } from "@playwright/test";
import { ACHIEVEMENT_STORAGE_KEY, readAppState, STORAGE_KEY } from "./helpers";

const THEME_KEY = "collection-revival-theme";
const MARKER_KEY = "collection-revival-storage-bootstrap:v1";
const NOW = "2026-07-27T00:00:00.000Z";

const LEGACY_FIXTURE = {
  schemaVersion: 3,
  user: { id: "legacy-theme-fixture-user", name: "Legacy Theme Fixture", email: "fixture@example.invalid", createdAt: NOW },
  savedItems: [{
    id: "legacy-theme-fixture-item", userId: "legacy-theme-fixture-user", sourcePlatform: "fixture", sourceUrl: "https://fixture.invalid/legacy-theme",
    rawShareText: "legacy theme fixture", rawTitle: "Legacy theme fixture favorite", cleanedTitle: "Legacy theme fixture favorite", displayTitle: "Legacy theme fixture favorite",
    textNormalizationVersion: 3, title: "Legacy theme fixture favorite", userNote: "Synthetic fixture only", contentDomain: "AI 与效率", contentSubDomain: "工具",
    savedIntent: "想学习", secondaryIntents: [], confidence: "high", whyThisDomain: "fixture", whyThisIntent: "fixture", category: "AI 与效率",
    subCategory: "工具", classificationConfidence: "high", intent: "学习", whyThisCategory: "fixture", summary: "Synthetic fixture only",
    keywords: ["legacy", "theme"], entities: [], searchableText: "legacy theme fixture", status: "not_started", createdAt: NOW, updatedAt: NOW
  }],
  actionCards: [], planCards: [], classificationCorrections: [], searchLogs: [], smartAlbums: [], importBatches: [], importBatchItems: [],
  // This obsolete snapshot is deliberately conflicting: the standalone theme key is the only legacy settings authority.
  settings: { themeId: "lavender-mint" }
};

async function seedOnceThenReload(page: Page, themeId: "dawn" | "lavender-mint") {
  // Do not use addInitScript: it would re-seed old data on every reload and hide the real hydrate behavior.
  await page.goto("/settings");
  await page.evaluate(({ state, themeId }) => {
    window.localStorage.setItem("collection-revival-system:v1", JSON.stringify(state));
    window.localStorage.setItem("collection-revival-theme", themeId);
    window.localStorage.setItem("collection-revival-achievements", JSON.stringify({ first_revival: "2026-07-27T00:00:00.000Z" }));
  }, { state: LEGACY_FIXTURE, themeId });
  await page.reload();
}

async function assertNoActivationStorage(page: Page) {
  await expect.poll(() => page.evaluate(async () => ({
    marker: window.localStorage.getItem("collection-revival-storage-bootstrap:v1"),
    databases: typeof indexedDB.databases === "function" ? await indexedDB.databases() : []
  }))).toEqual({ marker: null, databases: [] });
}

async function selectThemeWhenReady(page: Page, currentThemeId: "dawn" | "lavender-mint", nextThemeId: "dawn" | "lavender-mint") {
  await expect(page.getByTestId(`theme-${currentThemeId}`)).toHaveAttribute("aria-pressed", "true");
  const nextTheme = page.getByTestId(`theme-${nextThemeId}`);
  await expect(nextTheme).toBeVisible();
  await expect(nextTheme).toBeEnabled();
  await nextTheme.click({ trial: true });
  await nextTheme.click();
}

test.describe("Legacy settings authority", () => {
  test("uses the standalone theme key over an obsolete app-state settings snapshot", async ({ page }) => {
    await seedOnceThenReload(page, "dawn");
    await expect(page.getByTestId("theme-dawn")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dawn");
    expect(await page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY)).toBe("dawn");
    expect((await readAppState(page)).savedItems[0]?.id).toBe("legacy-theme-fixture-item");
    expect(await page.evaluate((key) => window.localStorage.getItem(key), ACHIEVEMENT_STORAGE_KEY)).toContain("first_revival");
  });

  test("persists a legacy fixture theme change through refresh without overwriting state or achievements", async ({ page }) => {
    await seedOnceThenReload(page, "lavender-mint");
    await selectThemeWhenReady(page, "lavender-mint", "dawn");
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("collection-revival-theme"))).toBe("dawn");
    await page.reload();
    await expect(page.getByTestId("theme-dawn")).toHaveAttribute("aria-pressed", "true");
    expect((await readAppState(page)).user.id).toBe("legacy-theme-fixture-user");
    expect((await readAppState(page)).savedItems.map((item) => item.id)).toContain("legacy-theme-fixture-item");
    expect(await page.evaluate((key) => window.localStorage.getItem(key), ACHIEVEMENT_STORAGE_KEY)).toContain("first_revival");
    await assertNoActivationStorage(page);
  });

  test("persists an empty new-user theme change through refresh without creating activation storage", async ({ page }) => {
    await page.goto("/settings");
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();
    await page.getByTestId("theme-dawn").click();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("collection-revival-theme"))).toBe("dawn");
    await page.reload();
    await expect(page.getByTestId("theme-dawn")).toHaveAttribute("aria-pressed", "true");
    await assertNoActivationStorage(page);
  });
});
