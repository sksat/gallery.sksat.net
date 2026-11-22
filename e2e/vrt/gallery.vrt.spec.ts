import { test, expect, type Page } from "@playwright/test";

import { openInOverlay } from "../open-photo";
import { imagesSettled } from "./images";

test.use({ viewport: { width: 1280, height: 800 } });

/**
 * The header illustration and the tiles have loaded (not lazy images
 * below the fold, which would never start), and the tiles have their
 * photos' shapes.
 */
const imagesLoaded = (page: Page) =>
  imagesSettled(page, "header img, [data-testid=gallery-image]");

test("home: no tag selected", async ({ page }) => {
  await page.goto("/");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(5, { timeout: 10000 });
  await imagesLoaded(page);
  await expect(page).toHaveScreenshot("home-all.png", { fullPage: true });
});

test("home: two tags selected (OR)", async ({ page }) => {
  // Two tags so the AND/OR switch and the clear button are visible.
  await page.goto("/?tag=Real&tag=night&mode=or");
  await expect(page.getByTestId("gallery-image")).toHaveCount(3, {
    timeout: 10000,
  });
  await imagesLoaded(page);
  await expect(page).toHaveScreenshot("home-tags-or.png", { fullPage: true });
});

// The overlay of vrcxxxxxxa (every piece of metadata public), with the
// full-size image loaded and the info panel settled.
const openPhoto = async (page: Page, id = "vrcxxxxxxa") => {
  await openInOverlay(page, id);
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible({ timeout: 10000 });
  // The grid shows through the backdrop.
  await imagesLoaded(page);
  // Wait until the full-size image (stacked over the thumbnail) has loaded.
  await expect
    .poll(() =>
      overlay
        .getByTestId("overlay-image")
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId("info-toggle")).toHaveAttribute(
    "aria-expanded",
    /true|false/,
  );
};

// The panel slides; wait for it to stop.
const settled = (page: Page) =>
  page.waitForFunction(
    () =>
      document.querySelector('[data-testid="info-panel"]')?.getAnimations()
        .length === 0,
  );

// vrcxxxxxxa's detail page, opened from the VRChat list (so it has a previous
// photo and no next one), with the full-size image loaded.
const openDetail = async (page: Page) => {
  await page.goto("/photo/vrcxxxxxxa/detail/?tag=VRChat");
  const detail = page.getByTestId("photo-detail");
  await expect(detail).toBeVisible({ timeout: 10000 });
  await expect
    .poll(() =>
      detail
        .getByTestId("overlay-image")
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(detail.getByTestId("overlay-progress")).toHaveClass(/opacity-0/);
};

test("photo page", async ({ page }) => {
  await openDetail(page);
  await expect(page).toHaveScreenshot("photo-page.png", { fullPage: true });
});

// The info under the photo, its details open.
test("photo overlay", async ({ page }) => {
  await openPhoto(page);
  await settled(page);
  await expect(page).toHaveScreenshot("photo-1.png");
});

// Closed to the summary line.
test("photo overlay: details closed", async ({ page }) => {
  await openPhoto(page);
  await page.getByTestId("info-summary").click();
  await expect(page.getByTestId("info-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page).toHaveScreenshot("photo-1-info-closed.png");
});

// reaxxxxxxa (3:4): its film tag's fields under the tag.
test("photo overlay: a tag's fields", async ({ page }) => {
  await openPhoto(page, "reaxxxxxxa");
  await expect(page.getByTestId("info-tag-fields")).toBeVisible();
  await settled(page);
  await expect(page).toHaveScreenshot("photo-real1-tag-fields.png");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("photo page", async ({ page }) => {
    await openDetail(page);
    await expect(page).toHaveScreenshot("photo-page-phone.png", {
      fullPage: true,
    });
  });

  test("photo overlay", async ({ page }) => {
    await openPhoto(page);
    await settled(page);
    await expect(page).toHaveScreenshot("photo-1-phone.png");
  });

  test("photo overlay: a tag's fields", async ({ page }) => {
    await openPhoto(page, "reaxxxxxxa");
    await expect(page.getByTestId("info-tag-fields")).toBeVisible();
    await settled(page);
    await expect(page).toHaveScreenshot("photo-real1-tag-fields-phone.png");
  });
});
