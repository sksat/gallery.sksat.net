import { defineConfig } from "@playwright/test";

// E2E_PORT / E2E_API_PORT move both servers, e.g. to run two checkouts'
// tests side by side.
const port = Number(process.env.E2E_PORT) || 5174;
// The API Worker (workers/api) on a local D1 with e2e/fixture.sql.
const apiPort = Number(process.env.E2E_API_PORT) || 5178;
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
      // strictPort: if the port is taken (by something that does not answer
      // the URL check), fail rather than move to another port. Outside CI a
      // server that answers is reused: use E2E_PORT when another checkout
      // may be running its tests.
      command: `npx vite --mode ssr --host ${host} --port ${port} --strictPort`,
      url: origin,
      reuseExistingServer: !process.env.CI,
      env: {
        // Originals (the image Worker is not used in tests) and camera
        // pictures come from public/test-media.
        VITE_S3_BASE_URL: `${origin}/test-media/`,
        VITE_API_BASE_URL: `${apiOrigin}/api`,
        // A map style with no tiles: tests never reach the tile server.
        VITE_MAP_STYLE_URL: `${origin}/test-media/map-style.json`,
        // No dev-only outlines of layout shifts in screenshots (vite.config.ts).
        QWIK_IMAGE_DEV_TOOLS: "false",
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
