import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test("admin: camera list", async ({ page }) => {
  await page.goto("/cameras/");
  await expect(
    page.getByRole("heading", { name: /^Cameras \(\d+\)/ }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("admin-camera-list.png", {
    fullPage: true,
  });
});

test("admin: camera edit form", async ({ page }) => {
  await page.goto("/cameras/1/");
  await expect(page.getByRole("heading", { name: "Edit camera" })).toBeVisible();
  await expect(page).toHaveScreenshot("admin-camera-edit.png", {
    fullPage: true,
  });
});
