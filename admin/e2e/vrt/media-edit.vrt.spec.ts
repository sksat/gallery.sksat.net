import { expect, test, type Page } from "@playwright/test";

// The access card loads once on screen (e2e/fake-graphql.mjs numbers);
// its dates move with the clock, so they are masked.
const open = async (page: Page) => {
  await page.goto("/media/2/");
  await expect(page.getByRole("heading", { name: "Edit #2" })).toBeVisible();
  const access = page.getByTestId("photo-access");
  await access.scrollIntoViewIfNeeded();
  await expect(access).toContainText("ビューア");
  await page.evaluate(() => window.scrollTo(0, 0));
};
const shoot = (page: Page, name: string) =>
  expect(page).toHaveScreenshot(name, {
    fullPage: true,
    mask: [page.locator("[data-date]")],
  });

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("admin: media edit form", async ({ page }) => {
    await open(page);
    await shoot(page, "admin-media-edit.png");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("admin: media edit form (phone)", async ({ page }) => {
    await open(page);
    await shoot(page, "admin-media-edit-phone.png");
  });
});
