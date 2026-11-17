import { expect, test, type Page } from "@playwright/test";

// Bulk visibility on a phone: tick cards, the bottom selection bar, undo.
// Fixture (e2e/fixture.sql): rows 1-3 public, 4 unlisted, 5 private.
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

const card = (page: Page, file: string) =>
  page.getByTestId("media-card").filter({ hasText: file });
const bar = (page: Page) => page.getByRole("region", { name: "選択した写真" });

test("the left column of a card ticks it without opening the photo", async ({
  page,
}) => {
  await page.goto("/media/");
  const real1 = card(page, "real1.png");
  await real1.scrollIntoViewIfNeeded();
  const box = await real1.boundingBox();
  if (!box) throw new Error("card not rendered");
  // Near the left edge, well away from the checkbox itself.
  await page.touchscreen.tap(box.x + 8, box.y + box.height - 8);
  await expect(
    real1.getByRole("checkbox", { name: "Select #1", exact: true }),
  ).toBeChecked();
  await expect(page).toHaveURL(/\/media\/$/);
  await expect(bar(page)).toContainText("1 件選択");
  // Once something is ticked, a tap on a card ticks it too.
  await card(page, "real2.png").getByText("real2.png").tap();
  await expect(bar(page)).toContainText("2 件選択");
  await expect(page).toHaveURL(/\/media\/$/);
});

test("selection mode, select all and done", async ({ page }) => {
  await page.goto("/media/");
  await page.getByRole("button", { name: "選択", exact: true }).tap();
  await expect(page.getByRole("button", { name: "完了" })).toBeVisible();
  await card(page, "vrchat1.png").getByText("vrchat1.png").tap();
  await expect(bar(page)).toContainText("1 件選択");
  await expect(page).toHaveURL(/\/media\/$/);

  await bar(page).getByRole("button", { name: "すべて選択" }).tap();
  await expect(bar(page)).toContainText("5 件選択");
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(5);
  // The page pads itself so the last card scrolls clear of the bar.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const last = await page.getByTestId("media-card").last().boundingBox();
  const barBox = await bar(page).boundingBox();
  expect(last!.y + last!.height).toBeLessThanOrEqual(barBox!.y);
  await bar(page).getByRole("button", { name: "選択解除" }).tap();
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);

  // Back out of selection mode: a tap opens the photo again.
  await page.getByRole("button", { name: "完了" }).tap();
  await card(page, "vrchat1.png").getByText("vrchat1.png").tap();
  await expect(page.getByRole("heading", { name: "Edit #2" })).toBeVisible();
});

test("apply from the bottom bar, then undo", async ({
  page,
  request,
  baseURL,
}) => {
  try {
    await page.goto("/media/");
    // The bar above the table is for larger screens.
    await expect(page.locator("#bulk-visibility")).toBeHidden();

    await page.getByRole("checkbox", { name: "Select #1", exact: true }).tap();
    await page.getByRole("checkbox", { name: "Select #4", exact: true }).tap();
    const apply = bar(page).getByRole("button", { name: "適用" });
    // Nothing picked yet.
    await expect(apply).toBeDisabled();
    await bar(page).getByText("非公開", { exact: true }).tap();
    await apply.tap();

    await expect(
      page.getByRole("status").filter({ hasText: "selected" }),
    ).toHaveText("2 selected, 2 changed to Private.");
    // Applied: the selection is cleared.
    await expect(bar(page)).toHaveCount(0);
    await expect(card(page, "real1.png")).toContainText("Private");
    await expect(card(page, "vrchat2.png")).toContainText("Private");

    await page.getByRole("button", { name: "元に戻す" }).tap();
    await expect(page.getByRole("status")).toHaveText("元に戻しました。");
    await expect(card(page, "real1.png")).toContainText("Public");
    await expect(card(page, "vrchat2.png")).toContainText("Unlisted");
  } finally {
    // Restore the fixture even if an assertion failed.
    for (const [id, visibility] of [
      [1, "public"],
      [4, "unlisted"],
    ] as const) {
      await request.fetch(`${baseURL}/api/media/${id}/`, {
        method: "PATCH",
        headers: { origin: baseURL!, "content-type": "application/json" },
        data: { visibility },
      });
    }
  }
});
