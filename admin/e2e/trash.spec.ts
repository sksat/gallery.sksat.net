import { expect, test, type Page } from "@playwright/test";

// Moving, renaming and the trash, on photos this spec uploads into its own
// folder (the fake bucket, e2e/fake-b2.mjs), so the fixture rows other
// specs count stay as they are.

const port = Number(process.env.ADMIN_E2E_PORT) || 5175;
const fakeB2 = `http://127.0.0.1:${port + 2}`;

const png = (name: string, seed: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(8 * 1024, seed),
  ]),
});

const uploadedKeys = async (page: Page): Promise<string[]> => {
  const res = await page.request.get(`${fakeB2}/__uploads`);
  return ((await res.json()) as { key: string }[]).map((u) => u.key);
};

/** A new folder under /mock with the given files uploaded into it. */
const folderWith = async (page: Page, name: string, files: string[]) => {
  await page.goto("/media/?view=files&dir=/mock");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(new RegExp(`dir=/mock/${name}$`));
  await page
    .getByTestId("upload-input")
    .setInputFiles(files.map((f) => png(f, `${name}/${f}`)));
  await expect(
    page.getByTestId("upload-panel").getByRole("heading"),
  ).toHaveText(`${files.length} 件アップロードしました`);
  await page.getByRole("button", { name: "閉じる" }).click();
};

const tiles = (page: Page) => page.getByTestId("file-tile");

test("rename a folder, and undo it", async ({ page }) => {
  await folderWith(page, "ops-rename", ["a.png"]);
  await page.getByRole("button", { name: "名前を変更" }).click();
  await page.getByLabel("新しい名前").fill("ops-renamed");
  await page.getByRole("button", { name: "変更", exact: true }).click();
  await expect(page).toHaveURL(/dir=\/mock\/ops-renamed$/);
  await expect(tiles(page)).toHaveCount(1);
  await expect(
    page.getByText("/mock/ops-renamed に名前を変えました。"),
  ).toBeVisible();

  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page).toHaveURL(/dir=\/mock\/ops-rename$/);
  await expect(tiles(page)).toHaveCount(1);
});

test("a folder to the trash, and back", async ({ page }) => {
  await folderWith(page, "ops-trash", ["a.png", "b.png"]);
  await page.getByRole("button", { name: "フォルダをゴミ箱へ" }).click();
  await expect(page).toHaveURL(/dir=\/mock$/);
  await expect(page.getByText("ゴミ箱に入れました。")).toBeVisible();
  await expect(
    page.getByTestId("folder-tile").filter({ hasText: "ops-trash" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page).toHaveURL(/dir=\/mock\/ops-trash$/);
  await expect(tiles(page)).toHaveCount(2);
});

test("move a photo, trash it and delete it for good", async ({ page }) => {
  await folderWith(page, "ops-purge", ["a.png"]);
  await tiles(page).first().click();
  await expect(page).toHaveURL(/\/media\/\d+\//);

  // Moving changes the display path only: the B2 key stays.
  await page.getByLabel("場所と名前").fill("/mock/ops-purge/moved.png");
  await page.getByRole("button", { name: "移動・名前を変更" }).click();
  await expect(page.getByText("移動しました。")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByLabel("場所と名前")).toHaveValue(
    "/mock/ops-purge/moved.png",
  );

  await page.getByRole("button", { name: "ゴミ箱へ" }).click();
  await expect(page.getByText(/ゴミ箱にあります/)).toBeVisible();
  expect(await uploadedKeys(page)).toContain("/mock/ops-purge/a.png");

  await page.goto("/media/trash/");
  const row = page.getByTestId("trash-row").filter({ hasText: "moved.png" });
  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: "完全に削除…" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "選んだ 1 件を完全に削除しますか？",
  );
  await page.getByRole("button", { name: "完全に削除する" }).click();
  await expect(page.getByText("1 件を完全に削除しました。")).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(await uploadedKeys(page)).not.toContain("/mock/ops-purge/a.png");
});

test("restore from the trash, and a key that may not delete", async ({
  page,
}) => {
  await folderWith(page, "ops-restore", ["keep.png", "nodelete.png"]);
  await page.getByRole("button", { name: "フォルダをゴミ箱へ" }).click();
  await expect(page.getByText("ゴミ箱に入れました。")).toBeVisible();

  await page.goto("/media/trash/");
  await expect(page.getByTestId("trash-bytes")).toContainText("合計");
  const keep = page.getByTestId("trash-row").filter({ hasText: "keep.png" });
  await keep.getByRole("checkbox").check();
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("1 件を元に戻しました。")).toBeVisible();
  await expect(keep).toHaveCount(0);

  // The fake bucket answers 403 for this key, as B2 does for a key
  // without deleteFiles: the row stays, to try again.
  const denied = page
    .getByTestId("trash-row")
    .filter({ hasText: "nodelete.png" });
  await denied.getByRole("checkbox").check();
  await page.getByRole("button", { name: "完全に削除…" }).click();
  await page.getByRole("button", { name: "完全に削除する" }).click();
  await expect(page.getByText(/削除の権限がありません/)).toBeVisible();
  await expect(denied).toHaveCount(1);

  await page.goto("/media/?view=files&dir=/mock/ops-restore");
  await expect(tiles(page)).toHaveCount(1);
  await expect(tiles(page)).toContainText("keep.png");
});
