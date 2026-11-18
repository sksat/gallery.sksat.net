import { expect, test } from "@playwright/test";
import { folderWith, tiles, uploadedKeys } from "./files-helpers";

// Moving, renaming and the trash, on photos this spec uploads into its own
// folder (files-helpers.ts), so the fixture rows other specs count stay as
// they are.

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
  // Straight to the edit page: the Files view may still be refreshing
  // after the upload, and that could take a client-side click back.
  await page.goto((await tiles(page).first().getAttribute("href")) ?? "");
  await expect(page.getByLabel("場所と名前")).toBeVisible();

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
