import { test, expect } from "@playwright/test";

test("admin: dashboard renders", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Gallery Admin Dashboard" }),
  ).toBeVisible();
});
