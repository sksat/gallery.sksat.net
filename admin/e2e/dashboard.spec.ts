import { expect, test } from "@playwright/test";

// Numbers from e2e/fixture.sql (sizes set at its end). Runs before the
// specs that change visibility or upload.
test("dashboard: storage card adds up the fixture", async ({ page }) => {
  await page.goto("/");
  const storage = page.getByRole("region", { name: "容量" });
  await expect(storage).toBeVisible();
  await expect(storage.getByTestId("storage-cost")).toHaveText(
    "保存容量 30.0 MB · 月額の目安 約 $0.00（10 GB まで無料）",
  );
  await expect(storage.getByText("5 枚", { exact: true })).toBeVisible();

  const row = (label: string) =>
    storage.getByRole("listitem").filter({ hasText: label });
  await expect(row("限定公開")).toContainText("12.0 MB · 1 枚");
  await expect(row("非公開")).toContainText("6.00 MB · 1 枚");
  await expect(
    storage.getByRole("listitem").filter({ hasText: /^公開/ }),
  ).toContainText("12.0 MB · 3 枚");
  await expect(row("/mock")).toContainText("30.0 MB · 5 枚");
  await expect(storage).toContainText("アップロード中 なし");
});

// The analytics numbers come from e2e/fake-graphql.mjs (the E2E server's
// token is a test value; the real API is never asked).
test("dashboard: D1 card with today's reads and writes", async ({ page }) => {
  await page.goto("/");
  const d1 = page.getByRole("region", { name: "D1" });
  await expect(d1).toContainText("データベースのサイズ");
  await expect(d1).toContainText("/ 500 MB");
  await expect(d1).toContainText(
    "今日の読み取り45,000 行 / 5,000,000 行 (0.9%)",
  );
  await expect(d1).toContainText("今日の書き込み300 行 / 100,000 行 (0.3%)");
});

test("dashboard: access card", async ({ page }) => {
  await page.goto("/");
  const card = page.getByRole("region", { name: "アクセス" });
  await expect(card).toContainText("ページビュー約 250");
  await expect(card).toContainText("訪問約 140");
  await expect(
    card.getByRole("link", { name: "7 日", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  // Photo 2 adds up /photo/aaaaaaaaa3/ and /photo/aaaaaaaaa3; links to its
  // edit page. An unknown public id and the old /photo/1 are left out
  // (the latter is only a page).
  const photos = card.getByRole("listitem").filter({ hasText: "PV" });
  await expect(photos).toHaveCount(2);
  await expect(photos.nth(0)).toContainText("/mock/vrchat1.png");
  await expect(photos.nth(0)).toContainText("50 PV");
  await expect(photos.nth(1)).toContainText("/mock/vrchat2.png");
  await expect(photos.nth(0).getByRole("link")).toHaveAttribute(
    "href",
    "/media/2/",
  );

  await expect(card).toContainText("日本");
  await expect(card).toContainText("t.co");
  await expect(card).toContainText("(直接)");
  // The admin is not a referrer.
  await expect(card).not.toContainText("admin.gallery.sksat.net");

  await card.getByRole("link", { name: "24 時間" }).click();
  await expect(page).toHaveURL(/\?range=24h$/);
  await expect(card.getByRole("link", { name: "24 時間" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(card).toContainText("時間ごとのページビュー");
});

test("media edit page: the photo's views", async ({ page }) => {
  await page.goto("/media/2/");
  await expect(page.getByTestId("photo-views")).toHaveText(
    "閲覧数 (概数) 7 日 50 · 30 日 50",
  );
});
