import { defineConfig } from "@playwright/test";

const headers = process.env.MIRRORD_SESSION
  ? { "x-mirrord-session": process.env.MIRRORD_SESSION }
  : undefined;

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8080",
    extraHTTPHeaders: headers,
    headless: process.env.HEADED !== "1",
  },
});
