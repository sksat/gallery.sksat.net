import { expect, test, type Page } from "@playwright/test";
import { dropZoneOf, folderWith, png, tick, tile } from "./files-helpers";

// A folder in the Files view's selection stands for every photo below it,
// subfolders included: the bar counts them and its photo actions (tags,
// visibility, metadata levels…) apply to all of them, undo too. A folder
// of the tree has the same actions in its menu.

const summary = (page: Page) => page.getByTestId("selection-summary");
const bar = (page: Page) => page.getByTestId("selection-bar");
const info = async (page: Page, item: string) => {
  await bar(page).getByRole("button", { name: "情報…" }).click();
  await page
    .getByRole("menu", { name: "情報" })
    .getByRole("menuitem", { name: item })
    .click();
};

/** Files uploaded into the open folder `dir`. */
const uploadHere = async (page: Page, dir: string, files: string[]) => {
  await dropZoneOf(page, dir);
  await page
    .getByTestId("upload-input")
    .setInputFiles(files.map((f) => png(f, `${dir}/${f}`)));
  await expect(
    page.getByTestId("upload-panel").getByRole("heading"),
  ).toHaveText(`${files.length} 件アップロードしました`);
  await page.getByRole("button", { name: "閉じる" }).click();
  for (const f of files) await expect(tile(page, f)).toHaveCount(1);
  await page.waitForLoadState("networkidle");
};

/** A new folder `name` inside the open one, opened. */
const subfolder = async (page: Page, dir: string, name: string) => {
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(new RegExp(`dir=${dir}/${name}$`));
};

/**
 * /mock/<name> with a.png, sub/ with b.png and c.png, and sub/deep/ with
 * d.png: four photos, three of them in subfolders.
 */
const nested = async (page: Page, name: string) => {
  const top = `/mock/${name}`;
  await folderWith(page, name, ["a.png"]);
  await subfolder(page, top, "sub");
  await uploadHere(page, `${top}/sub`, ["b.png", "c.png"]);
  await subfolder(page, `${top}/sub`, "deep");
  await uploadHere(page, `${top}/sub/deep`, ["d.png"]);
  return top;
};

test.describe("folders in the selection", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a folder with subfolders gets a tag on every photo, and undo", async ({
    page,
  }) => {
    await nested(page, "fsel-tag");
    await page.goto("/media/?view=files&dir=/mock");
    await tick(page, "fsel-tag").click();
    await expect(summary(page)).toContainText("1 フォルダ・4 枚");

    const sheet = page.getByRole("dialog", { name: /タグと撮影データ/ });
    const chip = (name: string) =>
      // The tag itself, not its 公開 switch (named 「…を公開」).
      sheet.getByRole("checkbox", { name: new RegExp(`^${name}(?!を公開)`) });
    await info(page, "タグと撮影データ…");
    await expect(sheet.getByText("読み込み中…")).toHaveCount(0);
    await sheet.getByPlaceholder("タグを追加").fill("fsel-roll");
    await sheet.getByPlaceholder("タグを追加").press("Enter");
    await sheet.getByRole("button", { name: "適用" }).click();
    await expect(
      page.getByText(/4 枚のタグと撮影データを変えました。/),
    ).toBeVisible();
    await expect(bar(page)).toHaveCount(0);

    // The folder's photos all have it.
    await tick(page, "fsel-tag").click();
    await info(page, "タグと撮影データ…");
    await expect(sheet.getByText("読み込み中…")).toHaveCount(0);
    await expect(chip("fsel-roll")).toHaveAttribute("aria-checked", "true");
    await sheet.getByRole("button", { name: "やめる" }).click();
    await page.keyboard.press("Escape");

    // Undo takes it off each again.
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByText("元に戻しました。")).toBeVisible();
    await tick(page, "fsel-tag").click();
    await info(page, "タグと撮影データ…");
    await expect(sheet.getByText("読み込み中…")).toHaveCount(0);
    await expect(chip("fsel-roll")).toHaveCount(0);
    await sheet.getByRole("button", { name: "やめる" }).click();
    await page.keyboard.press("Escape");

    // Applied once more: the photo two levels down has it too.
    await tick(page, "fsel-tag").click();
    await info(page, "タグと撮影データ…");
    await sheet.getByPlaceholder("タグを追加").fill("fsel-roll");
    await sheet.getByPlaceholder("タグを追加").press("Enter");
    await sheet.getByRole("button", { name: "適用" }).click();
    await expect(
      page.getByText(/4 枚のタグと撮影データを変えました。/),
    ).toBeVisible();
    await page.goto("/media/?view=files&dir=/mock/fsel-tag/sub/deep");
    await tick(page, "d.png").click();
    await expect(summary(page)).toContainText("1 件選択");
    await info(page, "タグと撮影データ…");
    await expect(chip("fsel-roll")).toHaveAttribute("aria-checked", "true");
  });

  test("photos and a folder together; the folder's own menu", async ({
    page,
  }) => {
    const top = await nested(page, "fsel-mixed");
    await page.goto(`/media/?view=files&dir=${top}`);
    // a.png and sub/ (b, c and deep/d): four photos.
    await tick(page, "a.png").click();
    await tick(page, "sub").click();
    await expect(summary(page)).toContainText("1 フォルダ・4 枚");

    const level = (name: string) =>
      bar(page)
        .getByRole("group", { name: "公開範囲" })
        .getByRole("button", { name, exact: true });
    await level("限定公開").click();
    const confirm = page.getByTestId("visibility-confirm");
    await expect(confirm.getByRole("listitem")).toHaveCount(4);
    await confirm.getByRole("button", { name: "4 枚を限定公開" }).click();
    await expect(
      page.getByText("4 selected, 4 changed to Unlisted."),
    ).toBeVisible();
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByText("元に戻しました。")).toBeVisible();

    // A right click on a folder tile: the photo entries are there.
    await tile(page, "sub").click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(summary(page)).toContainText("1 フォルダ・3 枚");
    await menu.getByRole("menuitem", { name: "カメラ…" }).click();
    const picker = page.getByTestId("camera-picker");
    await expect(picker).toBeVisible();
    await expect(picker).toContainText("カメラ (3 枚)");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);

    // A folder of the tree (here the open one): its menu, and the bar
    // for that folder alone.
    const tree = page.getByRole("navigation", { name: "Folders" }).first();
    await tree
      .getByRole("link", { name: /^fsel-mixed/ })
      .click({ button: "right" });
    const folderMenu = page.getByRole("menu", {
      name: "フォルダ「fsel-mixed」の操作",
    });
    await folderMenu.getByRole("menuitem", { name: "公開する情報…" }).click();
    const dialog = page.getByRole("dialog", { name: /公開する情報/ });
    await expect(dialog).toContainText("4 枚");
    await expect(summary(page)).toContainText("1 フォルダ・4 枚");
    await expect(bar(page).getByRole("button", { name: "移動…" })).toHaveCount(
      0,
    );
    await dialog.getByLabel("カメラ").selectOption("hidden");
    await dialog.getByRole("button", { name: "適用" }).click();
    await expect(
      page.getByText("4 枚の公開する情報を変えました。"),
    ).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByText("元に戻しました。")).toBeVisible();
  });
});
