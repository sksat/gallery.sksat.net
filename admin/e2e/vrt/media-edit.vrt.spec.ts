import { expect, test } from "@playwright/test";

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("admin: media edit form", async ({ page }) => {
    await page.goto("/media/2/");
    await expect(page.getByRole("heading", { name: "Edit #2" })).toBeVisible();
    await expect(page).toHaveScreenshot("admin-media-edit.png", {
      fullPage: true,
    });
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("admin: media edit form (phone)", async ({ page }) => {
    await page.goto("/media/2/");
    await expect(page.getByRole("heading", { name: "Edit #2" })).toBeVisible();
    await expect(page).toHaveScreenshot("admin-media-edit-phone.png", {
      fullPage: true,
    });
  });
});
