import { expect, test } from "@playwright/test";

// Numbers from e2e/fixture.sql (sizes set at its end). Runs before the
// specs that change visibility or upload.
test("dashboard: storage card adds up the fixture", async ({ page }) => {
  await page.goto("/");
  const storage = page.getByRole("region", { name: "容量" });
  await expect(storage).toBeVisible();
  await expect(storage.getByTestId("storage-cost")).toHaveText(
    "保存容量 30.0 MB · 月額の目安 約 < $0.01",
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

test("dashboard: access summary", async ({ page }) => {
  await page.goto("/");
  const card = page.getByRole("region", { name: "アクセス" });
  // The last 24 hours: each number with its change against the 24 hours
  // before.
  await expect(card).toContainText("過去 24 時間");
  await expect(card).toContainText("ページビュー250▲ +25% 前の 24 時間比");
  await expect(card).toContainText("訪問140▼ −30% 前の 24 時間比");
  await expect(card.getByText("概数")).toBeVisible();

  // The four most viewed photos (forms of a photo's URL added up); an
  // unknown photo keeps its place.
  const photos = card.getByTestId("photo-ranking").getByRole("listitem");
  await expect(photos).toHaveCount(4);
  await expect(photos.nth(0)).toContainText("50");
  await expect(photos.nth(0)).toContainText("vrchat1.png");
  await expect(photos.nth(0).getByRole("link")).toHaveAttribute(
    "href",
    "/media/2/",
  );
  await expect(photos.nth(1)).toContainText("vrchat2.png");
  await expect(photos.nth(2)).toContainText("/photo/zzzzzzzzzz/");
  await expect(photos.nth(2).getByRole("link")).toHaveCount(0);

  // The chart's numbers are in its table, and on hover; its hours are
  // labelled, and the newest one is still filling.
  const chart = card.getByTestId("column-chart");
  await expect(card.locator("table")).toContainText("時間ページビュー訪問");
  await expect(card.locator("tbody tr")).toHaveCount(24);
  await expect(card.getByTestId("chart-ticks")).toContainText("12時");
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await expect(card.getByTestId("chart-tooltip")).toContainText(
    /^\d+\/\d+ \(.\) \d+:00–\d+:00 \(集計中\)ページビュー/,
  );

  await card.getByRole("link", { name: "詳しく見る →" }).click();
  await expect(page).toHaveURL(/\/analytics\/$/);
  await expect(page.getByRole("heading", { name: "アクセス" })).toBeVisible();
});

test("analytics page: ranges, photos, pages, referrers", async ({ page }) => {
  await page.goto("/analytics/");
  // The last 24 hours by default.
  await expect(page.getByRole("link", { name: "24 時間" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("main")).toContainText(
    "ページビュー250▲ +25% 前の 24 時間比",
  );
  // Hours at 0, 6, 12 and 18 JST, the days from their midnight, the time
  // zone once, and which column is still filling.
  await expect(page.getByTestId("chart-ticks")).toHaveText(/^(\d+時){4}$/);
  await expect(page.getByTestId("chart-days")).toContainText(/\d+\/\d+ \(.\)/);
  await expect(page.getByTestId("chart-current")).toHaveText(
    /^薄い棒は集計中 \(\d+時台\)$/,
  );
  await expect(page.getByText("日本時間 (JST)")).toBeVisible();

  // Photos in their own ranking, then the other pages; the old numeric
  // URLs are one row at the end.
  const photos = page.getByTestId("photo-ranking").getByRole("listitem");
  await expect(photos).toHaveCount(4);
  await expect(photos.nth(3)).toContainText("vrchat3.png");
  const rows = page.getByTestId("page-ranking").getByRole("listitem");
  await expect(rows).toHaveText([
    "トップ（新しいタブ）120",
    "カメラ（新しいタブ）15",
    "VirtualLens2（新しいタブ）14",
    "2023年12月（新しいタブ）8",
    "地図（新しいタブ）6",
    "旧 URL6",
  ]);
  // Other pages open on the public site in a new tab.
  const camera = rows.nth(2).getByRole("link");
  await expect(camera).toHaveAttribute(
    "href",
    "https://gallery.sksat.net/camera/virtuallens2/",
  );
  await expect(camera).toHaveAttribute("target", "_blank");
  await expect(camera).toHaveAttribute("rel", "noopener noreferrer");
  await expect(rows.nth(5).getByRole("link")).toHaveCount(0);

  const refs = page.getByRole("region", { name: "参照元" });
  await expect(refs).toContainText("t.co");
  await expect(refs).toContainText("(直接)");
  // The admin is not a referrer.
  await expect(refs).not.toContainText("admin.gallery.sksat.net");

  // Countries: a map shaded by views, and the first ten as a list.
  const countries = page.getByRole("region", { name: "国", exact: true });
  await expect(countries.getByRole("listitem")).toHaveCount(10);
  await expect(countries.getByRole("listitem").first()).toHaveText("日本150");
  await expect(countries.getByRole("list")).not.toContainText("シンガポール");
  // Screen readers get every country (Singapore is too small for the map).
  await expect(countries.locator("table tbody tr")).toHaveCount(11);
  await expect(countries.locator("table")).toContainText("シンガポール1");
  const map = countries.getByTestId("world-map");
  await expect(map.getByRole("img", { name: /地図/ })).toBeVisible();
  // The most viewed country gets the darkest step, one without views none.
  await expect(map.locator('path[data-code="JP"]')).toHaveAttribute(
    "style",
    /var\(--m4\)/,
  );
  await expect(map.locator('path[data-code="CN"]')).toHaveAttribute(
    "style",
    /var\(--mn\)/,
  );
  await map.locator('path[data-code="DE"]').hover();
  await expect(map.getByTestId("map-tooltip")).toHaveText("10ドイツ");
  await map.locator('path[data-code="CN"]').hover();
  await expect(map.getByTestId("map-tooltip")).toHaveText("なし中国");

  // The chart: one column per hour; arrow keys move the tooltip, which
  // starts on the newest column, still filling.
  const chart = page.getByTestId("column-chart");
  await chart.focus();
  const tip = page.getByTestId("chart-tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("(集計中)");
  const last = await tip.textContent();
  await page.keyboard.press("ArrowLeft");
  await expect(tip).not.toHaveText(last!);
  await expect(tip).not.toContainText("(集計中)");
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);

  // Switching the range keeps the page where it is.
  await page.setViewportSize({ width: 1280, height: 300 });
  const d7 = page.getByRole("link", { name: "7 日", exact: true });
  await page.evaluate(() => window.scrollTo(0, 60));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  await d7.click();
  await expect(page).toHaveURL(/\/analytics\/\?range=7d$/);
  await expect(d7).toHaveAttribute("aria-current", "page");
  await expect(page.locator("table").first()).toContainText(
    "日ページビュー訪問",
  );
  await expect(page.getByRole("main")).toContainText("前の 7 日比");
  // Days: every date labelled, no day row; today is still filling.
  await expect(page.getByTestId("chart-ticks")).toHaveText(/^(\d+\/\d+){7}$/);
  await expect(page.getByTestId("chart-days")).toHaveCount(0);
  await expect(page.getByTestId("chart-current")).toHaveText(
    "薄い棒は集計中 (今日)",
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test("media edit page: the photo's access, loaded when shown", async ({
  page,
}) => {
  await page.goto("/media/2/");
  const card = page.getByTestId("photo-access");
  // Nothing is asked before the card is on screen.
  await page.waitForLoadState("networkidle");
  await expect(card).toContainText("読み込み中");
  await card.scrollIntoViewIfNeeded();

  // The last 24 hours first, one column per hour.
  await expect(card.getByRole("button", { name: "24 時間" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(card).toContainText("前の 24 時間比");
  await expect(card.locator("tbody tr")).toHaveCount(24);

  // Another range: asked again, one column per day.
  await card.getByRole("button", { name: "7 日" }).click();
  await expect(card.getByRole("button", { name: "7 日" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(card.locator("tbody tr")).toHaveCount(7);

  // Its viewer and detail pages, together and apart; the change against
  // the 7 days before.
  await expect(card).toContainText("ページビュー30▼ −50% 前の 7 日比");
  await expect(card).toContainText("訪問9±0% 前の 7 日比");
  await expect(card).toContainText("ビューア27");
  await expect(card).toContainText("詳細ページ3");
  await expect(card).toContainText("bsky.app");
  await expect(card).toContainText("台湾");
  // The site itself is not a referrer.
  await expect(card).not.toContainText("gallery.sksat.net");

  // Hovering a column shows both pages and their sum.
  const chart = card.getByTestId("column-chart");
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * (1.5 / 7), box.y + box.height - 2);
  await expect(card.getByTestId("chart-tooltip")).toContainText(
    /合計5ビューア4詳細ページ1/,
  );
});

test("media edit page: a photo nobody viewed", async ({ page }) => {
  await page.goto("/media/3/");
  const card = page.getByTestId("photo-access");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText("ページビュー0前の 24 時間 0");
  await expect(card).toContainText("参照元なし");
});
