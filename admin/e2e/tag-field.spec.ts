import { expect, test, type Page } from "@playwright/test";
import { folderWith, tick, tile } from "./files-helpers";
import { setTags } from "./tag-editor-helpers";

// Fields of a tag (migration 0010): defined on /tag/, filled in on a
// photo's edit page and for a selection in the Files view, with undo. On
// photos uploaded into a folder of its own, with a tag of its own.

const TAG = "e2e-film";

const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();
};

/** Open a photo of the folder on its edit page; its URL. */
const openPhoto = async (page: Page, name: string) => {
  await tile(page, name).dblclick();
  await expect(page).toHaveURL(/\/media\/\d+\//);
  return new URL(page.url()).pathname;
};

/** The selection bar's 情報… menu → 「<tag>の項目…」. */
const openSheet = async (page: Page) => {
  await page
    .getByTestId("selection-bar")
    .getByRole("button", { name: "情報…" })
    .click();
  await page
    .getByRole("menu", { name: "情報" })
    .getByRole("menuitem", { name: `${TAG}の項目…` })
    .click();
};

const tagRow = (page: Page) =>
  page.getByTestId("tag-row").filter({ hasText: TAG });

const openFields = async (page: Page) => {
  await page.goto("/tag/");
  await tagRow(page).getByRole("button", { name: /^項目/ }).click();
  return page.getByRole("region", { name: `${TAG}の項目` });
};

test("define fields on a tag, fill them on a photo and for a selection", async ({
  page,
}) => {
  await folderWith(page, "tf", ["a.png", "b.png"]);
  const a = await openPhoto(page, "a.png");
  await setTags(page, TAG);
  await save(page);
  // No fields yet: no section.
  await expect(page.getByTestId("tag-field-group")).toHaveCount(0);

  // Fields, from the tag's 項目.
  let panel = await openFields(page);
  await panel.getByLabel("項目名").last().fill("銘柄");
  await panel.getByLabel("種類").selectOption("select");
  await panel.getByLabel("選択肢（1 行に 1 つ）").fill("Portra 400\nHP5");
  await panel.getByRole("button", { name: "追加" }).click();
  await expect(page.getByText("『銘柄』を追加しました。")).toBeVisible();
  await panel.getByLabel("項目名").last().fill("ISO");
  await panel.getByLabel("種類").selectOption("number");
  await panel.getByRole("button", { name: "追加" }).click();
  await expect(page.getByText("『ISO』を追加しました。")).toBeVisible();
  await expect(tagRow(page).getByTestId("tag-field-summary")).toHaveText(
    "銘柄・ISO",
  );

  // The photo gets them, under the tag.
  await page.goto(a);
  const group = page.getByTestId("tag-field-group");
  await expect(group.locator("legend")).toContainText(TAG);
  // Checked on the server against the field's type.
  await group.getByLabel("ISO", { exact: true }).fill("abc");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("ISOは数値です")).toBeVisible();
  await group.getByLabel("銘柄", { exact: true }).selectOption("HP5");
  await group.getByLabel("ISO", { exact: true }).fill("400");
  await group.getByLabel("ISOの公開").selectOption("hidden");
  await save(page);
  await page.reload();
  await expect(group.getByLabel("銘柄", { exact: true })).toHaveValue("HP5");
  await expect(group.getByLabel("ISO", { exact: true })).toHaveValue("400");
  await expect(group.getByLabel("ISOの公開")).toHaveValue("hidden");

  // The selection: only photos with the tag get the value.
  await page.goto("/media/?view=files&dir=/mock/tf");
  await tick(page, "a.png").click();
  await tick(page, "b.png").click();
  await openSheet(page);
  const sheet = page.getByRole("dialog", { name: /タグの項目/ });
  await expect(sheet.getByText("1 / 2 枚")).toBeVisible();
  await expect(sheet.getByLabel("ISO", { exact: true })).toHaveValue("400");
  await sheet.getByLabel("ISO", { exact: true }).fill("800");
  await sheet.getByRole("button", { name: "適用" }).click();
  await expect(page.getByText("1 枚のタグの項目を変えました。")).toBeVisible();
  await page.goto(a);
  await expect(group.getByLabel("ISO", { exact: true })).toHaveValue("800");
  // ...and back.
  await page.goto("/media/?view=files&dir=/mock/tf");
  await tick(page, "a.png").click();
  await openSheet(page);
  await sheet.getByLabel("ISO", { exact: true }).fill("1600");
  await sheet.getByRole("button", { name: "適用" }).click();
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("元に戻しました。")).toBeVisible();
  await page.goto(a);
  await expect(group.getByLabel("ISO", { exact: true })).toHaveValue("800");

  // Rename and undo; reorder.
  panel = await openFields(page);
  const label = panel.getByTestId("tag-field").nth(1).getByLabel("項目名");
  await label.fill("感度");
  await label.press("Enter");
  await expect(page.getByText("『ISO』を『感度』にしました。")).toBeVisible();
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("元に戻しました。")).toBeVisible();
  await expect(tagRow(page).getByTestId("tag-field-summary")).toHaveText(
    "銘柄・ISO",
  );
  await panel.getByRole("button", { name: "ISOを上へ" }).click();
  await expect(tagRow(page).getByTestId("tag-field-summary")).toHaveText(
    "ISO・銘柄",
  );

  // Removing a field with values asks first, with the count; undo puts
  // the values back.
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.accept();
  });
  await panel.getByRole("button", { name: "銘柄を削除" }).click();
  await expect(page.getByText("『銘柄』を削除しました。")).toBeVisible();
  expect(asked).toContain("1 枚の写真に入っている値も消えます");
  await expect(tagRow(page).getByTestId("tag-field-summary")).toHaveText("ISO");
  await page.goto(a);
  await expect(group.getByLabel("銘柄", { exact: true })).toHaveCount(0);
  await expect(group.getByLabel("ISO", { exact: true })).toHaveValue("800");
});

test("removing a field can be undone with its values", async ({ page }) => {
  await folderWith(page, "tf-undo", ["a.png"]);
  const a = await openPhoto(page, "a.png");
  await setTags(page, "e2e-trip");
  await save(page);
  await page.goto("/tag/");
  const row = page.getByTestId("tag-row").filter({ hasText: "e2e-trip" });
  await row.getByRole("button", { name: /^項目/ }).click();
  const panel = page.getByRole("region", { name: "e2e-tripの項目" });
  await panel.getByLabel("項目名").last().fill("行き先");
  await panel.getByRole("button", { name: "追加" }).click();
  await expect(page.getByText("『行き先』を追加しました。")).toBeVisible();
  await page.goto(a);
  await page.getByLabel("行き先", { exact: true }).fill("京都");
  await save(page);

  await page.goto("/tag/");
  await row.getByRole("button", { name: /^項目/ }).click();
  page.once("dialog", (d) => void d.accept());
  await panel.getByRole("button", { name: "行き先を削除" }).click();
  await expect(page.getByText("『行き先』を削除しました。")).toBeVisible();
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("元に戻しました。")).toBeVisible();
  await page.goto(a);
  await expect(page.getByLabel("行き先", { exact: true })).toHaveValue("京都");
});
