import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 5173);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
const browserChannel = process.env.PLAYWRIGHT_CHANNEL || "chrome";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 8_000
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }]
  ],
  use: {
    baseURL,
    channel: browserChannel,
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off"
  },
  webServer: {
    command: `pnpm run dev -- --host 0.0.0.0 --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      CI: "true"
    }
  }
});


