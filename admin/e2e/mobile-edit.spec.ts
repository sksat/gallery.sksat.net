import { expect, test, type Page } from "@playwright/test";

// The edit page on a phone: the save bar, prev/next through the list it was
// opened from (links and swipes on the photo), the unsaved-changes guard
// and the folded metadata.
// Fixture (e2e/fixture.sql): VRChat rows by date desc are #5, #4, #2.
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test("save from the bar fixed to the bottom", async ({ page }) => {
  await page.goto("/media/2/");
  const save = page.getByRole("button", { name: "Save" });
  // Without scrolling down to the end of the form.
  await expect(save).toBeInViewport();

  const tags = page.getByLabel("Tags (comma-separated)");
  const before = await tags.inputValue();
  try {
    await tags.fill("VRChat, mobile");
    await expect(page.getByTestId("dirty")).toHaveText("未保存");
    await save.tap();
    await expect(page.getByText(/^Saved at /)).toBeVisible();
    await expect(page.getByTestId("dirty")).toHaveCount(0);
  } finally {
    await page.goto("/media/2/");
    await page.getByLabel("Tags (comma-separated)").fill(before);
    await page.getByRole("button", { name: "Save" }).tap();
    await expect(page.getByText(/^Saved at /)).toBeVisible();
  }
});

test("prev / next step through the filtered list", async ({ page }) => {
  await page.goto("/media/?platform=VRChat");
  await page
    .getByTestId("media-card")
    .filter({ hasText: "vrchat3.png" })
    .getByText("vrchat3.png")
    .tap();
  await expect(page.getByRole("heading", { name: "Edit #5" })).toBeVisible();
  await expect(page.getByTestId("position")).toHaveText("1 / 3");
  await expect(page.getByRole("link", { name: "‹ 前へ" })).toHaveCount(0);

  await page.getByRole("link", { name: "次へ ›" }).tap();
  await expect(page.getByRole("heading", { name: "Edit #4" })).toBeVisible();
  await expect(page.getByTestId("position")).toHaveText("2 / 3");
  await page.getByRole("link", { name: "次へ ›" }).tap();
  await expect(page.getByRole("heading", { name: "Edit #2" })).toBeVisible();
  // The form shows this photo, not the one before.
  await expect(page.locator('select[name="platform"]')).toHaveValue("VRChat");
  await expect(page.getByRole("link", { name: "次へ ›" })).toHaveCount(0);

  await page.getByRole("link", { name: "‹ 前へ" }).tap();
  await expect(page.getByRole("heading", { name: "Edit #4" })).toBeVisible();

  // Still the same list to go back to.
  await page.getByRole("link", { name: "← Media" }).tap();
  await expect(page).toHaveURL(/\/media\/\?platform=VRChat#m-4$/);
});

test("unsaved changes ask before leaving", async ({ page }) => {
  await page.goto("/media/?platform=VRChat");
  await page
    .getByTestId("media-card")
    .filter({ hasText: "vrchat3.png" })
    .getByText("vrchat3.png")
    .tap();
  await expect(page.getByRole("heading", { name: "Edit #5" })).toBeVisible();
  await page.getByLabel("Tags (comma-separated)").fill("not saved");
  await expect(page.getByTestId("dirty")).toBeVisible();

  // Cancel: stay, with the edit.
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("link", { name: "次へ ›" }).tap();
  await expect(page.getByRole("heading", { name: "Edit #5" })).toBeVisible();
  await expect(page.getByLabel("Tags (comma-separated)")).toHaveValue(
    "not saved",
  );

  // OK: leave without saving.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("link", { name: "次へ ›" }).tap();
  await expect(page.getByRole("heading", { name: "Edit #4" })).toBeVisible();
  await expect(page.getByTestId("dirty")).toHaveCount(0);
  await page.goto("/media/5/");
  await expect(page.getByLabel("Tags (comma-separated)")).not.toHaveValue(
    "not saved",
  );
});

/** A horizontal (or vertical) swipe of `dx` px on `selector`. */
const swipeOn = (page: Page, selector: string, dx: number, dy = 0) =>
  page.locator(selector).evaluate(
    (el, [dx, dy]) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const touch = (tx: number, ty: number) =>
        new Touch({ identifier: 1, target: el, clientX: tx, clientY: ty });
      el.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          touches: [touch(x, y)],
          changedTouches: [touch(x, y)],
        }),
      );
      el.dispatchEvent(
        new TouchEvent("touchend", {
          bubbles: true,
          touches: [],
          changedTouches: [touch(x + dx, y + dy)],
        }),
      );
    },
    [dx, dy],
  );

const photo = 'button[aria-label="写真を全画面で表示"]';

test("swipe the photo to step, like ←/→", async ({ page }) => {
  await page.goto("/media/?platform=VRChat");
  await page
    .getByTestId("media-card")
    .filter({ hasText: "vrchat3.png" })
    .getByText("vrchat3.png")
    .tap();
  await expect(page.getByRole("heading", { name: "Edit #5" })).toBeVisible();

  // To the left: the next photo; to the right: back.
  await swipeOn(page, photo, -120);
  await expect(page.getByRole("heading", { name: "Edit #4" })).toBeVisible();
  await expect(page.getByTestId("position")).toHaveText("2 / 3");
  await swipeOn(page, photo, 120);
  await expect(page.getByRole("heading", { name: "Edit #5" })).toBeVisible();

  // A mostly vertical move is a scroll, and the form is not a swipe area.
  await swipeOn(page, photo, -60, 120);
  await swipeOn(page, "form[aria-busy]", -120);
  await page.waitForTimeout(300);
  await expect(page.getByRole("heading", { name: "Edit #5" })).toBeVisible();

  // Unsaved edits ask first, as with the keys; cancel stays.
  await page.getByLabel("Tags (comma-separated)").fill("not saved");
  page.once("dialog", (d) => d.dismiss());
  await swipeOn(page, photo, -120);
  await page.waitForTimeout(300);
  await expect(page.getByRole("heading", { name: "Edit #5" })).toBeVisible();
  await expect(page.getByLabel("Tags (comma-separated)")).toHaveValue(
    "not saved",
  );
});

test("no swipe while a save is running", async ({ page }) => {
  await page.goto("/media/?platform=VRChat");
  await page
    .getByTestId("media-card")
    .filter({ hasText: "vrchat2.png" })
    .getByText("vrchat2.png")
    .tap();
  await expect(page.getByRole("heading", { name: "Edit #4" })).toBeVisible();
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  await page.route(/qaction=/, async (route) => {
    if (route.request().method() === "POST") await released;
    await route.continue();
  });
  // A save (even without changes) is running: the photo stays.
  await page.getByRole("button", { name: "Save" }).tap();
  await expect(page.locator('form[aria-busy="true"]')).toHaveCount(1);
  await swipeOn(page, photo, -120);
  await page.waitForTimeout(300);
  await expect(page.getByRole("heading", { name: "Edit #4" })).toBeVisible();
  release();
  await expect(page.getByText(/^Saved at /)).toBeVisible();
  // Once saved it steps again.
  await swipeOn(page, photo, -120);
  await expect(page.getByRole("heading", { name: "Edit #2" })).toBeVisible();
});

test("a choice survives the page re-rendering around the form", async ({
  page,
}) => {
  await page.goto("/media/3/");
  const unlisted = page.getByRole("radio", { name: /Unlisted/ });
  await unlisted.check();
  // The unsaved mark and unfolding the details re-render the page; the
  // radios must keep what was picked, not the saved value.
  await expect(page.getByTestId("dirty")).toBeVisible();
  await page.getByRole("button", { name: "ファイル・更新日時" }).tap();
  await expect(unlisted).toBeChecked();
  await expect(page.getByRole("radio", { name: /Public/ })).not.toBeChecked();
});

test("file and last updated are folded away", async ({ page }) => {
  await page.goto("/media/2/");
  const file = page
    .locator("#media-meta")
    .getByText("vrchat1.png", { exact: true });
  await expect(file).toBeHidden();
  await expect(page.getByTestId("public-url")).toBeVisible();
  await page.getByRole("button", { name: "ファイル・更新日時" }).tap();
  await expect(file).toBeVisible();
  await page.getByRole("button", { name: "詳細を閉じる" }).tap();
  await expect(file).toBeHidden();
});

test("copy the public link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/media/2/");
  await page.getByRole("button", { name: "リンクをコピー" }).tap();
  await expect(page.getByRole("status")).toHaveText("コピーしました");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "https://gallery.sksat.net/photo/aaaaaaaaa3/",
  );

  // A private photo's link does not work: no button.
  await page.goto("/media/5/");
  await expect(page.getByTestId("public-url")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "リンクをコピー" }),
  ).toHaveCount(0);
});
