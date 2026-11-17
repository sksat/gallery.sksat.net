import { defineConfig } from "@playwright/test";

const port = 5174;
// An explicit IPv4 address rather than "localhost": inside the Playwright
// container (CI vrt job) vite listened on ::1 while the SSR fetch of
// media.json went to 127.0.0.1 and was refused.
const host = "127.0.0.1";
const origin = `http://${host}:${port}`;

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: origin,
  },
  webServer: {
    command: `npx vite --mode ssr --host ${host} --port ${port}`,
    url: origin,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_S3_BASE_URL: `${origin}/test-media/`,
    },
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
