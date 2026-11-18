import { test, expect, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test("home: no tag selected", async ({ page }) => {
  await page.goto("/");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(5, { timeout: 10000 });
  await expect(page).toHaveScreenshot("home-all.png", { fullPage: true });
});

test("home: two tags selected (OR)", async ({ page }) => {
  // Two tags so the AND/OR switch and the clear button are visible.
  await page.goto("/?tag=Real&tag=night&mode=or");
  await expect(page.getByTestId("gallery-image")).toHaveCount(3, {
    timeout: 10000,
  });
  await expect(page).toHaveScreenshot("home-tags-or.png", { fullPage: true });
});

// The overlay of vrcxxxxxxa (every piece of metadata public), with the
// full-size image loaded and the info panel settled.
const openPhoto = async (page: Page) => {
  await page.goto("/photo/vrcxxxxxxa");
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
      document
        .querySelector('[data-testid="info-panel"]')
        ?.getAnimations().length === 0,
  );

test("photo overlay: direct navigation (summary)", async ({ page }) => {
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

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

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
});
