import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, resetDemoData } from "./helpers";

test.describe("AI provider safety", () => {
  test("QA exposes server AI proxy status and keeps mock fallback usable", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);

    await page.goto("/qa");
    const panel = page.getByTestId("qa-ai-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("provider");
    await expect(panel).toContainText("model");
    await expect(panel).toContainText("fallback");
    await expect(panel).toContainText("key");

    await panel.getByRole("button", { name: "Test /api/ai" }).click();
    await expect(panel).toContainText(/ServerAIProxy|MockAIProvider|OpenAICompatibleProvider/);
    await expect(panel).toContainText(/keywords|fallback|AI_PROXY_UNAVAILABLE|local-rules|mock-fallback/);
    await expectNoConsoleErrors(errors);
  });
});
