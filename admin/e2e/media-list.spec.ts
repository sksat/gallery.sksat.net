import { expect, test } from "@playwright/test";

test("media list: renders fixture rows and filters by world", async ({ page }) => {
  const response = await page.goto("/media/");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { name: /Media \(5\)/ })).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(5);

  await page.locator('select[name="world"]').selectOption("VRChat");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/world=VRChat/);
  await expect(page.locator("table tbody tr")).toHaveCount(3);

  await page.getByRole("link", { name: "Reset" }).click();
  await expect(page.locator("table tbody tr")).toHaveCount(5);
});

test("media list: search by file substring", async ({ page }) => {
  await page.goto("/media/");
  await page.locator('input[name="q"]').fill("vrchat1");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.locator("table tbody tr")).toHaveCount(1);
  await expect(page.locator("table tbody")).toContainText("/mock/vrchat1.png");
});
