import { test, expect, type Page } from "@playwright/test";

import { openInOverlay } from "../open-photo";

test.use({ viewport: { width: 1280, height: 800 } });

/**
 * The header illustration and the tiles have loaded (not lazy images
 * below the fold, which would never start).
 */
const imagesLoaded = async (page: Page) => {
  await expect
    .poll(() =>
      page.$$eval("header img, [data-testid=gallery-image]", (imgs) =>
        imgs.every((i) => (i as HTMLImageElement).complete),
      ),
    )
    .toBe(true);
  // ...and the tiles of unknown size have taken their image's shape (after
  // its load event, a moment later), so the rows are laid out for good.
  await expect
    .poll(() =>
      page.$$eval("[data-unsized]", (imgs) =>
        (imgs as HTMLImageElement[]).every((i) => {
          const r = i.getBoundingClientRect();
          const want = i.naturalWidth / i.naturalHeight;
          return i.naturalWidth > 0 && Math.abs(r.width / r.height / want - 1) < 0.03;
        }),
      ),
    )
    .toBe(true);
};

test("home: no tag selected", async ({ page }) => {
  await page.goto("/");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(6, { timeout: 10000 });
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

test("photo overlay: summary", async ({ page }) => {
  await openPhoto(page);
  await settled(page);
  await expect(page).toHaveScreenshot("photo-1.png");
});

test("photo overlay: info panel open", async ({ page }) => {
  await openPhoto(page);
  await page.getByTestId("info-summary").click();
  await expect(page.getByTestId("info-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await settled(page);
  await expect(page).toHaveScreenshot("photo-1-info-open.png");
});

// reaxxxxxxa: its film tag's fields under the tag.
test("photo overlay: a tag's fields", async ({ page }) => {
  await openPhoto(page, "reaxxxxxxa");
  await page.getByTestId("info-summary").click();
  await expect(page.getByTestId("info-tag-fields")).toBeVisible();
  await settled(page);
  await expect(page).toHaveScreenshot("photo-real1-tag-fields.png");
});

// The fixture's video (vdxxxxxxxa): its player before play (a grey poster
// without the image Worker), and 長さ in the list.
test("video page", async ({ page }) => {
  await page.goto("/photo/vdxxxxxxxa/detail/");
  const detail = page.getByTestId("photo-detail");
  await expect(detail).toBeVisible({ timeout: 10000 });
  await expect(detail.getByTestId("video-player")).toBeVisible();
  await expect(detail.getByTestId("info-duration")).toBeVisible();
  // The page's height settles once its parts below the player are in.
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const before = document.documentElement.scrollHeight;
        await new Promise((r) => setTimeout(r, 300));
        return document.documentElement.scrollHeight === before;
      }),
    )
    .toBe(true);
  // The player's own controls (and a spinner Chromium may show while it
  // settles) are the browser's: masked, its box and the page around it
  // compared.
  await expect(page).toHaveScreenshot("video-page.png", {
    fullPage: true,
    mask: [page.getByTestId("video-player")],
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("photo page", async ({ page }) => {
    await openDetail(page);
    await expect(page).toHaveScreenshot("photo-page-phone.png", {
      fullPage: true,
    });
  });

  test("photo overlay: summary", async ({ page }) => {
    await openPhoto(page);
    await settled(page);
    await expect(page).toHaveScreenshot("photo-1-phone.png");
  });

  test("photo overlay: info sheet", async ({ page }) => {
    await openPhoto(page);
    await page.getByTestId("info-summary").click();
    await expect(page.getByTestId("info-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await settled(page);
    await expect(page).toHaveScreenshot("photo-1-phone-info.png");
  });

  test("photo overlay: a tag's fields", async ({ page }) => {
    await openPhoto(page, "reaxxxxxxa");
    await page.getByTestId("info-summary").click();
    await expect(page.getByTestId("info-tag-fields")).toBeVisible();
    await settled(page);
    await expect(page).toHaveScreenshot("photo-real1-tag-fields-phone.png");
  });
});
