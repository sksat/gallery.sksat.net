import { expect, test } from "@playwright/test";

// Numbers from e2e/fixture.sql (sizes set at its end). Runs before the
// specs that change visibility or upload.
test("dashboard: storage card adds up the fixture", async ({ page }) => {
  await page.goto("/");
  const storage = page.getByRole("region", { name: "容量" });
  await expect(storage).toBeVisible();
  await expect(storage.getByText("30.0 MB", { exact: true })).toBeVisible();
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

// B2 from the fixture's file sizes, the rest from e2e/fake-graphql.mjs,
// whose usage stays in the free tiers.
test("dashboard: cost card, one row per service", async ({ page }) => {
  await page.goto("/");
  const cost = page.getByRole("region", { name: "費用" });
  await expect(cost.getByTestId("cost-total")).toHaveText("< $0.01");
  await expect(cost).toContainText("/ 月 (見込み)");
  await expect(cost).not.toContainText("取得できなかった分を除く");
  const row = (key: string) => cost.locator(`[data-cost="${key}"]`);
  await expect(row("b2")).toContainText("Backblaze B2現在料金保存 30.0 MB");
  await expect(row("b2").locator("[data-cost-usd]")).toHaveText("< $0.01");
  await expect(row("r2")).toContainText(
    "保存 4.20 GB / 10.0 GBClass A 12,000 / 1,000,000Class B 250,000 / 10,000,000",
  );
  await expect(row("r2").locator("[data-cost-usd]")).toHaveText("$0.00");
  await expect(row("images")).toContainText("今月");
  await expect(row("images")).toContainText("変換 150 / 5,000");
  await expect(row("d1")).toContainText(
    "読み取り 45,000 / 5,000,000書き込み 300 / 100,000",
  );
  await expect(row("d1").locator("[data-cost-usd]")).toHaveText("無料");
  await expect(row("workers")).toContainText("今日");
  await expect(row("workers")).toContainText("リクエスト 12,345 / 100,000");
  await expect(row("free").locator("[data-cost-usd]")).toHaveText("無料");
  await expect(row("r2").getByRole("link", { name: "料金" })).toHaveAttribute(
    "href",
    "https://developers.cloudflare.com/r2/pricing/",
  );
});

test("dashboard: cost card without the token, and refused", async ({
  page,
}) => {
  await page.goto("/e2e/cost/?token=none");
  const cost = page.getByRole("region", { name: "費用" });
  // B2 is from D1 and needs no token.
  await expect(cost.locator('[data-cost="b2"]')).toContainText("保存 30.0 MB");
  for (const key of ["r2", "images", "d1", "workers"]) {
    await expect(cost.locator(`[data-cost="${key}"]`)).toContainText(
      "API トークン設定後に表示",
    );
  }
  await expect(cost.getByTestId("cost-total")).toHaveText("< $0.01");
  await expect(cost).toContainText("取得できなかった分を除く");

  await page.goto("/e2e/cost/?token=wrong");
  const images = cost.locator('[data-cost="images"]');
  await expect(images).toContainText("取得できませんでした");
  await expect(
    images.getByRole("link", { name: "Cloudflare の請求画面で確認" }),
  ).toHaveAttribute("href", /dash\.cloudflare\.com/);
  await expect(images.locator("[data-cost-usd]")).toHaveText("—");
  // Free plans stay free when unmeasured.
  await expect(
    cost.locator('[data-cost="workers"] [data-cost-usd]'),
  ).toHaveText("無料");
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

  // The six most viewed photos (forms of a photo's URL added up); an
  // unknown photo keeps its place.
  const photos = card.getByTestId("photo-ranking").getByRole("listitem");
  await expect(photos).toHaveCount(6);
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
  await expect(card.getByText("日本時間 (JST)")).toBeVisible();

  // The first five referrers (with their icons) and countries; the
  // innermost block under each heading is its list.
  const refs = card
    .locator("div", { has: page.getByRole("heading", { name: "参照元" }) })
    .last()
    .getByRole("listitem");
  await expect(refs).toHaveCount(5);
  await expect(refs.first()).toHaveText("Direct / None100");
  await expect(refs.first().locator("[data-referrer-icon]")).toHaveAttribute(
    "data-referrer-icon",
    "direct",
  );
  await expect(refs.nth(1).locator("[data-referrer-icon]")).toHaveAttribute(
    "data-referrer-icon",
    "x",
  );
  const countries = card
    .locator("div", {
      has: page.getByRole("heading", { name: "国", exact: true }),
    })
    .last()
    .getByRole("listitem");
  await expect(countries).toHaveCount(5);
  await expect(countries.first()).toHaveText("日本150");

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
  await expect(photos).toHaveCount(6);
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
  await expect(refs).toContainText("Direct / None");
  // The admin is not a referrer.
  await expect(refs).not.toContainText("admin.gallery.sksat.net");

  // Each referrer with its icon: bundled for well-known sites, the site's
  // favicon through the admin for others (a globe when it has none).
  const icon = (name: string) =>
    refs
      .getByRole("listitem")
      .filter({ hasText: name })
      .locator("[data-referrer-icon]");
  await expect(icon("Direct / None")).toHaveAttribute(
    "data-referrer-icon",
    "direct",
  );
  await expect(icon("t.co")).toHaveAttribute("data-referrer-icon", "x");
  await expect(icon("github.com")).toHaveAttribute(
    "data-referrer-icon",
    "github",
  );
  await expect(icon("misskey.io")).toHaveAttribute(
    "data-referrer-icon",
    "fediverse",
  );
  for (const host of ["friends-blog.net", "nofavicon.net"]) {
    await expect(icon(host)).toHaveAttribute("src", `/api/favicon/${host}/`);
    await expect(icon(host)).toHaveAttribute("alt", "");
  }
  // Both load as images: the site's own and the globe.
  await expect
    .poll(() =>
      icon("friends-blog.net").evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth,
      ),
    )
    .toBe(16);
  const found = await page.request.get("/api/favicon/friends-blog.net/");
  expect(found.headers()["content-type"]).toBe("image/png");
  expect(found.headers()["x-favicon"]).toBe("found");
  const missing = await page.request.get("/api/favicon/nofavicon.net/");
  expect(missing.headers()["content-type"]).toBe("image/svg+xml");
  expect(missing.headers()["x-favicon"]).toBe("missing");
  // Never a fetch to a local or private place.
  for (const host of [
    "localhost",
    "127.0.0.1",
    "169.254.169.254",
    "a.internal",
  ]) {
    const res = await page.request.get(`/api/favicon/${host}/`);
    expect(res.status(), host).toBe(400);
  }

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

// The time axis follows the clock, so any label can be at either end of
// it: wherever they are, the pages stay inside a phone's screen. Each
// label is moved through the whole axis (its --p) to stand for every hour.
for (const width of [320, 390]) {
  test(`access charts: no wider than a ${width}px phone at any hour`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const path of [
      "/",
      "/analytics/",
      "/analytics/?range=7d",
      "/media/2/",
    ]) {
      await page.goto(path);
      if (path === "/media/2/") {
        await page.getByTestId("photo-access").scrollIntoViewIfNeeded();
      }
      await expect(page.getByTestId("chart-ticks").first()).toBeVisible();
      const wider = await page.evaluate(async () => {
        const labels = [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid="chart-ticks"] > *, [data-testid="chart-days"] > *',
          ),
        ];
        const root = document.documentElement;
        for (let i = 0; i <= 20; i++) {
          const p = i / 20;
          for (const el of labels) el.style.setProperty("--p", String(p));
          await new Promise((r) => requestAnimationFrame(r));
          if (root.scrollWidth > root.clientWidth)
            return `page ${root.scrollWidth}px wide at --p ${p}`;
          for (const el of labels) {
            const a = el.parentElement!.getBoundingClientRect();
            const r = el.getBoundingClientRect();
            if (r.left < a.left - 0.5 || r.right > a.right + 0.5)
              return `"${el.textContent}" out of its axis at --p ${p}`;
          }
        }
        return null;
      });
      expect(wider, path).toBeNull();
    }
  });
}
