import { test, expect, type Page } from "@playwright/test";

// /camera/virtuallens2/: header with three camera pictures, then photos 4
// and 1 (see public/test-media/README.md).
const ready = async (page: Page) => {
  await page.goto("/camera/virtuallens2/");
  await expect(page.getByTestId("gallery-image")).toHaveCount(2, {
    timeout: 10000,
  });
  // The camera pictures are lazy-loaded; wait so they are always painted.
  const pictures = page.getByTestId("camera-header").locator("img");
  await expect(pictures).toHaveCount(3);
  for (const img of await pictures.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth),
      )
      .toBeGreaterThan(0);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
};

test.describe("camera page", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("desktop", async ({ page }) => {
    await ready(page);
    await expect(page).toHaveScreenshot("camera-virtuallens2.png", {
      fullPage: true,
    });
  });
});

test.describe("camera page (phone)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("phone", async ({ page }) => {
    await ready(page);
    await expect(page).toHaveScreenshot("camera-virtuallens2-phone.png", {
      fullPage: true,
    });
  });
});
