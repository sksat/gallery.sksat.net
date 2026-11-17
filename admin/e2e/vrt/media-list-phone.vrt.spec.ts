import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("admin: media list (phone)", async ({ page }) => {
  await page.goto("/media/");
  await expect(
    page.getByRole("heading", { name: /Media \(5\)/ }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("admin-media-list-phone.png", {
    fullPage: true,
  });
});

test("admin: media list filter sheet (phone)", async ({ page }) => {
  await page.goto("/media/?world=VRChat");
  await page.getByRole("button", { name: "絞り込み (1)" }).click();
  await expect(page.getByRole("search", { name: "Filter" })).toBeVisible();
  await expect(page).toHaveScreenshot("admin-media-list-phone-filter.png");
});

test("admin: media list selection bar (phone)", async ({ page }) => {
  await page.goto("/media/");
  await page.getByRole("checkbox", { name: "Select #5", exact: true }).check();
  await page.getByRole("checkbox", { name: "Select #4", exact: true }).check();
  const bar = page.getByRole("region", { name: "選択した写真" });
  await expect(bar).toContainText("2 件選択");
  await bar.getByText("限定公開", { exact: true }).click();
  // Ticking scrolls the cards into view, by however much the run needs:
  // shoot from a fixed scroll position.
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(page.getByRole("radio", { name: "限定公開" })).toBeChecked();
  // The viewport, not the full page: the bar is fixed to its bottom.
  await expect(page).toHaveScreenshot("admin-media-list-phone-selection.png");
});
