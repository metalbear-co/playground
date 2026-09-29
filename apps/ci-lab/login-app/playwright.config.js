import { defineConfig } from "@playwright/test";

const headers = process.env.MIRRORD_SESSION
  ? { "x-mirrord-session": process.env.MIRRORD_SESSION }
  : undefined;

const ci = process.env.CI === "true";

export default defineConfig({
  testDir: "./tests",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results",
  reporter: ci
    ? [
        ["list"],
        [
          "html",
          {
            outputFolder: process.env.PLAYWRIGHT_HTML_REPORT || "playwright-report",
            open: "never",
          },
        ],
      ]
    : [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8080",
    extraHTTPHeaders: headers,
    headless: process.env.HEADED !== "1",
    video: ci ? "on" : "off",
    screenshot: ci ? "on" : "only-on-failure",
    trace: ci ? "on" : "off",
  },
});
