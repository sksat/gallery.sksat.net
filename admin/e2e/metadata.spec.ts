import { expect, test, type Page } from "@playwright/test";
import { addTags, setTags, tagChip as chip } from "./tag-editor-helpers";

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
  const eye = (name: string) =>
    page.getByRole("switch", { name: `${name}をサイトに表示` });
  const fieldPublic = page.getByTestId("tag-field-public-1");
  const tagSwitch = (name: string) =>
    page.getByTestId("tag-row").filter({ hasText: name }).getByRole("switch");
  try {
    // VRChat is public: shown here, and its field イベント (with a value).
    await expect(chip(page, "VRChat")).toHaveAttribute("data-public", "true");
    await expect(eye("VRChat")).toHaveAttribute("aria-checked", "true");
    await expect(fieldPublic).toHaveAttribute("data-shown", "true");
    await eye("VRChat").click();
    await expect(chip(page, "VRChat")).toHaveAttribute("data-hidden", "true");
    await expect(eye("VRChat")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("dirty")).toBeVisible();
    // Adding a tag keeps the hidden one as it is.
    await addTags(page, "draft");
    await expect(chip(page, "VRChat")).toHaveAttribute("data-hidden", "true");
    await save(page);
    await page.reload();
    await expect(chip(page, "VRChat")).toHaveAttribute("data-public", "false");
    await expect(chip(page, "VRChat")).toHaveAttribute("data-hidden", "true");
    await expect(fieldPublic).toHaveAttribute("data-shown", "false");
    // draft is private: a lock, no switch, never shown on a photo.
    await expect(chip(page, "draft")).toHaveAttribute("data-locked", "true");
    await expect(chip(page, "draft")).toHaveAttribute("data-public", "false");
    await expect(
      chip(page, "draft").getByRole("img", { name: "非公開タグ" }),
    ).toHaveAttribute("title", "非公開タグ");
    await expect(eye("draft")).toHaveCount(0);

    // Another photo with VRChat still shows it.
    await page.goto("/media/4/");
    await expect(chip(page, "VRChat")).toHaveAttribute("data-public", "true");
    // VRChat made private: hidden on every photo; public again: back on
    // the photos that do not hide it.
    await page.goto("/tag/");
    await tagSwitch("VRChat").click();
    await expect(tagSwitch("VRChat")).toHaveAttribute("aria-checked", "false");
    await page.goto("/media/4/");
    await expect(chip(page, "VRChat")).toHaveAttribute("data-locked", "true");
    await page.goto("/tag/");
    await tagSwitch("VRChat").click();
    await expect(tagSwitch("VRChat")).toHaveAttribute("aria-checked", "true");
    await page.goto("/media/4/");
    await expect(chip(page, "VRChat")).toHaveAttribute("data-public", "true");
    await page.goto("/media/2/");
    await expect(chip(page, "VRChat")).toHaveAttribute("data-public", "false");

    // Shown again.
    await eye("VRChat").click();
    await expect(eye("VRChat")).toHaveAttribute("aria-checked", "true");
    await save(page);
    await page.reload();
    await expect(chip(page, "VRChat")).toHaveAttribute("data-public", "true");
    // Hidden, then taken off the photo's own tags: its camera still passes
    // it on, so the photo keeps hiding it.
    await eye("VRChat").click();
    await expect(eye("VRChat")).toHaveAttribute("aria-checked", "false");
    await setTags(page, "draft");
    await save(page);
    await page.reload();
    await expect(chip(page, "VRChat")).toHaveAttribute(
      "data-inherited",
      "true",
    );
    await expect(chip(page, "VRChat")).toHaveAttribute("data-hidden", "true");
    // The camera's tag cannot be taken off here.
    await expect(
      page.getByRole("button", { name: "VRChatを外す" }),
    ).toHaveCount(0);
  } finally {
    await page.goto("/tag/");
    if ((await tagSwitch("VRChat").getAttribute("aria-checked")) === "false") {
      await tagSwitch("VRChat").click();
      await expect(tagSwitch("VRChat")).toHaveAttribute("aria-checked", "true");
    }
    await page.goto("/media/2/");
    if ((await eye("VRChat").getAttribute("aria-checked")) === "false") {
      await eye("VRChat").click();
      await expect(eye("VRChat")).toHaveAttribute("aria-checked", "true");
    }
    await setTags(page, "VRChat");
    await save(page);
  }
});

test("tags: added from the box, taken off with ×", async ({ page }) => {
  await page.goto("/media/2/");
  const box = page.getByTestId("tag-editor").getByPlaceholder("タグを追加");
  try {
    // A site's tag is offered.
    await expect(
      page.locator('#edit-tag-options option[value="draft"]'),
    ).toHaveCount(1);
    await box.fill("draft");
    await box.press("Enter");
    await expect(chip(page, "draft")).toBeVisible();
    await box.fill("e2e-box");
    await page
      .getByTestId("tag-editor")
      .getByRole("button", { name: "追加" })
      .click();
    await expect(chip(page, "draft")).toBeVisible();
    await expect(chip(page, "e2e-box")).toBeVisible();
    // One tag at a time: a comma cannot be in one.
    await box.fill("a,b");
    await expect(
      page.getByTestId("tag-editor").getByRole("button", { name: "追加" }),
    ).toBeDisabled();
    await expect(page.getByTestId("tag-editor").getByRole("alert")).toHaveText(
      "タグに , は使えません",
    );
    await box.press("Enter");
    await expect(box).toHaveValue("a,b");
    await expect(chip(page, "a,b")).toHaveCount(0);
    await box.fill("");
    // Enter adds, it does not save.
    await expect(page.getByTestId("dirty")).toBeVisible();
    await page.getByRole("button", { name: "e2e-boxを外す" }).click();
    await expect(chip(page, "e2e-box")).toHaveCount(0);
    // A tag typed but not added is saved too.
    await box.fill("e2e-typed");
    await save(page);
    await page.reload();
    await expect(page.locator('input[name="tags"]')).toHaveValue(
      "VRChat, draft, e2e-typed",
    );
  } finally {
    await page.goto("/media/2/");
    await setTags(page, "VRChat");
    await save(page);
  }
});

test("tags: a new tag is private; publish it on /tag/, and undo", async ({
  page,
}) => {
  await page.goto("/media/2/");
  try {
    await setTags(page, "VRChat, e2e-new");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText(/新しいタグ『e2e-new』は非公開です。/),
    ).toBeVisible();
    await page.reload();
    await expect(chip(page, "VRChat")).toHaveAttribute("data-public", "true");
    await expect(chip(page, "e2e-new")).toHaveAttribute("data-public", "false");

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
    await setTags(page, "VRChat");
    await save(page);
  }
});
