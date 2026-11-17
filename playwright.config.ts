import { defineConfig } from "@playwright/test";

const port = 5174;
// The API Worker (workers/api) on a local D1 with e2e/fixture.sql.
const apiPort = 5178;
// An explicit IPv4 address rather than "localhost": inside the Playwright
// container (CI vrt job) vite listened on ::1 while the SSR fetch of
// media.json went to 127.0.0.1 and was refused.
const host = "127.0.0.1";
const origin = `http://${host}:${port}`;
const apiOrigin = `http://${host}:${apiPort}`;

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: origin,
  },
  webServer: [
    {
      command: `bash e2e/start-api-server.sh ${apiPort}`,
      url: `${apiOrigin}/api/media`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npx vite --mode ssr --host ${host} --port ${port}`,
      url: origin,
      reuseExistingServer: !process.env.CI,
      env: {
        // Originals (the image Worker is not used in tests) and camera
        // pictures come from public/test-media.
        VITE_S3_BASE_URL: `${origin}/test-media/`,
        VITE_API_BASE_URL: `${apiOrigin}/api`,
      },
    },
  ],
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
