import { expect, test } from "@playwright/test";

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("admin: camera list", async ({ page }) => {
    await page.goto("/camera/");
    await expect(
      page.getByRole("heading", { name: /^Cameras \(\d+\)/ }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("admin-camera-list.png", {
      fullPage: true,
    });
  });

  test("admin: camera edit form", async ({ page }) => {
    await page.goto("/camera/1/");
    await expect(
      page.getByRole("heading", { name: "Edit camera" }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("admin-camera-edit.png", {
      fullPage: true,
    });
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("admin: camera edit form (phone)", async ({ page }) => {
    await page.goto("/camera/1/");
    await expect(
      page.getByRole("heading", { name: "Edit camera" }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("admin-camera-edit-phone.png", {
      fullPage: true,
    });
  });
});
