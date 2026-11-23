import { test, expect, type Page } from "@playwright/test";
import { CLOCK_STYLE } from "./clock";

// The cards' numbers come from e2e/fixture.sql and e2e/fake-graphql.mjs;
// only the dates and times move with the clock: masked or hidden.
const shoot = async (page: Page, name: string) => {
  await page.addStyleTag({ content: CLOCK_STYLE });
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    mask: [page.locator("[data-date]")],
  });
};

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("admin dashboard: home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "アクセス" })).toBeVisible();
    await shoot(page, "admin-home.png");
  });

  test("admin dashboard: access", async ({ page }) => {
    await page.goto("/analytics/");
    await expect(page.getByTestId("photo-ranking")).toBeVisible();
    await shoot(page, "admin-analytics.png");
  });

  // 7 days: an hour's tooltip would change width with the clock.
  test("admin dashboard: access chart tooltip", async ({ page }) => {
    await page.goto("/analytics/?range=7d");
    const chart = page.getByTestId("column-chart");
    await chart.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("chart-tooltip")).toBeVisible();
    await page.addStyleTag({ content: CLOCK_STYLE });
    await expect(page.getByRole("region", { name: "推移" })).toHaveScreenshot(
      "admin-analytics-tooltip.png",
      { mask: [page.locator("[data-date]")] },
    );
  });

  test("admin dashboard: countries map tooltip", async ({ page }) => {
    await page.goto("/analytics/");
    const map = page.getByTestId("world-map");
    await map.locator('path[data-code="DE"]').hover();
    await expect(page.getByTestId("map-tooltip")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "国", exact: true }),
    ).toHaveScreenshot("admin-analytics-map.png");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("admin dashboard: home (phone)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "アクセス" })).toBeVisible();
    await shoot(page, "admin-home-phone.png");
  });

  test("admin dashboard: access (phone)", async ({ page }) => {
    await page.goto("/analytics/");
    await expect(page.getByTestId("photo-ranking")).toBeVisible();
    await shoot(page, "admin-analytics-phone.png");
  });
});
