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
  await expect(page.getByTestId("gallery-image").first()).toBeVisible({
    timeout: 10000,
  });
  await page.locator("label[for='VRChat']").click();
  await expect(page.locator("input#VRChat")).toBeChecked();
  await expect(page.getByTestId("gallery-image").first()).toBeVisible();
  await expect(page).toHaveScreenshot("home-vrchat.png", { fullPage: true });
});

test("photo overlay: direct navigation", async ({ page }) => {
  await page.goto("/photo/1");
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible({ timeout: 10000 });
  await expect(overlay.locator("img")).toBeVisible();
  await expect(page).toHaveScreenshot("photo-1.png");
});
