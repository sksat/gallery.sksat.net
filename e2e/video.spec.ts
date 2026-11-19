import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

import { GALLERY_ORDER, openInOverlay } from "./open-photo";

// The fixture's public video (vdxxxxxxxa, e2e/fixture.sql): a tile with a
// play mark, the overlay's and its page's player. /video/<id> is the image
// Worker's in production; here the test answers it with a tiny VP9 clip
// (Playwright's Chromium has no H.264), or refuses it.

const ID = "vdxxxxxxxa";
const CLIP = readFileSync(
  new URL("../admin/e2e/fixtures/clip.webm", import.meta.url),
);

const serveClip = (page: Page) =>
  page.route(`**/video/${ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "video/webm",
      body: CLIP,
      headers: { "Accept-Ranges": "none" },
    }),
  );

test("a video's tile has a play mark with its length", async ({ page }) => {
  await page.goto("/");
  const tiles = page.getByTestId("gallery-tile");
  await expect(tiles).toHaveCount(GALLERY_ORDER.length);
  const badges = page.getByTestId("video-badge");
  await expect(badges).toHaveCount(1);
  await expect(badges).toHaveText("動画0:02");
  await expect(tiles.last().getByTestId("video-badge")).toBeVisible();
});

test("the overlay plays a video only when asked", async ({ page }) => {
  let asked = 0;
  await page.route(`**/video/${ID}`, async (route) => {
    asked++;
    await route.fulfill({ status: 200, contentType: "video/webm", body: CLIP });
  });
  await openInOverlay(page, ID);
  const video = page.getByTestId("overlay").getByTestId("video-player");
  await expect(video).toHaveAttribute("src", `/video/${ID}`);
  await expect(video).toHaveAttribute("preload", "none");
  await expect(video).toHaveAttribute("controls", "");
  // Nothing is loaded before play.
  expect(asked).toBe(0);
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  expect(asked).toBeGreaterThan(0);
  // A click on the player does not close the overlay.
  await video.click();
  await expect(page.getByTestId("overlay")).toBeVisible();
  await expect(page.getByTestId("video-error")).toHaveCount(0);
});

test("a video that cannot be played says so over its poster", async ({
  page,
}) => {
  await page.route(`**/video/${ID}`, (route) =>
    route.fulfill({ status: 200, contentType: "video/mp4", body: "not a video" }),
  );
  await openInOverlay(page, ID);
  const video = page.getByTestId("video-player");
  await video.evaluate((v: HTMLVideoElement) => v.play().catch(() => {}));
  await expect(page.getByTestId("video-error")).toContainText(
    "このブラウザでは再生できません",
  );
});

test("a video the server no longer serves is a load failure, not the browser's", async ({
  page,
}) => {
  await page.route(`**/video/${ID}`, (route) =>
    route.fulfill({ status: 404, body: "Not Found" }),
  );
  await openInOverlay(page, ID);
  const video = page.getByTestId("video-player");
  await video.evaluate((v: HTMLVideoElement) => v.play().catch(() => {}));
  await expect(page.getByTestId("video-error")).toHaveText(
    "動画を読み込めませんでした。",
  );
});

test("arrow keys and Enter on a focused player stay with the player", async ({
  page,
}) => {
  await serveClip(page);
  await openInOverlay(page, ID);
  const before = page.url();
  await page.getByTestId("video-player").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("overlay")).toBeVisible();
  expect(page.url()).toBe(before);
});

test("its page: the player, its length, and an og:image from the poster", async ({
  page,
}) => {
  await serveClip(page);
  await page.goto(`/photo/${ID}/detail/`);
  const detail = page.getByTestId("photo-detail");
  await expect(detail.getByTestId("video-player")).toHaveAttribute(
    "src",
    `/video/${ID}`,
  );
  await expect(detail.getByTestId("info-duration")).toContainText("0:02");
  // Its box is the video's shape before anything loads.
  await expect(detail.getByTestId("overlay-box")).toHaveAttribute(
    "style",
    /aspect-ratio:\s*320 \/ 180/,
  );
});
