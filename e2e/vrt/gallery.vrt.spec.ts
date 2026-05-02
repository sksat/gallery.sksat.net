import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test("home: Real filter (default)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("gallery-image").first()).toBeVisible({
    timeout: 10000,
  });
  await expect(page).toHaveScreenshot("home-real.png", { fullPage: true });
});

test("home: VRChat filter", async ({ page }) => {
  await page.goto("/");
  const images = page.getByTestId("gallery-image");
  await expect(images.first()).toBeVisible({ timeout: 10000 });
  await page.locator("label[for='VRChat']").click();
  await expect(page.locator("input#VRChat")).toBeChecked();
  // Wait for the filter to actually take effect — Real (2) → VRChat (3).
  // Without this, toHaveScreenshot can race against the in-flight re-render.
  await expect(images).toHaveCount(3);
  await expect(page).toHaveScreenshot("home-vrchat.png", { fullPage: true });
});

test("photo overlay: direct navigation", async ({ page }) => {
  await page.goto("/photo/1");
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible({ timeout: 10000 });
  await expect(overlay.locator("img")).toBeVisible();
  await expect(page).toHaveScreenshot("photo-1.png");
});
