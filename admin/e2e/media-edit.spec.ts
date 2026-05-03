import { expect, test } from "@playwright/test";

test("media edit: tags can be saved and reflected on the list", async ({ page }) => {
  await page.goto("/media/3/");
  await expect(
    page.getByRole("heading", { name: "Edit #3" }),
  ).toBeVisible();

  const tagsInput = page.locator('input[name="tags"]');
  await tagsInput.fill("alpha, beta");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();

  await page.goto("/media/?q=real2");
  await expect(page.locator("table tbody tr")).toHaveCount(1);
  await expect(page.locator("table tbody tr").first()).toContainText(
    "alpha, beta",
  );
});

test("media edit: world can be changed", async ({ page }) => {
  await page.goto("/media/1/");
  await page.locator('select[name="world"]').selectOption("VRChat");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();

  await page.goto("/media/?world=VRChat");
  await expect(page.locator("table tbody")).toContainText("/mock/real1.png");

  // Restore so subsequent tests see the original fixture world distribution.
  await page.goto("/media/1/");
  await page.locator('select[name="world"]').selectOption("Real");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();
});
