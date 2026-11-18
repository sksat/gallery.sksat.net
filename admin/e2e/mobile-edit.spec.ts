import { expect, test } from "@playwright/test";

// The edit page on a phone: the save bar, prev/next through the list it was
// opened from, the unsaved-changes guard and the folded metadata.
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
  await page.goto("/media/?world=VRChat");
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
  await expect(page.locator('select[name="world"]')).toHaveValue("VRChat");
  await expect(page.getByRole("link", { name: "次へ ›" })).toHaveCount(0);

  await page.getByRole("link", { name: "‹ 前へ" }).tap();
  await expect(page.getByRole("heading", { name: "Edit #4" })).toBeVisible();

  // Still the same list to go back to.
  await page.getByRole("link", { name: "← Media" }).tap();
  await expect(page).toHaveURL(/\/media\/\?world=VRChat#m-4$/);
});

test("unsaved changes ask before leaving", async ({ page }) => {
  await page.goto("/media/?world=VRChat");
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
