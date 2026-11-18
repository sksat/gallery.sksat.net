import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

// Going through photos in the full-screen viewer: ←/→ (or a swipe) through
// the list it was opened from, 1/2/3 (or the buttons) to set the
// visibility, auto-advance and undo.
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

test("1/2/3 set the visibility and go on; undo puts it back", async ({
  page,
}) => {
  await openFromFolder(page);
  const notice = page.getByTestId("viewer-notice");

  // real1 → 非公開, then on to real2.
  await page.keyboard.press("1");
  await expect(notice).toContainText("#1 を非公開にしました");
  await expect(position(page)).toHaveText("2 / 5");
  await expect(page.getByTestId("viewer-visibility")).toHaveText("公開");

  // Undo applies to #1 even though the viewer moved on.
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(notice).toContainText("#1 を元に戻しました");
  await expect(position(page)).toHaveText("2 / 5");

  // Without auto-advance: stays, and the badge shows the new value.
  await page.getByLabel("設定したら次へ進む").uncheck();
  await page.keyboard.press("2");
  await expect(page.getByTestId("viewer-visibility")).toHaveText("限定公開");
  await expect(position(page)).toHaveText("2 / 5");
  await expect(page.getByRole("button", { name: /限定公開/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The setting is remembered.
  await page.reload();
  await expect(page.getByLabel("設定したら次へ進む")).not.toBeChecked();

  // Back on the page: #1 really is public again.
  await page.goto("/media/1/");
  await expect(page.getByTestId("visibility-badge")).toHaveText("Public");
});

test("arrows wait while a change is saving", async ({ page }) => {
  await openFromFolder(page);
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  await page.route(/qaction=/, async (route) => {
    if (route.request().method() === "POST") await released;
    await route.continue();
  });
  await page.keyboard.press("2");
  // Saving: an arrow now would race the save's reload of this photo.
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  await expect(position(page)).toHaveText("1 / 5");
  release();
  // Then one step on (auto-advance), not two, and not back.
  await expect(page.getByTestId("viewer-notice")).toContainText(
    "#1 を限定公開にしました",
  );
  await expect(position(page)).toHaveText("2 / 5");
  await page.waitForTimeout(500);
  await expect(position(page)).toHaveText("2 / 5");
});

test("held keys, typing and IME do not trigger shortcuts", async ({ page }) => {
  await openFromFolder(page);
  await page.getByLabel("設定したら次へ進む").uncheck();
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST") posts++;
  });
  // Held down: one change only.
  await page.keyboard.down("3");
  await page.keyboard.down("3");
  await page.keyboard.up("3");
  await expect(page.getByTestId("viewer-notice")).toContainText(
    "#1 を公開にしました",
  );
  await page.waitForTimeout(300);
  expect(posts).toBe(1);

  // In a field on the page: arrows move the caret, not the photo.
  await page.keyboard.press("Escape");
  await expect(viewer(page)).toBeHidden();
  const tags = page.getByLabel("Tags (comma-separated)");
  await tags.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/media\/1\//);

  // Outside fields the page itself steps too.
  await tags.blur();
  await page.locator("h1").click();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "Edit #3" })).toBeVisible();
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

    const swipeLeft = () =>
      viewer(page).evaluate((el) => {
        const touch = (x: number) =>
          new Touch({ identifier: 1, target: el, clientX: x, clientY: 400 });
        el.dispatchEvent(
          new TouchEvent("touchstart", {
            bubbles: true,
            touches: [touch(300)],
            changedTouches: [touch(300)],
          }),
        );
        el.dispatchEvent(
          new TouchEvent("touchend", {
            bubbles: true,
            touches: [],
            changedTouches: [touch(150)],
          }),
        );
      });
    await swipeLeft();
    await expect(position(page)).toHaveText("2 / 5");

    // 非公開 / 限定公開 / 公開, large enough to tap.
    const priv = page.getByRole("button", { name: /^非公開/ });
    const box = await priv.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await priv.tap();
    await expect(page.getByTestId("viewer-notice")).toContainText(
      "#3 を非公開にしました",
    );
    await expect(position(page)).toHaveText("3 / 5");
  });
});
