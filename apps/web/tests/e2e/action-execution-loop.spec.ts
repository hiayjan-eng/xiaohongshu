import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, importTestNote, readAppState, resetDemoData, reviveImportedItem } from "./helpers";

const intentVariants = [
  { label: "学会这个方法", key: "learn_method" },
  { label: "照着做一次", key: "copy_once" },
  { label: "用在工作里", key: "use_at_work" },
  { label: "变成自己的内容", key: "make_own_content" },
  { label: "安排一次出行", key: "plan_trip" },
  { label: "做购买决定", key: "make_purchase_decision" },
  { label: "写一条观察或复盘", key: "reflect" }
] as const;

test.describe("P0 action execution loop", () => {
  test("binds every executable purpose to a distinct card and turns organize-only back into an index", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);
    const item = await importTestNote(page, {
      sourceUrl: "https://www.xiaohongshu.com/explore/p0-intent-binding",
      title: "AI 一键生成图文的方法",
      rawShareText: "使用 AI 工具、提示词和三步流程生成一张测试图文，包含关键操作和结果",
      userNote: "先学会方法，不要扩展成内容选题"
    });
    await page.getByTestId("view-imported-index").click();

    const snapshots = new Set<string>();
    for (let index = 0; index < intentVariants.length; index += 1) {
      const variant = intentVariants[index];
      if (index === 0) {
        await page.getByTestId("revive-intent-option").filter({ hasText: variant.label }).click();
      } else {
        const option = page.getByTestId("rebind-intent-option").filter({ hasText: variant.label });
        if (!(await option.isVisible())) await page.getByTestId("change-action-intent").click();
        await option.click();
      }
      await expect.poll(async () => {
        const state = await readAppState(page);
        return state.actionCards.find((card) => card.savedItemId === item.id)?.generatedFromIntent;
      }).toBe(variant.key);
      const state = await readAppState(page);
      const card = state.actionCards.find((entry) => entry.savedItemId === item.id)!;
      expect(card.templateVersion).toBe("action-intent-v1");
      snapshots.add([card.goal, card.nextAction, card.output, card.doneCriteria].join("|"));
      if (variant.key === "learn_method") {
        expect(card.output).toBe("1 张测试图文 + 1 份 3-5 步操作清单");
        expect(`${card.goal} ${card.nextAction} ${card.output}`).not.toMatch(/内容选题|标题钩子|封面结构/);
      }
      if (variant.key === "make_own_content") expect(`${card.goal} ${card.output}`).toMatch(/内容选题|可发布选题/);
      if (variant.key === "use_at_work") expect(card.output).toMatch(/草稿|SOP|模板/);
    }
    expect(snapshots.size).toBe(intentVariants.length);

    const organizeOption = page.getByTestId("rebind-intent-option").filter({ hasText: "只是整理留存" });
    if (!(await organizeOption.isVisible())) await page.getByTestId("change-action-intent").click();
    await organizeOption.click();
    await expect.poll(async () => {
      const state = await readAppState(page);
      return state.actionCards.some((card) => card.savedItemId === item.id);
    }).toBe(false);
    const organizedState = await readAppState(page);
    expect(organizedState.savedItems.find((entry) => entry.id === item.id)?.savedIntent).toBe("以后查阅");
    await expect(page.getByText("你准备拿它做什么？", { exact: true })).toBeVisible();
    await expectNoConsoleErrors(errors);
  });

  test("persists Today and completion, while custom planning and empty completion stay inside the product UI", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const item = await importTestNote(page, {
      sourceUrl: "https://www.xiaohongshu.com/explore/p0-action-state-machine",
      title: "把 AI 方法用到每周汇报",
      rawShareText: "将 AI 方法用于真实工作任务，先生成一版每周汇报草稿",
      userNote: "安排后开始，验证状态和持久化"
    });
    await reviveImportedItem(page, item.id);

    let nativeDialogCount = 0;
    page.on("dialog", async (dialog) => {
      nativeDialogCount += 1;
      await dialog.dismiss();
    });

    await page.getByTestId("add-to-today").click();
    await expect(page.locator(".toast")).toHaveText("已加入今天，可以现在开始");
    await expect.poll(async () => {
      const state = await readAppState(page);
      return state.planCards?.filter((plan) => plan.savedItemId === item.id).length ?? 0;
    }).toBe(1);
    await expect(page.getByTestId("add-to-today")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("scheduled-action-summary")).toContainText("已加入今日");

    await page.getByRole("button", { name: "修改计划" }).click();
    const dialog = page.getByTestId("action-plan-dialog");
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "修改计划" }).click();
    await page.getByTestId("plan-date-input").fill("2030-08-16");
    await page.getByLabel("60 分钟").check();
    await page.getByPlaceholder("例如：先完成一张测试图，不扩展选题").fill("先完成一版汇报草稿");
    await page.getByTestId("save-action-plan").click();
    await expect.poll(async () => {
      const state = await readAppState(page);
      const plan = state.planCards?.find((entry) => entry.savedItemId === item.id);
      return `${plan?.plannedDate.slice(0, 10)}|${plan?.estimatedMinutes}|${state.savedItems.find((entry) => entry.id === item.id)?.status}`;
    }).toBe("2030-08-16|60|scheduled");
    const plannedState = await readAppState(page);
    expect(plannedState.planCards?.filter((plan) => plan.savedItemId === item.id)).toHaveLength(1);

    await page.getByTestId("start-action").click();
    await expect(page.getByTestId("in-progress-action")).toBeVisible();
    await page.getByTestId("status-completed").click();
    await expect(page.getByRole("alertdialog")).toContainText("产出还是空的");
    expect((await readAppState(page)).savedItems.find((entry) => entry.id === item.id)?.status).toBe("in_progress");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByTestId("action-output-field").locator("textarea").fill("已完成一版每周汇报草稿");
    await page.getByTestId("save-action-output").click();
    await page.getByTestId("status-completed").click();
    await expect.poll(async () => (await readAppState(page)).savedItems.find((entry) => entry.id === item.id)?.status).toBe("completed");
    expect(nativeDialogCount).toBe(0);

    await page.reload();
    await expect(page.getByTestId("completed-action-summary")).toContainText("已完成一版每周汇报草稿");
    await expect(page.getByTestId("completed-action-summary")).toContainText("下一步");
    const completedState = await readAppState(page);
    expect(completedState.actionCards.find((card) => card.savedItemId === item.id)?.outputSavedAt).toBeTruthy();
    expect(completedState.planCards?.find((plan) => plan.savedItemId === item.id)?.status).toBe("done");
    await expectNoConsoleErrors(errors);
  });
});