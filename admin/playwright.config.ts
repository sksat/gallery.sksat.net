import { defineConfig } from "@playwright/test";

const port = 5175;

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: `http://localhost:${port}`,
  },
  webServer: {
    command: `npx vite --mode ssr --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    // No VITE_S3_BASE_URL: admin pages do not consume the gallery media index.
    // When admin gains D1/R2 bindings, mock at the platform.env boundary instead.
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
