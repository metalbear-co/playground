import { defineConfig } from "@playwright/test";

const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results";
const reportDir = process.env.PLAYWRIGHT_HTML_REPORT || "playwright-report";

export default defineConfig({
  testDir: "./tests",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  outputDir,
  reporter: [["list"], ["html", { outputFolder: reportDir, open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
