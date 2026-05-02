import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test("admin dashboard: home", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Gallery Admin Dashboard" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("admin-home.png", { fullPage: true });
});
