import { defineConfig } from "@playwright/test";

// Local override: set ADMIN_E2E_PORT if 5175 is taken on your machine.
const port = Number(process.env.ADMIN_E2E_PORT) || 5175;

// CI runs the E2E specs in parallel jobs, one group each, every job with its
// own server and a fresh D1 (the admin-e2e matrix in .github/workflows/ci.yaml).
// ADMIN_E2E_GROUP picks a group; "rest" is every spec not named here, so a
// new spec is never left out. Within a group the specs still run serially in
// file name order. The groups take about the same time: keep them so when a
// spec grows (the job times are in the CI run). Unset: all specs.
const groups: Record<string, string[]> = {
  selection: ["selection"],
  upload: ["upload"],
  // With the firefox project (its upload.spec.ts drops) in CI.
  "upload-rule": ["upload-rule"],
  media: [
    "media-files",
    "media-filter",
    "media-list",
    "media-review",
    "media-visibility",
    "metadata",
    "mobile-basics",
    "mobile-bulk",
  ],
  later: [
    "mobile-edit",
    "mobile-nav",
    "photo-preview",
    "platform",
    "resized",
    "smoke",
    "tag-field",
    "tag-rename",
    "theme",
    "trash",
  ],
};
const group = process.env.ADMIN_E2E_GROUP;
if (group && group !== "rest" && !(group in groups))
  throw new Error(`ADMIN_E2E_GROUP: no group ${group}`);
const specs = (names: string[]) => names.map((n) => `**/${n}.spec.ts`);
const e2eFiles = !group
  ? {}
  : group === "rest"
    ? { testIgnore: ["**/vrt/**", ...specs(Object.values(groups).flat())] }
    : { testMatch: specs(groups[group]) };

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
      ...e2eFiles,
      use: { browserName: "chromium" },
    },
    {
      // The drops from the OS once more in Firefox, whose drags differ,
      // and the images over the resize limits, whose smaller copy its own
      // decoder and canvas make (upload.spec.ts). After the rest, as its
      // uploads add rows.
      name: "firefox",
      testDir: "./e2e",
      testMatch: "upload.spec.ts",
      grep: /\bdrop |over-limit|over the resize limits/,
      dependencies: ["e2e"],
      use: { browserName: "firefox" },
    },
    {
      name: "vrt",
      testDir: "./e2e/vrt",
      use: { browserName: "chromium" },
    },
  ],
});
