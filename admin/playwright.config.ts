import { defineConfig } from "@playwright/test";

// Local override: set ADMIN_E2E_PORT if 5175 is taken on your machine.
const port = Number(process.env.ADMIN_E2E_PORT) || 5175;

export default defineConfig({
  testDir: "./e2e",
  // Tests share a single wrangler dev process and a single D1 file. The
  // media-edit specs mutate rows that the media-list specs assert counts
  // against — running them in parallel would race a half-applied UPDATE
  // against the SELECT and produce intermittent CI failures. Force serial
  // execution.
  workers: 1,
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
