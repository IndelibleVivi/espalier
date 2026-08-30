import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["line"],
    ["json", { outputFile: "artifacts/browser-smoke/playwright-results.json" }],
  ],
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "artifacts/browser-smoke/test-results",
  use: {
    baseURL: process.env.ESPALIER_BROWSER_BASE_URL ?? "http://127.0.0.1:4317",
    viewport: { width: 1280, height: 720 },
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
