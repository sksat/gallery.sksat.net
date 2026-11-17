import { test, expect, type Page } from "@playwright/test";

// Test data: e2e/fixture.sql, served by the API Worker (see
// public/test-media/README.md and the table in gallery.spec.ts).

// Open reaxxxxxxb from the filtered grid, so the URL carries the gallery
// query.
const openFilteredPhoto = async (page: Page) => {
  await page.goto("/?tag=Real&tag=night&mode=or");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(3, { timeout: 10000 });
  // Newest first: vrcxxxxxxb, reaxxxxxxb, reaxxxxxxa
  await images.nth(1).dispatchEvent("click");
  await expect(page).toHaveURL(
    /\/photo\/reaxxxxxxb\?tag=Real&tag=night&mode=or$/,
  );
};

test.describe("without a share sheet", () => {
  test.beforeEach(async ({ context, page }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      // Headless Chromium may expose navigator.share; desktops often don't.
      delete (Navigator.prototype as Partial<Navigator>).share;
    });
  });

  test("copies the photo URL without the gallery query", async ({ page }) => {
    await openFilteredPhoto(page);
    const button = page.getByRole("button", { name: "リンクをコピー" });
    await button.click();

    await expect(page.getByTestId("share-status")).toHaveText(
      "リンクをコピーしました",
    );
    const origin = new URL(page.url()).origin;
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${origin}/photo/reaxxxxxxb/`,
    );

    // The click did not close the overlay, and the arrow keys still browse.
    await expect(page.getByTestId("overlay")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/\/photo\/reaxxxxxxa\?/);
  });

  test("drops ?camera= too", async ({ page }) => {
    await page.goto("/photo/vrcxxxxxxa?camera=virtuallens2");
    await page.getByRole("button", { name: "リンクをコピー" }).click();
    await expect(page.getByTestId("share-status")).toHaveText(
      "リンクをコピーしました",
    );
    const origin = new URL(page.url()).origin;
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${origin}/photo/vrcxxxxxxa/`,
    );
  });

  test("shows the URL to copy when the clipboard is unavailable", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      navigator.clipboard.writeText = () =>
        Promise.reject(new DOMException("denied", "NotAllowedError"));
    });
    await openFilteredPhoto(page);
    await page.getByRole("button", { name: "リンクをコピー" }).click();

    const field = page.getByTestId("share-url");
    const origin = new URL(page.url()).origin;
    await expect(field).toHaveValue(`${origin}/photo/reaxxxxxxb/`);
    await expect(field).toBeFocused();
    // Arrow keys move the caret in the field, not to another photo.
    await page.keyboard.press("ArrowRight");
    // The handler is async; give it time to (wrongly) switch photos.
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/photo\/reaxxxxxxb\?/);
    await expect(field).toBeVisible();
  });
});

test("opens the share sheet with the photo URL", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: ShareData[] = [];
    (window as unknown as { shareCalls: ShareData[] }).shareCalls = calls;
    Object.defineProperty(Navigator.prototype, "share", {
      configurable: true,
      value: (data: ShareData) => {
        calls.push(data);
        return Promise.resolve();
      },
    });
  });
  await openFilteredPhoto(page);
  await page.getByRole("button", { name: "共有" }).click();

  const origin = new URL(page.url()).origin;
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { shareCalls: ShareData[] }).shareCalls,
      ),
    )
    .toEqual([{ title: expect.any(String), url: `${origin}/photo/reaxxxxxxb/` }]);
  await expect(page.getByTestId("overlay")).toBeVisible();
});

test("no share button on a camera picture", async ({ page }) => {
  await page.goto("/camera/virtuallens2/");
  const picture = page.getByTestId("camera-image");
  await expect(picture).toHaveCount(3, { timeout: 10000 });
  await picture.first().click();
  await expect(page.getByTestId("overlay")).toBeVisible();
  await expect(page.getByTestId("share-button")).toHaveCount(0);
});
