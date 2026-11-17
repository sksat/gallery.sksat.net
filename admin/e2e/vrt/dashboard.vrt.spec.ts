import { test, expect } from "@playwright/test";

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("admin dashboard: home", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Gallery Admin Dashboard" }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("admin-home.png", { fullPage: true });
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("admin dashboard: home (phone)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "容量" })).toBeVisible();
    await expect(page).toHaveScreenshot("admin-home-phone.png", {
      fullPage: true,
    });
  });
});
