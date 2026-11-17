import { test, expect } from "@playwright/test";

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

test("photo overlay: direct navigation", async ({ page }) => {
  await page.goto("/photo/1");
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible({ timeout: 10000 });
  await expect(overlay.locator("img")).toBeVisible();
  await expect(page).toHaveScreenshot("photo-1.png");
});
