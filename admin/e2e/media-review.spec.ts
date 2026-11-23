import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

// Going through photos in the full-screen viewer: ←/→ (or a swipe) through
// the list it was opened from, 1/2/3 (or the buttons) to mark a pending
// visibility and go on, and the bar: 反映 / 破棄 / 元に戻す.
// Fixture (e2e/fixture.sql), /mock by name: real1 (#1, public),
// real2 (#3, public), vrchat1 (#2, public), vrchat2 (#4, unlisted),
// vrchat3 (#5, private).

const FIXTURE: Record<number, string> = {
  1: "public",
  2: "public",
  3: "public",
  4: "unlisted",
  5: "private",
};

/** Put every fixture photo's visibility back (other specs count them). */
const restore = async (request: APIRequestContext, baseURL: string) => {
  for (const [id, visibility] of Object.entries(FIXTURE)) {
    const res = await request.fetch(`${baseURL}/api/media/${id}/`, {
      method: "PATCH",
      headers: { origin: baseURL, "content-type": "application/json" },
      data: { visibility },
    });
    expect(res.ok()).toBe(true);
  }
};

const viewer = (page: Page) => page.getByTestId("fullscreen");
const position = (page: Page) => page.getByTestId("viewer-position");

/** Open real1 from the /mock folder, then its viewer. */
const openFromFolder = async (page: Page) => {
  await page.goto("/media/?view=files&dir=/mock");
  await page.getByTestId("file-tile").filter({ hasText: "real1.png" }).click();
  await expect(page.getByRole("heading", { name: "Edit #1" })).toBeVisible();
  await page.getByRole("button", { name: "写真を全画面で表示" }).click();
  await expect(viewer(page)).toBeVisible();
  await expect(position(page)).toHaveText("1 / 5");
};

test.afterEach(async ({ request, baseURL }) => {
  await restore(request, baseURL!);
});

test("arrows step through the folder in the viewer, and the URL follows", async ({
  page,
}) => {
  await openFromFolder(page);
  await expect(page).toHaveURL(/\/media\/1\/\?back=.*&fs=1$/);

  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/media\/3\/\?.*fs=1/);
  await expect(position(page)).toHaveText("2 / 5");
  await expect(page.getByTestId("viewer-info")).toContainText("real2.png");
  await page.keyboard.press("ArrowRight");
  await expect(position(page)).toHaveText("3 / 5");
  await page.keyboard.press("ArrowLeft");
  await expect(position(page)).toHaveText("2 / 5");

  // A reload reopens the viewer on the same photo.
  await page.reload();
  await expect(viewer(page)).toBeVisible();
  await expect(position(page)).toHaveText("2 / 5");

  // Escape closes it, back on that photo's page.
  await page.keyboard.press("Escape");
  await expect(viewer(page)).toBeHidden();
  await expect(page.getByRole("heading", { name: "Edit #3" })).toBeVisible();
  await expect(page).not.toHaveURL(/fs=1/);
});

const bar = (page: Page) => page.getByTestId("pending-bar");
const counts = (page: Page) => page.getByTestId("pending-counts");
const marker = (page: Page) => page.getByTestId("viewer-pending");

test("1/2/3 mark a choice and go on; 反映 applies them, 元に戻す reverts", async ({
  page,
}) => {
  await openFromFolder(page);
  // The current visibility's button is the pressed one; with a keyboard,
  // each button shows its key.
  const pub = page.getByRole("button", { name: /^公開/ });
  await expect(pub).toHaveAttribute("aria-pressed", "true");
  await expect(pub.locator("kbd")).toHaveText("3");
  await expect(pub.locator("kbd")).toBeVisible();
  await expect(bar(page)).toHaveCount(0);

  // real1 (#1) → 非公開: only marked, and on to real2 (#3).
  await page.keyboard.press("1");
  await expect(position(page)).toHaveText("2 / 5");
  await expect(counts(page)).toHaveText("非公開1");
  // real2 → 限定公開; vrchat1 (#2) → 非公開.
  await page.keyboard.press("2");
  await expect(position(page)).toHaveText("3 / 5");
  await page.keyboard.press("1");
  await expect(position(page)).toHaveText("4 / 5");
  // Back on vrchat1: saved 公開, marked 非公開; the same key clears it.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("viewer-visibility")).toHaveText("公開");
  await expect(marker(page)).toContainText("非公開");
  await page.keyboard.press("1");
  await expect(marker(page)).toHaveCount(0);
  await expect(position(page)).toHaveText("3 / 5");
  // On real2, choosing its saved level clears it too; then mark it again.
  await page.keyboard.press("ArrowLeft");
  await expect(marker(page)).toContainText("限定公開");
  await page.keyboard.press("3");
  await expect(marker(page)).toHaveCount(0);
  await page.keyboard.press("2");
  await expect(position(page)).toHaveText("3 / 5");
  await expect(counts(page)).toHaveText("限定公開1非公開1");

  // Nothing is saved yet, and a reload keeps the choices.
  page.on("dialog", (d) => void d.accept());
  await page.reload();
  await expect(viewer(page)).toBeVisible();
  await expect(counts(page)).toHaveText("限定公開1非公開1");

  // 反映: real2 becomes visible to others, so it is shown first.
  await bar(page).getByRole("button", { name: "反映" }).click();
  await expect(page.getByTestId("pending-confirm")).toBeVisible();
  await expect(
    page.getByTestId("pending-confirm").getByTestId("thumb-placeholder"),
  ).toHaveCount(1);
  await bar(page).getByRole("button", { name: "反映" }).click();
  const notice = page.getByTestId("pending-notice");
  await expect(notice).toContainText("2 件を反映しました");
  await expect(counts(page)).toHaveCount(0);
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("viewer-visibility")).toHaveText("限定公開");

  // 元に戻す: the whole batch.
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(notice).toContainText("元に戻しました");
  await expect(page.getByTestId("viewer-visibility")).toHaveText("公開");
  await page.goto("/media/1/");
  await expect(page.getByTestId("visibility-badge")).toHaveText("Public");
});

for (const size of [
  { width: 1024, height: 600 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
  { width: 667, height: 375 },
]) {
  test(`many photos to look at keep 反映 on screen (${size.width}×${size.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openFromFolder(page);
    // 150 pending choices that make photos public, seeded the way the
    // viewer stores them (pendingKey of the list). Their ids belong to no
    // photo: the bulk update skips them, so applying changes nothing
    // (other specs count the fixture's visibilities).
    await page.evaluate(() => {
      const params = new URLSearchParams("view=files&dir=/mock");
      const pending: Record<number, unknown> = {};
      for (let i = 0; i < 150; i++) {
        pending[100_000 + i] = {
          to: "public",
          from: "private",
          file: `/x/${i}.png`,
        };
      }
      sessionStorage.setItem(
        `admin-review-pending:/media/?${params.toString()}`,
        JSON.stringify(pending),
      );
    });
    await page.reload();
    await expect(viewer(page)).toBeVisible();
    await expect(counts(page)).toContainText("150");

    await bar(page).getByRole("button", { name: "反映" }).click();
    const confirm = page.getByTestId("pending-confirm");
    await expect(confirm).toBeVisible();
    const apply = bar(page).getByRole("button", { name: "反映" });
    await expect(apply).toBeInViewport({ ratio: 1 });
    await expect(
      bar(page).getByRole("button", { name: "戻る" }),
    ).toBeInViewport({ ratio: 1 });
    await apply.click();
    await expect(counts(page)).toHaveCount(0);
  });
}

test("making photos private applies without the look first", async ({
  page,
}) => {
  await openFromFolder(page);
  await page.keyboard.press("1");
  await expect(position(page)).toHaveText("2 / 5");
  await bar(page).getByRole("button", { name: "反映" }).click();
  await expect(page.getByTestId("pending-notice")).toContainText(
    "1 件を反映しました",
  );
  await expect(page.getByTestId("pending-confirm")).toHaveCount(0);
});

test("on the last photo a choice stays there", async ({ page }) => {
  await openFromFolder(page);
  for (const at of ["2 / 5", "3 / 5", "4 / 5", "5 / 5"]) {
    await page.keyboard.press("ArrowRight");
    await expect(position(page)).toHaveText(at);
  }
  await expect(position(page)).toHaveText("5 / 5");
  await expect(position(page)).toHaveAttribute("data-end", "");
  await page.keyboard.press("3");
  await expect(marker(page)).toContainText("公開");
  await expect(page.getByRole("button", { name: /^公開/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.waitForTimeout(600);
  await expect(position(page)).toHaveText("5 / 5");
});

test("pending choices ask before leaving; 破棄 drops them", async ({
  page,
}) => {
  await openFromFolder(page);
  await page.keyboard.press("2");
  await expect(position(page)).toHaveText("2 / 5");
  // Closing the viewer keeps them, in the bar on the page.
  await page.keyboard.press("Escape");
  await expect(viewer(page)).toBeHidden();
  await expect(counts(page)).toHaveText("限定公開1");

  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await page.getByRole("link", { name: "← Media" }).click();
  await expect.poll(() => asked).toContain("反映していない");
  await expect(page.getByRole("heading", { name: "Edit #3" })).toBeVisible();
  // Staying does not reopen the viewer (it would cover the page).
  await page.waitForTimeout(300);
  await expect(viewer(page)).toBeHidden();

  await bar(page).getByRole("button", { name: "破棄" }).click();
  await expect(bar(page)).toHaveCount(0);
  await page.getByRole("link", { name: "← Media" }).click();
  await expect(page).toHaveURL(/\/media\/\?/);
});

test("staying after a browser Back keeps the viewer closed on reload", async ({
  page,
}) => {
  await openFromFolder(page);
  // A step in the viewer (marking one), then close it.
  await page.keyboard.press("2");
  await expect(position(page)).toHaveText("2 / 5");
  await page.keyboard.press("Escape");
  await expect(viewer(page)).toBeHidden();
  await expect(page).not.toHaveURL(/fs=1/);

  // Browser Back with a pending choice asks; stay.
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await page.evaluate(() => history.back());
  await expect.poll(() => asked).toContain("反映していない");
  await expect(page).toHaveURL(/\/media\/3\//);
  await expect(page).not.toHaveURL(/fs=1/);

  // A reload stays on the page, viewer closed.
  page.on("dialog", (d) => void d.accept());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Edit #3" })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(viewer(page)).toBeHidden();
});

test("held keys, typing and IME do not trigger shortcuts", async ({ page }) => {
  await openFromFolder(page);
  let posts = 0;
  page.on("request", (r) => {
    // (The background metadata reader and resized-copy maker post on
    // their own.)
    if (
      r.method() === "POST" &&
      !r.url().includes("/api/metadata/") &&
      !r.url().includes("/api/resized")
    ) {
      posts++;
    }
  });
  // Held down: one choice and one step only, and nothing saved.
  await page.keyboard.down("1");
  await page.keyboard.down("1");
  await page.keyboard.up("1");
  await expect(position(page)).toHaveText("2 / 5");
  await page.waitForTimeout(500);
  await expect(position(page)).toHaveText("2 / 5");
  await expect(counts(page)).toHaveText("非公開1");
  expect(posts).toBe(0);
  await bar(page).getByRole("button", { name: "破棄" }).click();

  // In a field on the page: arrows move the caret, not the photo.
  await page.keyboard.press("Escape");
  await expect(viewer(page)).toBeHidden();
  await expect(page.getByRole("heading", { name: "Edit #3" })).toBeVisible();
  // (Closing gives focus back to the photo first.)
  await expect(
    page.getByRole("button", { name: "写真を全画面で表示" }),
  ).toBeFocused();
  const tags = page.getByLabel("タグを追加");
  await tags.focus();
  await page.waitForTimeout(300);
  await expect(tags).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/media\/3\//);

  // Outside fields the page itself steps too.
  await tags.blur();
  await page.locator("h1").click();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "Edit #2" })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("swipe to step, big buttons to set the visibility", async ({ page }) => {
    await page.goto("/media/?view=files&dir=/mock");
    await page.getByTestId("file-tile").filter({ hasText: "real1.png" }).tap();
    await expect(page.getByRole("heading", { name: "Edit #1" })).toBeVisible();
    await page.getByRole("button", { name: "写真を全画面で表示" }).tap();
    await expect(position(page)).toHaveText("1 / 5");

    /** A swipe from x = `from` to x = `to`. */
    const swipeFrom = (from: number, to: number) =>
      viewer(page).evaluate(
        (el, [from, to]) => {
          const touch = (x: number) =>
            new Touch({ identifier: 1, target: el, clientX: x, clientY: 400 });
          el.dispatchEvent(
            new TouchEvent("touchstart", {
              bubbles: true,
              touches: [touch(from)],
              changedTouches: [touch(from)],
            }),
          );
          el.dispatchEvent(
            new TouchEvent("touchend", {
              bubbles: true,
              touches: [],
              changedTouches: [touch(to)],
            }),
          );
        },
        [from, to],
      );
    // Its listeners come with a visible task.
    await expect(viewer(page)).toHaveAttribute("data-swipe-ready", "");
    await swipeFrom(300, 150);
    await expect(position(page)).toHaveText("2 / 5");
    // Still swipes on the photo stepped to: back, and on again.
    await swipeFrom(150, 300);
    await expect(position(page)).toHaveText("1 / 5");
    await swipeFrom(300, 150);
    await expect(position(page)).toHaveText("2 / 5");

    // 非公開 / 限定公開 / 公開, large enough to tap.
    const priv = page.getByRole("button", { name: /^非公開/ });
    const box = await priv.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    // No key hints on a touch screen.
    await expect(priv.locator("kbd")).toBeHidden();
    await priv.tap();
    await expect(position(page)).toHaveText("3 / 5");
    // The bar right above the buttons, in thumb reach.
    const apply = bar(page).getByRole("button", { name: "反映" });
    const applyBox = await apply.boundingBox();
    expect(applyBox!.height).toBeGreaterThanOrEqual(44);
    expect(applyBox!.y).toBeLessThan(box!.y);
    expect(applyBox!.y).toBeGreaterThan(box!.y - 150);
    await apply.tap();
    await expect(page.getByTestId("pending-notice")).toContainText(
      "1 件を反映しました",
    );
  });
});
