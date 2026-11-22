import { expect, test, type Page } from "@playwright/test";
import { folderWith, tile } from "./files-helpers";
import { setTags as setEditorTags } from "./tag-editor-helpers";

// Renaming a tag on /tag/ (click its name, Enter saves, Esc cancels), and
// merging it into another by renaming it to that one's name, each with
// 元に戻す. On photos uploaded into a folder of its own, with tags of its
// own.

const OLD = "e2e-rn-old";
const NEW = "e2e-rn-new";
const TARGET = "e2e-rn-target";

const tagRow = (page: Page, name: string) =>
  page
    .getByTestId("tag-row")
    .filter({ has: page.getByRole("button", { name: `${name}の名前を変更` }) });

/** Open a photo of the folder on its edit page; its URL. */
const openPhoto = async (page: Page, name: string) => {
  await tile(page, name).dblclick();
  await expect(page).toHaveURL(/\/media\/\d+\//);
  return new URL(page.url()).pathname;
};

const setTags = async (page: Page, url: string, tags: string) => {
  await page.goto(url);
  await setEditorTags(page, tags);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();
};

const renameTo = async (page: Page, from: string, to: string) => {
  await page.getByRole("button", { name: `${from}の名前を変更` }).click();
  const input = page.getByLabel("タグ名");
  await expect(input).toBeFocused();
  await input.fill(to);
  await input.press("Enter");
};

const chips = (page: Page) => page.getByTestId("tag-chip");

test("rename a tag on /tag/, and merge it into another, with undo", async ({
  page,
}) => {
  await folderWith(page, "rn", ["a.png", "b.png"]);
  const a = await openPhoto(page, "a.png");
  await page.goBack();
  const b = await openPhoto(page, "b.png");
  await setTags(page, a, OLD);
  await setTags(page, b, TARGET);

  await page.goto("/tag/");
  await expect(tagRow(page, OLD)).toContainText("1 枚");

  // Esc leaves it as it was.
  await page.getByRole("button", { name: `${OLD}の名前を変更` }).click();
  await page.getByLabel("タグ名").fill("nope");
  await page.getByLabel("タグ名").press("Escape");
  await expect(page.getByLabel("タグ名")).toHaveCount(0);
  await expect(tagRow(page, OLD)).toHaveCount(1);

  // Rename, then undo.
  await renameTo(page, OLD, NEW);
  await expect(
    page.getByText(`『${OLD}』を『${NEW}』にしました。`),
  ).toBeVisible();
  await expect(tagRow(page, NEW)).toContainText("1 枚");
  await expect(tagRow(page, OLD)).toHaveCount(0);
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("元に戻しました。")).toBeVisible();
  await expect(tagRow(page, OLD)).toContainText("1 枚");
  await expect(tagRow(page, NEW)).toHaveCount(0);

  // Rename again: the photo has the new name.
  await renameTo(page, OLD, NEW);
  await expect(
    page.getByText(`『${OLD}』を『${NEW}』にしました。`),
  ).toBeVisible();
  await page.goto(a);
  await expect(chips(page)).toContainText([NEW]);
  await expect(page.locator('input[name="tags"]')).toHaveValue(NEW);

  // Renaming to a name that is a tag already asks, then merges.
  await page.goto("/tag/");
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.accept();
  });
  await renameTo(page, NEW, TARGET);
  await expect(
    page.getByText(`『${NEW}』を『${TARGET}』にまとめました。`),
  ).toBeVisible();
  expect(asked).toContain(`『${TARGET}』はもうあります`);
  await expect(tagRow(page, TARGET)).toContainText("2 枚");
  await expect(tagRow(page, NEW)).toHaveCount(0);

  // Undo splits them again.
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("元に戻しました。")).toBeVisible();
  await expect(tagRow(page, TARGET)).toContainText("1 枚");
  await expect(tagRow(page, NEW)).toContainText("1 枚");
  await page.goto(a);
  await expect(chips(page)).toContainText([NEW]);
  await expect(page.locator('input[name="tags"]')).toHaveValue(NEW);

  // Declining the question changes nothing.
  await page.goto("/tag/");
  page.once("dialog", (d) => void d.dismiss());
  await renameTo(page, NEW, TARGET);
  await expect(tagRow(page, NEW)).toContainText("1 枚");
  await expect(tagRow(page, TARGET)).toContainText("1 枚");
});
