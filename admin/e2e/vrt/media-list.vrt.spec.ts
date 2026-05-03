import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test("admin: media list", async ({ page }) => {
  await page.goto("/media/");
  await expect(page.getByRole("heading", { name: /Media \(5\)/ })).toBeVisible();
  await expect(page).toHaveScreenshot("admin-media-list.png", { fullPage: true });
});
