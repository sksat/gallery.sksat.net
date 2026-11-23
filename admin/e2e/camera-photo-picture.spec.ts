import { expect, test, type Page } from "@playwright/test";

// 写真から選ぶ on a camera's page: library photos added as the camera's
// pictures (migration 0019), with undo, taken off and put back. Each test
// makes its own camera, and no photo changes, so no counts of other specs
// change. The fixture's photos are under /mock/: 1-3 public, 4
// (vrchat2.png) unlisted, 5 (vrchat3.png) private.

/** A new camera, its page open. */
const newCamera = async (page: Page, name: string) => {
  const slug = `e2e-photo-pic-${Date.now().toString(36)}`;
  await page.goto("/camera/new/");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Slug").fill(slug);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Camera created.")).toBeVisible();
  return slug;
};

const images = (page: Page) => page.getByTestId("camera-image");
const toast = (page: Page) => page.getByRole("status");
const undo = (page: Page) =>
  page.getByRole("button", { name: "元に戻す" }).click();

/** Opens the picker on the fixture's /mock/ folder. */
const openPicker = async (page: Page) => {
  await page.getByRole("button", { name: "写真から選ぶ" }).click();
  const picker = page.getByTestId("photo-picker");
  await expect(picker).toBeVisible();
  await picker.getByRole("radio", { name: "すべての写真" }).click();
  await picker.getByLabel("フォルダ").fill("/mock");
  await expect(picker.getByTestId("picker-photo")).toHaveCount(5);
  return picker;
};

test("pick library photos as pictures, undo, take one off and put it back", async ({
  page,
}) => {
  await newCamera(page, "E2E Photo Pictures");
  await expect(
    page.getByRole("heading", { name: "画像 (0)", exact: true }),
  ).toBeVisible();

  const picker = await openPicker(page);
  // Only public photos can be picked: not a private one, nor an unlisted
  // one, which opens only by its own URL.
  await expect(picker.getByLabel("vrchat3.png を選ぶ")).toBeDisabled();
  await expect(picker.getByLabel("vrchat2.png を選ぶ")).toBeDisabled();
  await expect(picker.getByText("公開の写真だけ選べます")).toBeVisible();
  await picker.getByLabel("real1.png を選ぶ").check();
  await picker.getByLabel("vrchat1.png を選ぶ").check();
  await picker.getByRole("button", { name: "2 枚を追加" }).click();
  await expect(picker).toBeHidden();
  await expect(toast(page)).toContainText("2 枚を追加しました。");

  await expect(images(page)).toHaveCount(2);
  // In the order picked, the first the default; each links to its photo.
  await expect(images(page).first()).toHaveAttribute("data-default", "");
  await expect(
    images(page).first().getByTestId("picture-photo-link"),
  ).toHaveText("/mock/real1.png");
  await expect(
    images(page).nth(1).getByTestId("picture-photo-link"),
  ).toHaveAttribute("href", "/media/2/");
  // A photo's picture is taken off, never deleted.
  await expect(
    images(page).first().getByRole("button", { name: "画像 1 を削除" }),
  ).toHaveCount(0);

  // 元に戻す: both gone again.
  await undo(page);
  await expect(toast(page)).toContainText("元に戻しました。");
  await expect(images(page)).toHaveCount(0);

  // Again, then 外す and its 元に戻す.
  const again = await openPicker(page);
  await again.getByLabel("real2.png を選ぶ").check();
  await again.getByRole("button", { name: "1 枚を追加" }).click();
  await expect(images(page)).toHaveCount(1);
  await page.getByRole("button", { name: "画像 1 を外す" }).click();
  await expect(toast(page)).toContainText("外しました。");
  await expect(images(page)).toHaveCount(0);
  await undo(page);
  await expect(toast(page)).toContainText("元に戻しました。");
  await expect(images(page).getByTestId("picture-photo-link")).toHaveText(
    "/mock/real2.png",
  );

  // Already a picture: shown as added.
  const third = await openPicker(page);
  await expect(third.getByLabel("real2.png を選ぶ")).toBeDisabled();
  await expect(third.getByLabel("real2.png を選ぶ")).toBeChecked();
  await third.getByRole("button", { name: "キャンセル" }).click();
  await expect(third).toBeHidden();
});

test("a picture whose photo is made unlisted says the public site does not show it", async ({
  page,
}) => {
  await newCamera(page, "E2E Photo Unlisted");
  const picker = await openPicker(page);
  await picker.getByLabel("real1.png を選ぶ").check();
  await picker.getByRole("button", { name: "1 枚を追加" }).click();
  await expect(images(page)).toHaveCount(1);
  await expect(images(page).getByTestId("picture-hidden")).toHaveCount(0);
  const camera = page.url();
  try {
    await page.goto("/media/1/");
    await page.getByRole("radio", { name: /Unlisted/ }).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/^Saved at /)).toBeVisible();
    await page.goto(camera);
    await expect(images(page).getByTestId("picture-hidden")).toHaveText(
      "写真が限定公開なので、公開サイトには出ません",
    );
  } finally {
    await page.goto("/media/1/");
    await page.getByRole("radio", { name: /Public/ }).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/^Saved at /)).toBeVisible();
  }
});

test("opens on the camera's own photos", async ({ page }) => {
  // VirtualLens2 (camera 1) took photo 2; nothing is added here.
  await page.goto("/camera/1/");
  await page.getByRole("button", { name: "写真から選ぶ" }).click();
  const picker = page.getByTestId("photo-picker");
  await expect(
    picker.getByRole("radio", { name: "このカメラ (1)" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(picker.getByTestId("picker-photo")).toHaveCount(1);
  await expect(picker.getByLabel("vrchat1.png を選ぶ")).toBeEnabled();
  await expect(picker.getByRole("button", { name: "追加" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
});

test("a photo's file cannot be added by path", async ({ page }) => {
  await newCamera(page, "E2E Photo Path");
  const details = page.getByTestId("add-by-path");
  if ((await details.getAttribute("open")) === null) {
    await details.getByText("パスで追加").click();
  }
  await page.getByLabel("パス", { exact: true }).fill("/mock/real1.png");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "「写真から選ぶ」で追加してください",
  );
  await expect(images(page)).toHaveCount(0);
});
