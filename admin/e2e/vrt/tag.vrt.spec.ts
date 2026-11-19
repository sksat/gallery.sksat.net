import { expect, test } from "@playwright/test";

// /tag/ with the VRChat tag's fields open (e2e/fixture.sql).

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("admin: tag fields", async ({ page }) => {
    await page.goto("/tag/?tag=VRChat");
    await expect(page.getByTestId("tag-field")).toHaveCount(3);
    await expect(page).toHaveScreenshot("admin-tag-fields.png", {
      fullPage: true,
    });
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("admin: tag fields (phone)", async ({ page }) => {
    await page.goto("/tag/?tag=VRChat");
    await expect(page.getByTestId("tag-field")).toHaveCount(3);
    await expect(page).toHaveScreenshot("admin-tag-fields-phone.png", {
      fullPage: true,
    });
  });
});
