import { test, expect } from "@playwright/test";

// Test data: public/test-media/media.json has 2 Real + 3 VRChat photos

test("gallery: view, navigate, and filter photos", async ({ page }) => {
  await page.goto("/");

  // Wait for images to render
  const images = page.getByTestId("gallery-image");
  await expect(images.first()).toBeVisible({ timeout: 10000 });

  // Default filter is "Real" — should show 2 Real photos
  await expect(page.locator("input#Real")).toBeChecked();
  await expect(images).toHaveCount(2);

  // Click first image → overlay appears, URL changes
  // dispatchEvent bypasses DOM hit testing (metadata overlay covers tiny test images)
  await images.first().dispatchEvent("click");
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible();
  expect(page.url()).toMatch(/\/photo\/\d+/);
  const firstUrl = page.url();

  // ArrowRight → navigate to next photo
  await page.keyboard.press("ArrowRight");
  await expect(page).not.toHaveURL(firstUrl);
  expect(page.url()).toMatch(/\/photo\/\d+/);
  await expect(overlay).toBeVisible();

  // ArrowRight again at boundary → stays on same photo
  const boundaryUrl = page.url();
  await page.keyboard.press("ArrowRight");
  expect(page.url()).toBe(boundaryUrl);

  // ArrowLeft → navigate back
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(firstUrl);

  // Close overlay by clicking the dark area (top-left corner, outside the image)
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(overlay).not.toBeVisible();
  expect(page.url()).toMatch(/\/$/);

  // Switch to VRChat via label click
  await page.locator("label[for='VRChat']").click();
  await expect(page.locator("input#VRChat")).toBeChecked();

  // Should show 3 VRChat photos (different count from Real)
  await expect(images).toHaveCount(3);
});

test("gallery: direct navigation to /photo/{id}", async ({ page }) => {
  // Navigate directly to photo 1 (VRChat image in test fixture)
  await page.goto("/photo/1");

  // Overlay should appear with the image
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible({ timeout: 10000 });
  await expect(overlay.locator("img")).toBeVisible();
});
