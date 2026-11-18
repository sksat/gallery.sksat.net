import { expect, test, type Page } from "@playwright/test";

// The trash with one fixture photo in it (put there from its edit page,
// and taken out again afterwards so the other baselines keep it). The
// trashed-at time is masked: it is when the test ran.

const trashPhoto5 = async (page: Page) => {
  await page.goto("/media/5/");
  await page.getByRole("button", { name: "ゴミ箱へ" }).click();
  await expect(page.getByText(/ゴミ箱にあります/)).toBeVisible();
};

const restorePhoto5 = async (page: Page) => {
  await page.goto("/media/5/");
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByRole("button", { name: "ゴミ箱へ" })).toBeVisible();
};

for (const [name, viewport] of [
  ["admin-media-trash.png", { width: 1280, height: 800 }],
  ["admin-media-trash-phone.png", { width: 390, height: 844 }],
] as const) {
  test(`admin: trash (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await trashPhoto5(page);
    try {
      await page.goto("/media/trash/");
      await expect(page.getByTestId("trash-row")).toHaveCount(1);
      await expect(page).toHaveScreenshot(name, {
        fullPage: true,
        mask: [page.getByTestId("trashed-at")],
      });
    } finally {
      await restorePhoto5(page);
    }
  });
}
