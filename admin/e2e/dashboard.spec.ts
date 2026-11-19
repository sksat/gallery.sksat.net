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

  // One ranking of pages, each form of a page added up; the old numeric
  // URLs are one row at the end.
  const rows = card.getByTestId("page-ranking").getByRole("listitem");
  await expect(rows).toHaveText([
    // Pages say (to screen readers) that they open in a new tab; the
    // placeholder thumbnails say PNG.
    "トップ（新しいタブ）120",
    "PNG/mock/vrchat1.pngPublic50",
    "PNG/mock/vrchat2.pngUnlisted25",
    "カメラ（新しいタブ）15",
    "VirtualLens2（新しいタブ）14",
    "2023年12月（新しいタブ）8",
    "地図（新しいタブ）6",
    "/photo/zzzzzzzzzz/5",
    "PNG/mock/vrchat3.pngPrivate4",
    "旧 URL6",
  ]);

  // A photo opens its edit page, with its public page beside it.
  const photo = rows.nth(1);
  const edit = photo.getByRole("link", { name: /\/mock\/vrchat1\.png/ });
  await expect(edit).toHaveAttribute("href", "/media/2/");
  const external = photo.getByRole("link", {
    name: "公開サイトで開く（新しいタブ）",
  });
  await expect(external).toHaveAttribute(
    "href",
    "https://gallery.sksat.net/photo/aaaaaaaaa3/",
  );
  await expect(external).toHaveAttribute("target", "_blank");
  // A private photo has no public page to open.
  await expect(rows.nth(8).getByRole("link")).toHaveCount(1);

  // Other pages open on the public site in a new tab.
  const camera = rows.nth(4).getByRole("link");
  await expect(camera).toHaveAttribute(
    "href",
    "https://gallery.sksat.net/camera/virtuallens2/",
  );
  await expect(camera).toHaveAttribute("target", "_blank");
  await expect(camera).toHaveAttribute("rel", "noopener noreferrer");
  await expect(rows.nth(5).getByRole("link")).toHaveAttribute(
    "href",
    "https://gallery.sksat.net/calendar/2023/12/",
  );
  // An unknown photo and the old URLs lead nowhere.
  await expect(rows.nth(7).getByRole("link")).toHaveCount(0);
  await expect(rows.nth(9).getByRole("link")).toHaveCount(0);

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
