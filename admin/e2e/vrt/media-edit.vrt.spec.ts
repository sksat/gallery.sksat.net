import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test("admin: media edit form", async ({ page }) => {
  await page.goto("/media/2/");
  await expect(page.getByRole("heading", { name: "Edit #2" })).toBeVisible();
  await expect(page).toHaveScreenshot("admin-media-edit.png", {
    fullPage: true,
  });
});
