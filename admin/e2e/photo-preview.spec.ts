import { expect, test, type Page } from "@playwright/test";

// The edit page's full-screen preview, on /e2e/preview/ (the same
// component with thumbnails on; see src/routes/e2e/preview/). Playwright
// serves /e2e-thumb/<preset>/<file>: thumbnails at once, the larger preset
// only when the test releases it.

// 1×1 and 2×2 PNGs.
const PNG_1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAKx0CAkTdRo8AAAAASUVORK5CYII=",
  "base64",
);

/** Serve the thumbnails; hold the larger presets until release(). */
const serveImages = async (page: Page) => {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  const large: string[] = [];
  await page.route("**/e2e-thumb/**", async (route) => {
    const url = route.request().url();
    if (/\/e2e-thumb\/h(240|480)\//.test(url)) {
      return route.fulfill({ contentType: "image/png", body: PNG_1 });
    }
    large.push(url);
    await released;
    await route
      .fulfill({
        contentType: "image/png",
        headers: { "Content-Length": String(PNG_2.length) },
        body: PNG_2,
      })
      .catch(() => {}); // aborted by the page meanwhile
  });
  return { release, large };
};

const fullscreen = (page: Page) => page.getByTestId("fullscreen");

// 1920px wide at 1x: the photo box is 1728px, so w1920 is fetched.
test.use({ viewport: { width: 1920, height: 1080 } });

test("opens on the thumbnail at once, then swaps in the larger image", async ({
  page,
}) => {
  const { release, large } = await serveImages(page);
  await page.goto("/e2e/preview/");
  const open = page.getByRole("button", { name: "写真を全画面で表示" });
  // The inline preview's thumbnail is on screen (and cached).
  const inlineThumb = open.locator("img").first();
  await expect(inlineThumb).toHaveJSProperty("complete", true);

  await open.click();
  await expect(fullscreen(page)).toBeVisible();
  // No empty backdrop: the same thumbnail, already decoded, right away.
  const thumb = page.getByTestId("fullscreen-thumb");
  expect(await thumb.getAttribute("src")).toBe(
    await inlineThumb.getAttribute("src"),
  );
  await expect
    .poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  // Translucent like the public gallery's overlay, not black.
  const backdrop = await thumb.evaluate(
    (img) =>
      getComputedStyle(img.parentElement!.parentElement!).backgroundColor,
  );
  // (Black at 70%; the exact serialisation depends on the browser.)
  expect(backdrop).toMatch(/\/ 0\.7\)$|, 0\.7\)$/);

  // Downloading the overlay preset for this screen, with progress.
  const progress = page.getByTestId("fullscreen-progress");
  await expect(progress).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.getByTestId("fullscreen-image")).toHaveCount(0);
  // (The inline preview fetches its own w1200 for its 768px box.)
  const overlay = () => large.filter((u) => u.includes("/w1920/"));
  await expect.poll(() => overlay().length).toBe(1);
  expect(overlay()[0]).toMatch(/\/e2e-thumb\/w1920\/mock\/vrchat1\.png$/);

  release();
  const full = page.getByTestId("fullscreen-image");
  await expect(full).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() => full.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(2);
  await expect(progress).toHaveAttribute("aria-hidden", "true");

  // Escape closes it and gives focus back; reopening reuses the image.
  await page.keyboard.press("Escape");
  await expect(fullscreen(page)).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await expect(full).toBeVisible();
  expect(overlay()).toHaveLength(1);

  // A click anywhere closes it, as in the public gallery.
  await full.click();
  await expect(fullscreen(page)).toBeHidden();
});

test("closing before the larger image arrives cancels its download", async ({
  page,
}) => {
  const { release } = await serveImages(page);
  const failed: string[] = [];
  page.on("requestfailed", (r) => {
    if (r.url().includes("/w1920/")) failed.push(r.url());
  });
  await page.goto("/e2e/preview/");
  await page.getByRole("button", { name: "写真を全画面で表示" }).click();
  await expect(page.getByTestId("fullscreen-thumb")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(fullscreen(page)).toBeHidden();
  await expect.poll(() => failed.length).toBe(1);
  release();
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });

  test("a phone gets the w1200 preset", async ({ page }) => {
    const { release, large } = await serveImages(page);
    await page.goto("/e2e/preview/");
    // The inline preview's own w1200 (358px box × 3) first...
    await expect.poll(() => large.length).toBe(1);
    await page.getByRole("button", { name: "写真を全画面で表示" }).tap();
    // ...then the overlay's: 351px × 3 = 1053px, so w1200 too.
    await expect.poll(() => large.length).toBe(2);
    expect(large[1]).toMatch(/\/w1200\//);
    release();
    await expect(page.getByTestId("fullscreen-image")).toBeVisible();
  });
});
