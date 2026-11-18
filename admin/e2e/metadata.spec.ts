import { expect, test, type Page } from "@playwright/test";

// How much of a photo's metadata is public (per photo, and the site's
// defaults on /setting/), and which tags are public (/tag/). Every test
// puts the fixture back.

const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();
};

test("a photo's own level, over the site default", async ({ page }) => {
  await page.goto("/media/1/");
  const taken = page.getByTestId("metadata-taken_at");
  // The first option follows the site, and says what it is.
  await expect(taken).toHaveValue("");
  await expect(taken.locator("option").first()).toHaveText("既定（秒まで）");
  await expect(page.getByTestId("metadata-file_name")).toHaveValue("");
  try {
    await taken.selectOption("date");
    await save(page);
    await page.reload();
    await expect(taken).toHaveValue("date");
  } finally {
    await page.goto("/media/1/");
    await taken.selectOption("");
    await save(page);
  }
});

test("site defaults on /setting/", async ({ page }) => {
  await page.goto("/setting/");
  const camera = page.getByLabel("カメラ");
  await expect(camera).toHaveValue("model");
  await expect(page.getByLabel("ファイル名")).toHaveValue("hidden");
  try {
    await camera.selectOption("manufacturer");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("保存しました。")).toBeVisible();
    // A photo's 既定 says the new default.
    await page.goto("/media/1/");
    await expect(
      page.getByTestId("metadata-camera").locator("option").first(),
    ).toHaveText("既定（メーカーだけ）");
  } finally {
    await page.goto("/setting/");
    await camera.selectOption("model");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("保存しました。")).toBeVisible();
  }
});

test("tags: a new tag is private; publish it on /tag/, and undo", async ({
  page,
}) => {
  await page.goto("/media/2/");
  const tags = page.locator('input[name="tags"]');
  try {
    await tags.fill("VRChat, e2e-new");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText(/新しいタグ『e2e-new』は非公開です。/),
    ).toBeVisible();
    await page.reload();
    const chip = (name: string) =>
      page.getByTestId("tag-chip").filter({ hasText: name });
    await expect(chip("VRChat")).toHaveAttribute("data-public", "true");
    await expect(chip("e2e-new")).toHaveAttribute("data-public", "false");

    await page.goto("/tag/");
    const row = page.getByTestId("tag-row").filter({ hasText: "e2e-new" });
    await expect(row).toContainText("1 枚");
    const sw = row.getByRole("switch");
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(page.getByText("『e2e-new』を公開にしました。")).toBeVisible();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
  } finally {
    await page.goto("/media/2/");
    await tags.fill("VRChat");
    await save(page);
  }
});
