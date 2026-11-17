import { expect, test } from "@playwright/test";

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("admin: media files view", async ({ page }) => {
    await page.goto("/media/?view=files&dir=/mock");
    await expect(page.getByTestId("file-tile")).toHaveCount(5);
    await expect(page).toHaveScreenshot("admin-media-files.png", {
      fullPage: true,
    });
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("admin: media files view (phone)", async ({ page }) => {
    await page.goto("/media/?view=files&dir=/mock");
    await expect(page.getByTestId("file-tile")).toHaveCount(5);
    await expect(page).toHaveScreenshot("admin-media-files-phone.png", {
      fullPage: true,
    });
  });
});
