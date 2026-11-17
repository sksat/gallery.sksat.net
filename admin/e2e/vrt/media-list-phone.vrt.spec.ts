import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("admin: media list (phone)", async ({ page }) => {
  await page.goto("/media/");
  await expect(page.getByRole("heading", { name: /Media \(5\)/ })).toBeVisible();
  await expect(page).toHaveScreenshot("admin-media-list-phone.png", {
    fullPage: true,
  });
});
