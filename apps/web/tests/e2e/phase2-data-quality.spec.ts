import { expect, test } from "@playwright/test";
import { analyzeSourceUrl, diagnoseSavedItems, getPreferredSourceUrl, normalizeSavedContent } from "@revival/database";
import { processImportBatch } from "@revival/import-service";
import { readAppState, STORAGE_KEY, submitQuickImportForm } from "./helpers";

const NOTE_ID = "phase2note000001";
const OTHER_NOTE_ID = "phase2note000002";

function noteUrl(noteId: string, token: string) {
  return `https://www.xiaohongshu.com/discovery/item/${noteId}?xsec_token=${token}&xsec_source=pc_collect`;
}

test.describe("V0.1 Phase 2 data quality", () => {
  test("extracts sourceId, canonicalizes note URLs, and rejects profile IDs", () => {
    const first = analyzeSourceUrl(noteUrl(NOTE_ID, "masked-a"));
    const second = analyzeSourceUrl(noteUrl(NOTE_ID, "masked-b"));
    expect(first.status).toBe("valid");
    expect(first.sourceId).toBe(NOTE_ID);
    expect(first.canonicalSourceUrl).toContain(`/explore/${NOTE_ID}`);
    expect(second.sourceId).toBe(first.sourceId);
    expect(getPreferredSourceUrl({ sourceUrl: noteUrl(NOTE_ID, "raw"), canonicalSourceUrl: first.canonicalSourceUrl })).toContain("/discovery/item/");
    expect(getPreferredSourceUrl({ sourceUrl: noteUrl(NOTE_ID, "raw"), canonicalSourceUrl: first.canonicalSourceUrl, userCorrectedSourceUrl: noteUrl(OTHER_NOTE_ID, "corrected") })).toContain(OTHER_NOTE_ID);

    const profile = analyzeSourceUrl(`https://www.xiaohongshu.com/user/profile/${NOTE_ID}`);
    expect(profile.status).toBe("invalid");
    expect(profile.sourceId).toBeUndefined();
  });

  test("keeps raw content separate while producing normalized content", () => {
    const rawTitle = "教程标题 - 小红书 - 你的生活兴趣社区";
    const rawText = "复制这段文字后，打开小红书查看笔记 教程标题 作者甲 点赞 128 收藏 30 正文步骤";
    const normalized = normalizeSavedContent(rawTitle, rawText, "作者甲");
    expect(rawText).toContain("点赞 128");
    expect(normalized.normalizedTitle).not.toContain("小红书");
    expect(normalized.normalizedContent).not.toContain("复制这段文字");
    expect(normalized.normalizedContent).not.toContain("点赞 128");
    expect(normalized.normalizationVersion).toBeGreaterThan(0);
  });

  test("dedupes by sourceId and does not merge different notes with the same title", () => {
    const result = processImportBatch({
      source: "browser-extension",
      title: "Phase 2 synthetic fixture",
      userId: "phase2-user",
      existingSavedItems: [],
      existingActionCards: [],
      now: new Date("2026-07-29T00:00:00.000Z"),
      items: [
        { sourceUrl: noteUrl(NOTE_ID, "masked-a"), title: "同名教程", author: "作者甲", rawText: "第一篇的独立正文" },
        { sourceUrl: noteUrl(NOTE_ID, "masked-b"), title: "同名教程", author: "作者甲", rawText: "第一篇的独立正文" },
        { sourceUrl: noteUrl(OTHER_NOTE_ID, "masked-c"), title: "同名教程", author: "作者乙", rawText: "第二篇完全不同的正文" }
      ]
    });
    expect(result.importedSavedItems).toHaveLength(2);
    expect(result.duplicates).toHaveLength(1);
    expect(result.batch.duplicateBreakdown?.batchDuplicates).toBe(1);
    expect(result.duplicates[0]?.duplicateKind).toBe("batch");

    const replay = processImportBatch({
      source: "browser-extension",
      title: "Phase 2 replay",
      userId: "phase2-user",
      existingSavedItems: result.importedSavedItems,
      existingActionCards: [],
      now: new Date("2026-07-29T00:01:00.000Z"),
      items: [
        { sourceUrl: noteUrl(NOTE_ID, "masked-z"), title: "同名教程", author: "作者甲", rawText: "第一篇的独立正文" },
        { sourceUrl: noteUrl(OTHER_NOTE_ID, "masked-y"), title: "同名教程", author: "作者乙", rawText: "第二篇完全不同的正文" }
      ]
    });
    expect(replay.importedSavedItems).toHaveLength(0);
    expect(replay.batch.duplicateBreakdown?.existingLibraryDuplicates).toBe(2);
  });

  test("diagnostic reports counts and only deidentified error IDs", () => {
    const result = processImportBatch({
      source: "manual",
      title: "Phase 2 diagnostic fixture",
      userId: "phase2-user",
      existingSavedItems: [],
      existingActionCards: [],
      items: [
        { sourceUrl: noteUrl(NOTE_ID, "masked"), title: "有效数据", rawText: "有效正文" },
        { title: "缺链接数据", rawText: "仍保留原始正文" }
      ]
    });
    const diagnostic = diagnoseSavedItems(result.importedSavedItems);
    expect(diagnostic.totalCount).toBe(2);
    expect(diagnostic.withSourceIdCount).toBe(1);
    expect(diagnostic.unparseableLinkCount).toBe(1);
    expect(diagnostic.errors.some((error) => error.types.includes("SOURCE_ID_MISSING"))).toBe(true);
    expect(diagnostic.errors.every((error) => /^[a-f0-9]{8,12}$/.test(error.deidentifiedId))).toBe(true);
    expect(JSON.stringify(diagnostic.errors)).not.toContain("缺链接数据");
  });

  test("repairs an original link without overwriting raw sourceUrl and keeps it after reload", async ({ page }) => {
    await page.goto("/import");
    await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
    await page.reload();
    await page.getByTestId("import-title").fill("待修复链接收藏");
    await page.getByTestId("import-raw-share-text").fill("这是保留的原始正文");
    await submitQuickImportForm(page);
    await page.getByTestId("view-imported-index").click();

    page.once("dialog", (dialog) => dialog.accept(noteUrl(NOTE_ID, "masked-repair")));
    await page.getByTestId("detail-repair-source").click();
    await expect(page.getByTestId("detail-open-source")).toBeVisible();

    const storedState = await readAppState(page);
    const repaired = storedState.savedItems.find((item) => item.title.includes("待修复链接")) as (typeof storedState.savedItems)[number] & { userCorrectedSourceUrl?: string; sourceId?: string; canonicalSourceUrl?: string };
    expect(repaired.sourceUrl).toBe("");
    expect(repaired.userCorrectedSourceUrl).toContain(`/discovery/item/${NOTE_ID}`);
    expect(repaired.sourceId).toBe(NOTE_ID);
    expect(repaired.canonicalSourceUrl).toContain(`/explore/${NOTE_ID}`);

    await page.reload();
    await expect(page.getByTestId("detail-open-source")).toBeVisible();
    expect((await readAppState(page)).savedItems.find((item) => item.id === repaired.id)).toMatchObject({
      sourceUrl: "",
      userCorrectedSourceUrl: expect.stringContaining(`/discovery/item/${NOTE_ID}`)
    });
  });

  test("shows the read-only data diagnostic without raw content", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("data-quality-diagnostic")).toBeVisible();
    await expect(page.getByTestId("data-quality-diagnostic")).toContainText("有 sourceId");
    await expect(page.getByTestId("data-quality-diagnostic")).toContainText("无法解析链接");
    await expect(page.getByTestId("data-quality-errors")).not.toContainText("这是保留的原始正文");
  });
});