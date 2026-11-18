import { test, expect, type Page } from "@playwright/test";

// The cards' numbers come from e2e/fixture.sql and e2e/fake-graphql.mjs;
// only the dates move with the clock, so they are masked.
const shoot = (page: Page, name: string) =>
  expect(page).toHaveScreenshot(name, {
    fullPage: true,
    mask: [page.locator("[data-date]")],
  });

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("admin dashboard: home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "アクセス" })).toBeVisible();
    await shoot(page, "admin-home.png");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("admin dashboard: home (phone)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "アクセス" })).toBeVisible();
    await shoot(page, "admin-home-phone.png");
  });
});
