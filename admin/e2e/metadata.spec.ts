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
  await expect(taken.locator("option").first()).toHaveText(
    "デフォルト（秒まで）",
  );
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

test("each field's level sits beside the field", async ({ page }) => {
  await page.goto("/media/1/");
  const group = (name: string) =>
    page.getByRole("group", { name, exact: true });
  await expect(group("Camera").getByTestId("metadata-camera")).toBeVisible();
  await expect(group("日時").getByTestId("metadata-taken_at")).toBeVisible();
  // No scan here: no スキャン日時 to set.
  await expect(page.getByTestId("metadata-digitized_at")).toHaveCount(0);

  // ファイル名 by 場所と名前, apart from the form, but saved with it.
  const place = page.getByRole("region", { name: "場所とゴミ箱" });
  const fileName = place.getByTestId("metadata-file_name");
  await expect(fileName.locator("option").first()).toHaveText(
    "デフォルト（出さない）",
  );
  await expect(place.getByTestId("public-file_name")).toHaveAttribute(
    "data-public",
    "false",
  );
  try {
    await fileName.selectOption("name");
    await expect(page.getByTestId("dirty")).toBeVisible();
    await save(page);
    await page.reload();
    await expect(fileName).toHaveValue("name");
    await expect(place.getByTestId("public-file_name")).toHaveAttribute(
      "data-public",
      "true",
    );

    // In the trash there is no 場所と名前, and a save keeps the level.
    await place.getByRole("button", { name: "ゴミ箱へ" }).click();
    await expect(page.getByText("ゴミ箱に入れました。")).toBeVisible();
    await expect(fileName).toHaveCount(0);
    await save(page);
    await place.getByRole("button", { name: "元に戻す" }).click();
    await expect(fileName).toHaveValue("name");
  } finally {
    await page.goto("/media/1/");
    await expect(page.getByRole("heading", { name: "Edit #1" })).toBeVisible();
    if (await page.getByText(/ゴミ箱にあります/).isVisible()) {
      await page.getByRole("button", { name: "元に戻す" }).click();
      await expect(fileName).toBeVisible();
    }
    await fileName.selectOption("");
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
    // A photo's デフォルト says the new default.
    await page.goto("/media/1/");
    await expect(
      page.getByTestId("metadata-camera").locator("option").first(),
    ).toHaveText("デフォルト（メーカーだけ）");
  } finally {
    await page.goto("/setting/");
    await camera.selectOption("model");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("保存しました。")).toBeVisible();
  }
});

test("tags: a public tag can be hidden on a photo; a private tag never shows", async ({
  page,
}) => {
  await page.goto("/media/2/");
  const tags = page.locator('input[name="tags"]');
  const chip = (name: string) =>
    page.getByTestId("tag-chip").filter({ hasText: name });
  const own = (name: string) => chip(name).getByTestId("tag-chip-own");
  const fieldPublic = page.getByTestId("tag-field-public-1");
  const tagSwitch = (name: string) =>
    page
      .getByTestId("tag-row")
      .filter({ hasText: name })
      .getByRole("switch");
  try {
    // VRChat is public: shown here, and its field イベント (with a value).
    await expect(chip("VRChat")).toHaveAttribute("data-public", "true");
    await expect(own("VRChat")).toHaveCount(0);
    await expect(fieldPublic).toHaveAttribute("data-shown", "true");
    await chip("VRChat").click();
    await expect(chip("VRChat")).toHaveAttribute("data-public", "false");
    await expect(own("VRChat")).toBeVisible();
    await expect(page.getByTestId("dirty")).toBeVisible();
    await tags.fill("VRChat, draft");
    await save(page);
    await page.reload();
    await expect(chip("VRChat")).toHaveAttribute("data-public", "false");
    await expect(own("VRChat")).toBeVisible();
    await expect(fieldPublic).toHaveAttribute("data-shown", "false");
    // draft is private: locked, never shown on a photo.
    await expect(chip("draft")).toHaveAttribute("data-locked", "true");
    await expect(chip("draft")).toHaveAttribute("data-public", "false");
    await expect(chip("draft").locator("label")).toHaveAttribute(
      "title",
      "タグが非公開",
    );
    await expect(
      page.getByRole("checkbox", { name: "draftを公開" }),
    ).toBeDisabled();

    // Another photo with VRChat still shows it.
    await page.goto("/media/4/");
    await expect(chip("VRChat")).toHaveAttribute("data-public", "true");
    // VRChat made private: hidden on every photo; public again: back on
    // the photos that do not hide it.
    await page.goto("/tag/");
    await tagSwitch("VRChat").click();
    await expect(tagSwitch("VRChat")).toHaveAttribute("aria-checked", "false");
    await page.goto("/media/4/");
    await expect(chip("VRChat")).toHaveAttribute("data-locked", "true");
    await page.goto("/tag/");
    await tagSwitch("VRChat").click();
    await expect(tagSwitch("VRChat")).toHaveAttribute("aria-checked", "true");
    await page.goto("/media/4/");
    await expect(chip("VRChat")).toHaveAttribute("data-public", "true");
    await page.goto("/media/2/");
    await expect(chip("VRChat")).toHaveAttribute("data-public", "false");

    // Shown again: no choice of its own left.
    await chip("VRChat").click();
    await expect(own("VRChat")).toHaveCount(0);
    await save(page);
    await page.reload();
    await expect(chip("VRChat")).toHaveAttribute("data-public", "true");
    await expect(own("VRChat")).toHaveCount(0);
    // Hidden, then taken off the photo's own tags: its camera still passes
    // it on, so the photo keeps hiding it.
    await chip("VRChat").click();
    await tags.fill("draft");
    await save(page);
    await page.reload();
    const inherited = page.locator(
      '[data-testid="tag-chip"][data-inherited="true"]',
      { hasText: "VRChat" },
    );
    await expect(inherited).toHaveAttribute("data-public", "false");
    await expect(inherited.getByTestId("tag-chip-own")).toBeVisible();
  } finally {
    await page.goto("/tag/");
    if ((await tagSwitch("VRChat").getAttribute("aria-checked")) === "false") {
      await tagSwitch("VRChat").click();
      await expect(tagSwitch("VRChat")).toHaveAttribute("aria-checked", "true");
    }
    await page.goto("/media/2/");
    if ((await chip("VRChat").getAttribute("data-public")) === "false") {
      await chip("VRChat").click();
    }
    await tags.fill("VRChat");
    await save(page);
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
