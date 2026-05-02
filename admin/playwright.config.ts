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
