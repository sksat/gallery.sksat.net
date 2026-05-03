import { defineConfig } from "@playwright/test";

const port = 5175;

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: `http://localhost:${port}`,
  },
  webServer: {
    // The script builds the app, resets the local D1, applies migrations + the
    // E2E fixture, and execs wrangler pages dev. We do this in one command (not
    // a globalSetup) because Playwright runs globalSetup in parallel with the
    // webServer; running it sequentially here avoids a race where wrangler
    // opens a sqlite file that globalSetup is about to wipe.
    command: `bash ./e2e/start-test-server.sh ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  projects: [
    {
      name: "e2e",
      testDir: "./e2e",
      testIgnore: "**/vrt/**",
      use: { browserName: "chromium" },
    },
    {
      name: "vrt",
      testDir: "./e2e/vrt",
      use: { browserName: "chromium" },
    },
  ],
});
