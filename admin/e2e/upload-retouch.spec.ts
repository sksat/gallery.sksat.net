import { expect, test, type Page } from "@playwright/test";
import {
  folderWith,
  png,
  retouchJpeg,
  tile,
  tiles,
  uploadedKeys,
} from "./files-helpers";

// Retouched versions of a photo: added on its edit page (picked or
// dropped), shown on the public site instead of the original, removed and
// put back; and photos uploaded on their own that are retouches of
// another, merged into it (from the upload panel and the merge page), with
// undo. Works in its own folders under /mock (uploads into the fake
// bucket), after the specs that count fixture rows.

const jpeg = (name: string, seed: string) => ({
  name,
  mimeType: "image/jpeg",
  buffer: Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(4096, seed)]),
});

const files = (page: Page) => page.getByTestId("photo-file");
const toast = (page: Page) => page.getByTestId("toast");

/** A photo's edit page, from its folder in the Files view. */
const openPhoto = async (page: Page, dir: string, name: string) => {
  await page.goto(`/media/?view=files&dir=${dir}`, {
    waitUntil: "networkidle",
  });
  await tile(page, name).dblclick();
  await expect(page).toHaveURL(/\/media\/\d+\//);
  // The edit page's drop zone (the Files view's is still there until the
  // page is on screen).
  await expect(page.getByTestId("photo-files")).toBeVisible();
  await expect(page.getByTestId("drop-zone")).toHaveAttribute("data-dir", `${dir}/`);
  await expect(page.getByTestId("drop-zone")).toHaveAttribute("data-ready", "");
};

test("add a retouched version, show it, remove it and undo each", async ({
  page,
}) => {
  await folderWith(page, "rt-edit", ["a.png"]);
  await openPhoto(page, "/mock/rt-edit", "a.png");
  await expect(files(page)).toHaveCount(1);
  await expect(files(page).first()).toContainText("元のファイル");

  await page
    .getByTestId("edit-upload-input")
    .setInputFiles([retouchJpeg("a-Edit.jpg", "rt-edit/edit")]);
  await expect(page.getByTestId("upload-row")).toHaveAttribute("data-status", "done");
  await expect(files(page)).toHaveCount(2);
  const edit = files(page).filter({ hasText: "a-Edit.jpg" });
  await expect(edit).toContainText("レタッチ版 · Adobe Lightroom Classic 14.0 (Windows)");
  // What it was developed with, read in the browser (never the photo's).
  await edit.getByText("現像の記録").click();
  await expect(edit).toContainText("露光量+0.35");
  await expect(edit).toContainText("色温度5600 K");
  await expect(edit).toContainText("ほか 2 項目");
  await expect(edit).toContainText("2026/11/01 10:05 保存 Adobe Lightroom Classic 14.0 (Windows)");
  expect(await uploadedKeys(page)).toContain("/mock/rt-edit/a-Edit.jpg");

  // Shown on the public site instead of the original; undone.
  await edit.getByRole("radio", { name: "a-Edit.jpg を公開サイトに表示" }).check();
  await expect(toast(page)).toContainText("公開サイトに表示するファイルを変えました。");
  await expect(edit).toHaveAttribute("data-shown", "");
  // The shown file cannot be removed.
  await expect(edit.getByRole("button", { name: /ゴミ箱へ/ })).toHaveCount(0);
  await toast(page).getByRole("button", { name: "元に戻す" }).click();
  await expect(toast(page)).toContainText("元に戻しました。");
  await expect(files(page).first()).toHaveAttribute("data-shown", "");
  await expect(edit).not.toHaveAttribute("data-shown", "");

  // Removed, undone, removed again and put back from the trash.
  await edit.getByRole("button", { name: "a-Edit.jpg をゴミ箱へ" }).click();
  await expect(toast(page)).toContainText("ゴミ箱に入れました。");
  await expect(files(page)).toHaveCount(1);
  await toast(page).getByRole("button", { name: "元に戻す" }).click();
  await expect(files(page)).toHaveCount(2);
  await edit.getByRole("button", { name: "a-Edit.jpg をゴミ箱へ" }).click();
  await expect(files(page)).toHaveCount(1);
  const back = page.url();
  await page.goto("/media/trash/");
  const row = page.getByTestId("trash-row").filter({ hasText: "a-Edit.jpg" });
  await expect(row).toContainText("/mock/rt-edit/a.png のレタッチ版");
  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByTestId("toast")).toContainText("1 件を元に戻しました。");
  await expect(page.getByTestId("trash-row").filter({ hasText: "a-Edit.jpg" })).toHaveCount(0);
  await page.goto(back);
  await expect(files(page)).toHaveCount(2);

  // The same bytes again: the photo has them already.
  await page
    .getByTestId("edit-upload-input")
    .setInputFiles([retouchJpeg("again.jpg", "rt-edit/edit")]);
  await expect(page.getByTestId("upload-row").last()).toHaveAttribute("data-status", "skipped");
  // ...and its original's bytes are refused.
  await page
    .getByTestId("edit-upload-input")
    .setInputFiles([png("a-copy.png", "rt-edit/a.png")]);
  await expect(page.getByTestId("upload-row").last()).toHaveAttribute("data-status", "failed");
  await expect(page.getByTestId("upload-row").last()).toContainText("この写真の元のファイルと同じです");
});

test("drop a file on the edit page to add it", async ({ page }) => {
  await folderWith(page, "rt-drop", ["d.png"]);
  await openPhoto(page, "/mock/rt-drop", "d.png");
  const zone = page.getByTestId("drop-zone");
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    const bytes = new Uint8Array(2048).fill(42);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    d.items.add(new File([bytes], "d-Edit.png", { type: "image/png" }));
    return d;
  });
  await zone.dispatchEvent("dragenter", { dataTransfer: dt });
  await expect(zone).toContainText("ここにドロップしてレタッチ版を追加");
  await zone.dispatchEvent("dragover", { dataTransfer: dt });
  await zone.dispatchEvent("drop", { dataTransfer: dt });
  await expect(page.getByTestId("upload-row")).toHaveAttribute("data-status", "done");
  await expect(files(page).filter({ hasText: "d-Edit.png" })).toContainText("レタッチ版");
});

test("an upload named like a photo's retouch can become one, undone", async ({
  page,
}) => {
  await folderWith(page, "rt-hint", ["b.png"]);
  await page.getByTestId("upload-input").setInputFiles([jpeg("b_DxO.jpg", "rt-hint/dxo")]);
  const row = page.getByTestId("upload-row").filter({ hasText: "b_DxO.jpg" });
  await expect(row).toHaveAttribute("data-status", "done");
  const hint = row.getByTestId("upload-similar");
  await expect(hint).toContainText("b.png");
  await expect(tiles(page)).toHaveCount(2);

  await hint.getByRole("button", { name: "b_DxO.jpg を b.png のレタッチ版にする" }).click();
  await expect(toast(page)).toContainText("b.png のレタッチ版にしました。");
  await expect(hint).toContainText("レタッチ版にしました");
  await expect(tiles(page)).toHaveCount(1);
  await toast(page).getByRole("button", { name: "元に戻す" }).click();
  await expect(toast(page)).toContainText("元に戻しました。");
  await expect(tiles(page)).toHaveCount(2);
  await expect(hint.getByRole("button", { name: /レタッチ版にする/ })).toBeVisible();

  // A name of its own: no offer.
  await page.getByTestId("upload-input").setInputFiles([png("other.png", "rt-hint/other")]);
  const plain = page.getByTestId("upload-row").filter({ hasText: "other.png" });
  await expect(plain).toHaveAttribute("data-status", "done");
  await expect(plain.getByTestId("upload-similar")).toHaveCount(0);
});

test("merge candidates side by side, with undo", async ({ page }) => {
  await folderWith(page, "rt-merge", ["c.png", "c-Edit.png"]);
  await page.getByRole("link", { name: /^レタッチ版の候補 \(\d+\)$/ }).click();
  await expect(page).toHaveURL(/\/media\/retouch\/$/);
  const card = page
    .getByTestId("merge-candidate")
    .filter({ hasText: "c-Edit.png" });
  await expect(card).toContainText("c.png");
  await expect(card).toContainText("元の写真");
  await card.getByRole("checkbox", { name: "c-Edit.png を c.png に統合する" }).check();
  await page.getByRole("button", { name: "統合", exact: true }).click();
  await expect(toast(page)).toContainText("1 組を統合しました。");
  await expect(page.getByTestId("merge-candidate").filter({ hasText: "c-Edit.png" })).toHaveCount(0);

  await toast(page).getByRole("button", { name: "元に戻す" }).click();
  await expect(toast(page)).toContainText("元に戻しました。");
  await expect(page.getByTestId("merge-candidate").filter({ hasText: "c-Edit.png" })).toHaveCount(1);

  // Merged for good: one photo with both files, the retouch not shown
  // (both were private).
  await card.getByRole("checkbox", { name: "c-Edit.png を c.png に統合する" }).check();
  await page.getByRole("button", { name: "統合", exact: true }).click();
  await expect(toast(page)).toContainText("1 組を統合しました。");
  await openPhoto(page, "/mock/rt-merge", "c.png");
  await expect(files(page)).toHaveCount(2);
  await expect(files(page).first()).toHaveAttribute("data-shown", "");
  await expect(files(page).filter({ hasText: "c-Edit.png" })).toContainText("レタッチ版");
});
