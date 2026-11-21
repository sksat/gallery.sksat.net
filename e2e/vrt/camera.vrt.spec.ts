import { test, expect, type Locator, type Page } from "@playwright/test";

// Fixture: e2e/fixture.sql (see public/test-media/README.md).

/** Wait until lazy-loaded images are painted, then go back to the top. */
const loaded = async (page: Page, images: Locator, count: number) => {
  await expect(images).toHaveCount(count, { timeout: 10000 });
  for (const img of await images.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth),
      )
      .toBeGreaterThan(0);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
};

// /camera/virtuallens2/: header with three camera pictures, then its two
// public photos.
const cameraPage = async (page: Page) => {
  await page.goto("/camera/virtuallens2/");
  await expect(page.getByTestId("gallery-image")).toHaveCount(2, {
    timeout: 10000,
  });
  await loaded(page, page.getByTestId("camera-header").locator("img"), 3);
  // The photos of unknown size have taken their image's shape (after its
  // load event, a moment later), so the rows are laid out for good.
  await expect
    .poll(() =>
      page.$$eval("[data-unsized]", (imgs) =>
        (imgs as HTMLImageElement[]).every((i) => {
          const r = i.getBoundingClientRect();
          const want = i.naturalWidth / i.naturalHeight;
          return (
            i.naturalWidth > 0 && Math.abs(r.width / r.height / want - 1) < 0.03
          );
        }),
      ),
    )
    .toBe(true);
};

// /camera/: VirtualLens2 and PENTAX SP cards.
const cameraList = async (page: Page) => {
  await page.goto("/camera/");
  await loaded(page, page.getByTestId("camera-card").locator("img"), 2);
};

for (const [label, viewport, suffix] of [
  ["desktop", { width: 1280, height: 800 }, ""],
  ["phone", { width: 390, height: 844 }, "-phone"],
] as const) {
  test.describe(`camera pages (${label})`, () => {
    test.use({ viewport });

    test("camera page", async ({ page }) => {
      await cameraPage(page);
      await expect(page).toHaveScreenshot(`camera-virtuallens2${suffix}.png`, {
        fullPage: true,
      });
    });

    test("camera list", async ({ page }) => {
      await cameraList(page);
      await expect(page).toHaveScreenshot(`camera-list${suffix}.png`, {
        fullPage: true,
      });
    });
  });
}
