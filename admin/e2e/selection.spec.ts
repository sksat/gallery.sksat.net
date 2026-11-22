import { expect, test, type Page } from "@playwright/test";
import { folderWith, png, tick, tile, tiles } from "./files-helpers";
import { mapLoaded, stubMaps } from "./map-helpers";

// The Files view's selection: picking tiles and what the selection bar
// does with them, the keyboard, the context menu, dragging onto folders
// and the order / layout, on photos uploaded into folders of its own.

const summary = (page: Page) => page.getByTestId("selection-summary");
const bar = (page: Page) => page.getByTestId("selection-bar");
/** The bar's 情報… menu, then one of its items. */
const info = async (page: Page, item: string) => {
  await bar(page).getByRole("button", { name: "情報…" }).click();
  await page.getByRole("menu", { name: "情報" }).getByRole("menuitem", { name: item }).click();
};
const levelButton = (page: Page, name: "公開" | "限定公開" | "非公開") =>
  bar(page)
    .getByRole("group", { name: "公開範囲" })
    .getByRole("button", { name, exact: true });

test.describe("selection in the Files view", () => {
  test("pick with a click and Shift, move into a new folder, undo", async ({
    page,
  }) => {
    await folderWith(page, "sel-move", ["a.png", "b.png", "c.png"]);
    await tick(page, "a.png").click();
    await expect(summary(page)).toContainText("1 件選択");
    await tick(page, "c.png").click({ modifiers: ["Shift"] });
    await expect(summary(page)).toContainText("3 件選択");
    await expect(page.locator("[role=option][aria-selected=true]")).toHaveCount(
      3,
    );

    await bar(page).getByRole("button", { name: "移動…" }).click();
    const dialog = page.getByRole("dialog", { name: "3 件を移動" });
    await dialog.locator('input[name="dest"][value="/mock"]').check();
    await dialog.getByLabel(/新しいフォルダ/).fill("sel-dest");
    await dialog.getByRole("button", { name: "ここへ移動" }).click();
    await expect(
      page.getByText("3 件を /mock/sel-dest に移動しました。"),
    ).toBeVisible();
    await expect(tiles(page)).toHaveCount(0);
    await expect(bar(page)).toHaveCount(0);

    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByText("元に戻しました。")).toBeVisible();
    await expect(tiles(page)).toHaveCount(3);
  });

  test("Ctrl-click, Ctrl+A, Esc and Delete", async ({ page }) => {
    await folderWith(page, "sel-keys", ["a.png", "b.png"]);
    // Keys work right after a click on a tick mark.
    await tick(page, "a.png").click();
    await expect(summary(page)).toContainText("1 件選択");
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);
    const url = page.url();
    // Ctrl-click selects instead of opening the photo.
    await tiles(page)
      .first()
      .click({ modifiers: ["ControlOrMeta"] });
    await expect(summary(page)).toContainText("1 件選択");
    expect(page.url()).toBe(url);
    // While something is selected, a plain click toggles too.
    await tiles(page).nth(1).click();
    await expect(summary(page)).toContainText("2 件選択");
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+a");
    await expect(summary(page)).toContainText("2 件選択");
    await page.keyboard.press("Delete");
    await expect(page.getByText("2 件をゴミ箱に入れました。")).toBeVisible();
    await expect(tiles(page)).toHaveCount(0);
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(tiles(page)).toHaveCount(2);
  });

  test("making photos public shows them first; private applies at once", async ({
    page,
  }) => {
    await folderWith(page, "sel-public", ["a.png", "b.png"]);
    await page.keyboard.press("ControlOrMeta+a");
    // New uploads are private: that level is the pressed one.
    await expect(levelButton(page, "非公開")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await levelButton(page, "公開").click();
    const confirm = page.getByTestId("visibility-confirm");
    await expect(confirm.getByRole("listitem")).toHaveCount(2);
    await confirm.getByRole("button", { name: "戻る" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(
      tiles(page).getByTestId("visibility-badge").first(),
    ).toHaveText("Private");

    await levelButton(page, "公開").click();
    await confirm.getByRole("button", { name: "2 枚を公開" }).click();
    await expect(page.getByText(/changed to Public/)).toBeVisible();
    await expect(tiles(page).getByTestId("visibility-badge")).toHaveText([
      "Public",
      "Public",
    ]);
    await expect(bar(page)).toHaveCount(0);

    // Back to private: nothing to look at, so no confirm.
    await page.keyboard.press("ControlOrMeta+a");
    await levelButton(page, "非公開").click();
    await expect(page.getByText(/changed to Private/)).toBeVisible();
    await expect(tiles(page).getByTestId("visibility-badge")).toHaveText([
      "Private",
      "Private",
    ]);
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(tiles(page).getByTestId("visibility-badge")).toHaveText([
      "Public",
      "Public",
    ]);
  });

  test("metadata levels for the selection, and undo", async ({ page }) => {
    await folderWith(page, "sel-meta", ["a.png", "b.png"]);
    const open = async () => {
      await page.keyboard.press("ControlOrMeta+a");
      await info(page, "公開する情報…");
      return page.getByRole("dialog", { name: /公開する情報/ });
    };

    let dialog = await open();
    await expect(dialog).toContainText("2 枚");
    await expect(dialog.getByLabel("カメラ")).toHaveValue("");
    await dialog.getByLabel("カメラ").selectOption("hidden");
    await dialog.getByLabel("ワールド").selectOption("name");
    await dialog.getByRole("button", { name: "適用" }).click();
    await expect(
      page.getByText("2 枚の公開する情報を変えました。"),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);

    dialog = await open();
    await expect(dialog.getByLabel("カメラ")).toHaveValue("hidden");
    await expect(dialog.getByLabel("ワールド")).toHaveValue("name");
    await dialog.getByRole("button", { name: "やめる" }).click();
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press("Escape");

    // One photo differs: its field says so and is left alone.
    await tick(page, "a.png").click();
    await info(page, "公開する情報…");
    await dialog.getByLabel("カメラ").selectOption("manufacturer");
    await dialog.getByRole("button", { name: "適用" }).click();
    await expect(
      page.getByText("1 枚の公開する情報を変えました。"),
    ).toBeVisible();
    dialog = await open();
    await expect(dialog.getByLabel("カメラ")).toHaveValue("keep");
    await expect(dialog.getByLabel("ワールド")).toHaveValue("name");
    await dialog.getByLabel("ワールド").selectOption("");
    await dialog.getByRole("button", { name: "適用" }).click();
    await expect(
      page.getByText("2 枚の公開する情報を変えました。"),
    ).toBeVisible();
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByText("元に戻しました。")).toBeVisible();

    dialog = await open();
    await expect(dialog.getByLabel("ワールド")).toHaveValue("name");
    await expect(dialog.getByLabel("カメラ")).toHaveValue("keep");
  });
});

test("more photos than one request takes go in chunks, and undo all", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const names = Array.from({ length: 105 }, (_, i) => `p${i}.png`);
  await folderWith(page, "sel-many", names);
  await page.keyboard.press("ControlOrMeta+a");
  await expect(summary(page)).toContainText("105 件選択");

  await levelButton(page, "公開").click();
  const confirm = page.getByTestId("visibility-confirm");
  // The first 48 as thumbnails, then how many more.
  await expect(confirm.getByTestId("thumb-placeholder")).toHaveCount(48);
  await expect(confirm.getByTestId("visibility-confirm-more")).toContainText("+57");
  await confirm.getByRole("button", { name: "105 枚を公開" }).click();
  await expect(
    page.getByText("105 selected, 105 changed to Public."),
  ).toBeVisible();
  await expect(
    tiles(page).getByTestId("visibility-badge").filter({ hasText: "Public" }),
  ).toHaveCount(105);
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(
    tiles(page).getByTestId("visibility-badge").filter({ hasText: "Private" }),
  ).toHaveCount(105);

  await page.keyboard.press("ControlOrMeta+a");
  await info(page, "公開する情報…");
  const dialog = page.getByRole("dialog", { name: /公開する情報/ });
  await dialog.getByLabel("撮影設定").selectOption("hidden");
  await dialog.getByRole("button", { name: "適用" }).click();
  await expect(
    page.getByText("105 枚の公開する情報を変えました。"),
  ).toBeVisible();
});

test("the look before making many photos public keeps its button on screen", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const names = Array.from({ length: 150 }, (_, i) => `q${i}.png`);
  await folderWith(page, "sel-overflow", names);
  const confirm = page.getByTestId("visibility-confirm");
  for (const size of [
    { width: 1024, height: 600 },
    { width: 390, height: 844 },
    { width: 320, height: 640 },
    { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(size);
    await page.keyboard.press("ControlOrMeta+a");
    await expect(summary(page)).toContainText("150 件選択");
    await levelButton(page, "公開").click();
    const apply = confirm.getByRole("button", { name: "150 枚を公開" });
    await expect(apply).toBeInViewport({ ratio: 1 });
    await expect(
      confirm.getByRole("button", { name: "戻る" }),
    ).toBeInViewport({ ratio: 1 });
    // The whole bar stays inside the screen.
    const box = await bar(page).boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
      size.height,
    );
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    await apply.click();
    await expect(
      page.getByText("150 selected, 150 changed to Public."),
    ).toBeVisible();
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByText("元に戻しました。").last()).toBeVisible();
  }
});

test("a camera for the selection, and undo", async ({ page }) => {
  await folderWith(page, "sel-camera", ["a.png", "b.png"]);
  const picker = page.getByRole("dialog", { name: /カメラ/ });
  const choice = (name: string) =>
    picker.getByRole("button", { name, exact: true });
  const open = async () => {
    await info(page, "カメラ…");
    await expect(picker).toBeVisible();
  };

  await page.keyboard.press("ControlOrMeta+a");
  await open();
  // Uploads have no camera: なし is the shared one.
  await expect(choice("なし")).toHaveAttribute("aria-pressed", "true");
  await choice("VirtualLens2").click();
  await expect(
    page.getByText("2 枚のカメラを「VirtualLens2」にしました。"),
  ).toBeVisible();
  await expect(picker).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+a");
  await open();
  await expect(choice("VirtualLens2")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("元に戻しました。")).toBeVisible();

  // One photo gets another camera (from the context menu): mixed.
  await tile(page, "a.png").click({ button: "right" });
  await page.getByRole("menuitem", { name: "カメラ…" }).click();
  await choice("PENTAX SP").click();
  await expect(page.getByText(/1 枚のカメラを「PENTAX SP」に/)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await open();
  // Mixed: そのまま is offered, and no camera is pressed.
  await expect(choice("そのまま（写真ごと）")).toBeVisible();
  await expect(picker.locator("[aria-pressed=true]")).toHaveCount(0);
  await choice("なし").click();
  await expect(page.getByText("1 枚のカメラを外しました。")).toBeVisible();
});

test("a platform for the selection, and undo", async ({ page }) => {
  await folderWith(page, "sel-platform", ["a.png", "b.png"]);
  const picker = page.getByRole("dialog", { name: /プラットフォーム/ });
  const choice = (name: string) =>
    picker.getByRole("button", { name, exact: true });

  await page.keyboard.press("ControlOrMeta+a");
  await info(page, "プラットフォーム…");
  await expect(choice("Real")).toHaveAttribute("aria-pressed", "true");
  await choice("VRChat").click();
  await expect(page.getByText("2 枚を VRChat にしました。")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await info(page, "プラットフォーム…");
  await expect(choice("VRChat")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("元に戻しました。")).toBeVisible();

  // One of them from the context menu: then they differ.
  await tile(page, "b.png").click({ button: "right" });
  await page.getByRole("menuitem", { name: "プラットフォーム…" }).click();
  await choice("VRChat").click();
  await expect(page.getByText("1 枚を VRChat にしました。")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await info(page, "プラットフォーム…");
  await expect(choice("そのまま（写真ごと）")).toBeVisible();
  await expect(picker.locator("[aria-pressed=true]")).toHaveCount(0);
});

test("tags and shooting data for the selection, and undo", async ({
  page,
}) => {
  const external = await stubMaps(page);
  await folderWith(page, "sel-info", ["a.png", "b.png"]);
  const sheet = page.getByRole("dialog", { name: /タグと撮影データ/ });
  const chip = (name: string) =>
    sheet.getByRole("checkbox", { name: new RegExp(`^${name}(?!を公開)`) });
  const tagItem = (name: string) =>
    sheet.getByTestId("bulk-tag").filter({
      has: page.getByRole("checkbox", {
        name: new RegExp(`^${name}(?!を公開)`),
      }),
    });
  const open = async () => {
    await info(page, "タグと撮影データ…");
    await expect(sheet.getByText("読み込み中…")).toHaveCount(0);
  };

  // One photo: a new tag (private), a setting and a position.
  await tick(page, "a.png").click();
  await open();
  await sheet.getByPlaceholder("タグを追加").fill("roll-a");
  await sheet.getByPlaceholder("タグを追加").press("Enter");
  await expect(chip("roll-a")).toHaveAttribute("aria-checked", "true");
  await sheet.getByLabel("ISO", { exact: true }).fill("400");
  await sheet.getByLabel("日付", { exact: true }).fill("2001-02-03");
  await sheet.getByLabel("時刻", { exact: true }).fill("10:20:30");
  // The position from the map, as on the edit page: it fills the inputs.
  const map = sheet.getByTestId("location-map");
  await mapLoaded(map);
  await map.click({ position: { x: 120, y: 80 } });
  await expect(sheet.getByLabel("緯度", { exact: true })).not.toHaveValue("");
  await expect(sheet.getByLabel("経度", { exact: true })).not.toHaveValue("");
  await expect(sheet.getByTestId("location-pin")).toHaveCount(1);
  await sheet.getByRole("button", { name: "適用" }).click();
  await expect(
    page.getByText(
      "1 枚のタグと撮影データを変えました。 新しいタグ『roll-a』は非公開です。",
    ),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);

  // Both: what only one has is mixed, and a click puts it on both.
  await page.keyboard.press("ControlOrMeta+a");
  await open();
  await expect(chip("roll-a")).toHaveAttribute("aria-checked", "mixed");
  await expect(chip("roll-a")).toContainText("1/2");
  await expect(tagItem("roll-a")).toHaveAttribute("data-public", "hidden");
  // A private tag: never shown on a photo, nothing to choose.
  await expect(tagItem("roll-a").getByTestId("bulk-tag-private")).toHaveText(
    "非公開タグ",
  );
  await expect(tagItem("roll-a").getByRole("radio")).toHaveCount(0);
  const iso = sheet.getByLabel("ISO", { exact: true });
  await expect(iso).toHaveValue("");
  await expect(iso).toHaveAttribute("placeholder", "そのまま（写真ごと）");
  await chip("roll-a").click();
  await expect(chip("roll-a")).toHaveAttribute("aria-checked", "true");
  await expect(chip("roll-a")).toContainText("2/2");
  // The dates differ: a new one keeps each photo's own time (none for b).
  const date = sheet.getByLabel("日付", { exact: true });
  await expect(date).toHaveAttribute("placeholder", "そのまま（写真ごと）");
  await date.click();
  await date.fill("1999-08-01");
  await sheet.getByLabel("レンズ", { exact: true }).fill("50mm");
  // Checked like the edit page: a position needs both numbers in range.
  // (The photos' positions differ: one alone would not say where.)
  await sheet.getByLabel("緯度", { exact: true }).fill("95");
  await sheet.getByRole("button", { name: "適用" }).click();
  await expect(sheet.getByRole("alert")).toHaveText(
    "緯度と経度を両方入れてください",
  );
  await sheet.getByLabel("経度", { exact: true }).fill("10");
  await sheet.getByRole("button", { name: "適用" }).click();
  await expect(sheet.getByRole("alert")).toContainText("緯度は -90〜90");
  await sheet.getByRole("button", { name: "緯度を消す" }).click();
  await sheet.getByRole("button", { name: "経度を消す" }).click();
  await sheet.getByRole("button", { name: "適用" }).click();
  await expect(
    page.getByText("2 枚のタグと撮影データを変えました。"),
  ).toBeVisible();

  await page.keyboard.press("ControlOrMeta+a");
  await open();
  await expect(chip("roll-a")).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByLabel("日付", { exact: true })).toHaveValue("1999-08-01");
  await expect(sheet.getByLabel("時刻", { exact: true })).toHaveAttribute(
    "placeholder",
    "そのまま（写真ごと）",
  );
  await expect(sheet.getByLabel("レンズ", { exact: true })).toHaveValue("50mm");
  await expect(sheet.getByLabel("緯度", { exact: true })).toHaveValue("");
  await expect(iso).toHaveAttribute("placeholder", "そのまま（写真ごと）");
  await sheet.getByRole("button", { name: "やめる" }).click();

  // Undo: each photo as it was.
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("元に戻しました。")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await open();
  await expect(chip("roll-a")).toHaveAttribute("aria-checked", "mixed");
  await expect(sheet.getByLabel("レンズ", { exact: true })).toHaveValue("");
  await expect(sheet.getByLabel("緯度", { exact: true })).toHaveAttribute(
    "placeholder",
    "そのまま（写真ごと）",
  );
  await sheet.getByRole("button", { name: "やめる" }).click();

  // a.png keeps the first edit, entered by hand like on the edit page (so
  // the metadata reader leaves it).
  await page.keyboard.press("Escape");
  await tile(page, "a.png").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/media\/\d+\/\?back=/);
  await expect(page.getByTestId("manual-exif")).toBeVisible();
  expect(external).toEqual([]);
});

test("tags shown or hidden on the selected photos, and undo", async ({
  page,
}) => {
  await folderWith(page, "sel-tag-public", ["a.png", "b.png"]);
  const sheet = page.getByRole("dialog", { name: /タグと撮影データ/ });
  /** The site's display of a tag: its 表示 / 非表示 / そのまま. */
  const display = (name: string) =>
    sheet.getByRole("radiogroup", { name: `${name}のサイトでの表示` });
  const choice = (name: string, text: string) =>
    display(name).getByRole("radio", { name: text, exact: true });
  /** A click on the option's label (the radio itself is visually hidden). */
  const pick = (name: string, text: string) =>
    display(name).getByText(text, { exact: true }).click();
  const open = async () => {
    for (const name of ["a.png", "b.png"]) {
      if ((await tile(page, name).getAttribute("aria-selected")) !== "true") {
        await tick(page, name).click();
      }
    }
    await expect(summary(page)).toContainText("2 件選択");
    await info(page, "タグと撮影データ…");
    await expect(sheet.getByText("読み込み中…")).toHaveCount(0);
  };
  const apply = async (text: string) => {
    await sheet.getByRole("button", { name: "適用" }).click();
    await expect(page.getByText(text)).toBeVisible();
    await expect(sheet).toHaveCount(0);
  };

  // VRChat (a public tag) on both: shown on both.
  await open();
  await sheet.getByPlaceholder("タグを追加").fill("VRChat");
  await sheet.getByPlaceholder("タグを追加").press("Enter");
  await expect(choice("VRChat", "表示")).toBeChecked();
  await apply("2 枚のタグと撮影データを変えました。");

  // Hidden on these two.
  await open();
  await expect(choice("VRChat", "そのまま")).toHaveCount(0);
  await pick("VRChat", "非表示");
  await expect(choice("VRChat", "非表示")).toBeChecked();
  await apply("2 枚のタグと撮影データを変えました。");
  await open();
  await expect(choice("VRChat", "非表示")).toBeChecked();
  await sheet.getByRole("button", { name: "やめる" }).click();

  // On the edit page: hidden on this photo.
  await page.keyboard.press("Escape");
  await tile(page, "a.png").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/media\/\d+\/\?back=/);
  const eye = page.getByRole("switch", { name: "VRChatをサイトに表示" });
  await expect(eye).toHaveAttribute("aria-checked", "false");
  // a.png shown again there: then the two differ.
  await eye.click();
  await expect(eye).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();
  await page.goBack();
  await expect(tile(page, "a.png")).toBeVisible();
  await open();
  await expect(choice("VRChat", "そのまま")).toBeChecked();
  await pick("VRChat", "表示");
  await apply("1 枚のタグと撮影データを変えました。");

  // Undo: b.png hidden again.
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("元に戻しました。")).toBeVisible();
  await open();
  await expect(choice("VRChat", "そのまま")).toBeChecked();
  // A tag taken off: nothing to show or hide.
  await sheet.getByRole("checkbox", { name: /^VRChat/ }).click();
  await expect(choice("VRChat", "表示")).toBeDisabled();
  await sheet.getByRole("button", { name: "やめる" }).click();
});


test("a reload that lacks a selected item for a while keeps it selected", async ({
  page,
  context,
}) => {
  await folderWith(page, "sel-reload", ["a.png", "b.png"]);
  await tick(page, "a.png").click();
  await tick(page, "b.png").click();
  await expect(summary(page)).toContainText("2 件選択");

  /** Move b.png (in another tab, as the page would not see it). */
  const other = await context.newPage();
  const href = await tile(page, "b.png").getAttribute("data-href");
  const moveB = async (to: string) => {
    await other.goto(href ?? "");
    await other.getByLabel("場所と名前").fill(to);
    await other.getByRole("button", { name: "移動・名前を変更" }).click();
    await expect(other.getByText("移動しました。")).toBeVisible();
  };
  /** Something that reloads the page's data without touching the selection. */
  let uploads = 0;
  const reload = async () => {
    uploads++;
    await page
      .getByTestId("upload-input")
      .setInputFiles([png(`r${uploads}.png`, `sel-reload/${uploads}`)]);
    await expect(
      page.getByTestId("upload-panel").getByRole("heading"),
    ).toHaveText("1 件アップロードしました");
    await page.getByRole("button", { name: "閉じる" }).click();
    await expect(tile(page, `r${uploads}.png`)).toHaveCount(1);
  };

  await moveB("/mock/sel-reload-away.png");
  await reload();
  // b.png is gone: only what is shown counts (and would be acted on).
  await expect(tile(page, "b.png")).toHaveCount(0);
  await expect(summary(page)).toContainText("1 件選択");

  await moveB("/mock/sel-reload/b.png");
  await reload();
  // Back in the same folder: still selected.
  await expect(tile(page, "b.png")).toHaveAttribute("aria-selected", "true");
  await expect(summary(page)).toContainText("2 件選択");

  // While it is away, an action touches only what is shown.
  await moveB("/mock/sel-reload-away.png");
  await reload();
  await expect(summary(page)).toContainText("1 件選択");
  await tile(page, "a.png").focus();
  await page.keyboard.press("Delete");
  await expect(page.getByText("1 件をゴミ箱に入れました。")).toBeVisible();
  await moveB("/mock/sel-reload/b.png");
  await reload();
  await expect(tile(page, "b.png")).toHaveCount(1);
  await expect(tile(page, "a.png")).toHaveCount(0);
});

test.describe("keyboard, menu and drag in the Files view", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("arrows move the focus, Space picks, F2 renames, Enter opens", async ({
    page,
  }) => {
    await folderWith(page, `kb${test.info().repeatEachIndex || ""}`, [
      "a.png",
      "b.png",
      "c.png",
      "d.png",
      "e.png",
    ]);
    // One tab stop for the whole grid: the first tile.
    await expect(page.locator("[role=option][tabindex='0']")).toHaveCount(1);
    await tile(page, "a.png").focus();
    // Four wide at 1280px: Down goes to the next row, then back.
    await page.keyboard.press("ArrowDown");
    await expect(tile(page, "e.png")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(tile(page, "a.png")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(tile(page, "b.png")).toBeFocused();
    await expect(tile(page, "b.png")).toHaveAttribute("tabindex", "0");

    await page.keyboard.press("Space");
    await expect(tile(page, "b.png")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(summary(page)).toContainText("2 件選択");
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);

    // F2: rename the focused photo, and undo it.
    await page.keyboard.press("ArrowRight");
    await expect(tile(page, "d.png")).toBeFocused();
    await page.keyboard.press("F2");
    const dialog = page.getByRole("dialog", { name: "名前を変更" });
    await expect(dialog.getByLabel("名前")).toHaveValue("d.png");
    await dialog.getByLabel("名前").fill("renamed.png");
    await dialog.getByRole("button", { name: "変更" }).click();
    await expect(
      page.getByText("renamed.png に名前を変えました。"),
    ).toBeVisible();
    await expect(tile(page, "renamed.png")).toHaveCount(1);
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(tile(page, "d.png")).toHaveCount(1);

    // Enter opens the focused photo.
    await tile(page, "a.png").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/media\/\d+\/\?back=/);
  });

  test("right click: the context menu acts on that tile", async ({ page }) => {
    await folderWith(page, "ctx", ["a.png", "b.png"]);
    await tile(page, "b.png").click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(summary(page)).toContainText("1 件選択");
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // 公開 from the menu goes through the same look first.
    await tile(page, "b.png").click({ button: "right" });
    await menu.getByRole("menuitem", { name: "公開", exact: true }).click();
    const confirm = page.getByTestId("visibility-confirm");
    await expect(confirm.getByRole("listitem")).toHaveCount(1);
    await confirm.getByRole("button", { name: "1 枚を公開" }).click();
    await expect(
      tile(page, "b.png").getByTestId("visibility-badge"),
    ).toHaveText("Public");

    // Keyboard: the menu key, then ゴミ箱へ.
    await tile(page, "a.png").focus();
    await page.keyboard.press("Shift+F10");
    // The focus moves into the menu once it is shown.
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(
      menu.getByRole("menuitem", { name: /ゴミ箱へ/ }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("1 件をゴミ箱に入れました。")).toBeVisible();
    await expect(tiles(page)).toHaveCount(1);
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(tiles(page)).toHaveCount(2);
  });

  test("drag selected tiles onto a folder, then undo", async ({ page }) => {
    await folderWith(page, "drag", ["a.png", "b.png", "c.png"]);
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByLabel("Folder name").fill("inner");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page).toHaveURL(/dir=\/mock\/drag\/inner$/);
    await page.goBack();
    await expect(tiles(page)).toHaveCount(3);

    await tick(page, "a.png").click();
    await tick(page, "b.png").click();
    await tile(page, "a.png").dragTo(tile(page, "inner"));
    await expect(
      page.getByText("2 件を /mock/drag/inner に移動しました。"),
    ).toBeVisible();
    await expect(tiles(page)).toHaveCount(1);
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(tiles(page)).toHaveCount(3);

    // An unselected tile drags alone; the tree's folders take drops too.
    const tree = page.getByRole("navigation", { name: "Folders" });
    await tile(page, "c.png").dragTo(tree.getByRole("link", { name: /^mock/ }));
    await expect(page.getByText("1 件を /mock に移動しました。")).toBeVisible();
    await expect(tiles(page)).toHaveCount(2);
  });

  test("sort and list layout, remembered", async ({ page }) => {
    await folderWith(page, "sort", ["b.png", "a10.png", "a9.png"]);
    await expect(tiles(page).first()).toHaveAccessibleName("a9.png");
    await page.getByTestId("files-sort-dir").click();
    await expect(tiles(page).first()).toHaveAccessibleName("b.png");
    await page.getByTestId("files-sort").selectOption("size");
    await expect(page.getByTestId("files-sort-dir")).toHaveAccessibleName(
      "昇順",
    );

    await page.getByRole("button", { name: "リスト" }).click();
    await expect(page.getByRole("button", { name: "リスト" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("[data-file-browser]")).toHaveAttribute(
      "data-layout",
      "list",
    );
    // The column headers sort too: 名前, then again for the other way.
    await page.getByRole("button", { name: "名前で並べ替え" }).click();
    await expect(tiles(page).first()).toHaveAccessibleName("a9.png");
    await page.getByRole("button", { name: "名前で並べ替え" }).click();
    await expect(tiles(page).first()).toHaveAccessibleName("b.png");

    await page.reload();
    await expect(page.locator("[data-file-browser]")).toHaveAttribute(
      "data-layout",
      "list",
    );
    await expect(tiles(page).first()).toHaveAccessibleName("b.png");
    await page.getByRole("button", { name: "タイル" }).click();
    await page.getByTestId("files-sort").selectOption("name");
  });
});

test.describe("a rectangle dragged over the items", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  const center = async (page: Page, name: string) => {
    const b = (await tile(page, name).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const selectedNames = (page: Page) =>
    page
      .locator("[role=option][aria-selected=true]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  const marquee = (page: Page) => page.getByTestId("marquee");

  test("replace, Ctrl flips, Shift adds, Esc puts it back, a click clears", async ({
    page,
  }) => {
    // Four wide at 1280px: a b c d / e f, and empty cells after f.
    await folderWith(page, "marquee", [
      "a.png",
      "b.png",
      "c.png",
      "d.png",
      "e.png",
      "f.png",
    ]);
    // From the empty cell under d.
    const start = {
      x: (await center(page, "d.png")).x,
      y: (await center(page, "f.png")).y,
    };
    const drag = async (to: { x: number; y: number }, mods: string[] = []) => {
      for (const m of mods) await page.keyboard.down(m);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 6 });
      await expect(marquee(page)).toBeVisible();
      await page.mouse.up();
      for (const m of mods) await page.keyboard.up(m);
      await expect(marquee(page)).toHaveCount(0);
    };

    // Plain: up to b covers b c d and f (the rectangle reaches column 2).
    await drag(await center(page, "b.png"));
    expect(await selectedNames(page)).toEqual([
      "b.png",
      "c.png",
      "d.png",
      "f.png",
    ]);
    await expect(summary(page)).toContainText("4 件選択");
    // The focus is on an item the rectangle touched, which has the tab
    // stop (roving tabindex).
    const focused = page.locator("[role=option]:focus");
    await expect(focused).toHaveAttribute("aria-selected", "true");
    await expect(focused).toHaveAttribute("tabindex", "0");

    // Plain again replaces: only d.
    await drag(await center(page, "d.png"));
    expect(await selectedNames(page)).toEqual(["d.png"]);

    // Ctrl flips what it covers: c on, d off.
    await drag(await center(page, "c.png"), ["Control"]);
    expect(await selectedNames(page)).toEqual(["c.png"]);

    // Shift adds: b d f join c.
    await drag(await center(page, "b.png"), ["Shift"]);
    expect(await selectedNames(page)).toEqual([
      "b.png",
      "c.png",
      "d.png",
      "f.png",
    ]);

    // Live while dragging; Esc puts back the selection it started from.
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const d = await center(page, "d.png");
    await page.mouse.move(d.x, d.y, { steps: 4 });
    await expect(summary(page)).toContainText("1 件選択");
    await page.keyboard.press("Escape");
    await expect(marquee(page)).toHaveCount(0);
    await page.mouse.up();
    await expect(summary(page)).toContainText("4 件選択");

    // A click on empty space clears it, and opens nothing.
    const url = page.url();
    await page.mouse.click(start.x, start.y);
    await expect(bar(page)).toHaveCount(0);
    expect(page.url()).toBe(url);

    // A tile still drags as a move, not a rectangle: pressing on it
    // and moving draws none.
    const a = await center(page, "a.png");
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 3, a.y + 40, { steps: 3 });
    await expect(marquee(page)).toHaveCount(0);
    await page.mouse.up();
  });

  test("in the list layout, from below the rows, scrolling at the edge", async ({
    page,
  }) => {
    const names = Array.from(
      { length: 12 },
      (_, i) => `r${String(i).padStart(2, "0")}.png`,
    );
    await folderWith(page, "marquee-list", names);
    await page.getByRole("button", { name: "リスト" }).click();
    await expect(page.locator("[data-file-browser]")).toHaveAttribute(
      "data-layout",
      "list",
    );
    try {
      // From the space under the last row up to the middle of r09.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const below = (await page.locator("[data-file-browser]").boundingBox())!;
      const x = below.x + below.width / 2;
      const y = below.y + below.height + 12;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - 200, (await center(page, "r09.png")).y, {
        steps: 6,
      });
      await expect(summary(page)).toContainText("3 件選択");
      // Back down to r10: r09 leaves the selection, and the focus goes to
      // a row still covered.
      await page.mouse.move(x - 200, (await center(page, "r10.png")).y, {
        steps: 3,
      });
      await expect(summary(page)).toContainText("2 件選択");
      await page.mouse.up();
      expect(await selectedNames(page)).toEqual(["r10.png", "r11.png"]);
      await expect(page.locator("[role=option]:focus")).toHaveAttribute(
        "aria-selected",
        "true",
      );

      // Best effort: at the top edge of the window the page scrolls up,
      // and the rows that come under the rectangle are selected.
      await page.keyboard.press("Escape");
      await expect(bar(page)).toHaveCount(0);
      await page.setViewportSize({ width: 1280, height: 420 });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const before = await page.evaluate(() => window.scrollY);
      expect(before).toBeGreaterThan(0);
      const b2 = (await page.locator("[data-file-browser]").boundingBox())!;
      await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height + 12);
      await page.mouse.down();
      await page.mouse.move(b2.x + b2.width / 2 - 100, 2, { steps: 6 });
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeLessThan(before);
      await expect(tile(page, "r00.png")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await page.mouse.up();
      await expect(summary(page)).toContainText("12 件選択");
    } finally {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "タイル" }).click();
    }
  });
});

test.describe("selection on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("tap the boxes; the bar replaces the tab bar", async ({ page }) => {
    await folderWith(page, "sel-phone", ["a.png", "b.png"]);
    const box = tick(page, "a.png");
    expect((await box.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await box.tap();
    await expect(bar(page)).toContainText("1 件選択");
    await expect(page.locator("[data-tab-bar]")).toBeHidden();
    // A tap on another tile now selects it rather than opening it.
    await tiles(page).nth(1).tap();
    await expect(bar(page)).toContainText("2 件選択");
    // Every control in the bar is a 44px target and fits the screen.
    for (const b of await bar(page).getByRole("button").all()) {
      const r = await b.boundingBox();
      expect(r?.height).toBeGreaterThanOrEqual(44);
      expect((r?.x ?? 0) + (r?.width ?? 0)).toBeLessThanOrEqual(390);
    }

    await levelButton(page, "限定公開").tap();
    const confirm = page.getByTestId("visibility-confirm");
    await expect(confirm.getByRole("listitem")).toHaveCount(2);
    await confirm.getByRole("button", { name: "2 枚を限定公開" }).tap();
    await expect(tiles(page).getByTestId("visibility-badge")).toHaveText([
      "Unlisted",
      "Unlisted",
    ]);

    await tick(page, "a.png").tap();
    await bar(page).getByRole("button", { name: "選択解除" }).tap();
    await expect(bar(page)).toHaveCount(0);
  });

  test("a camera from the bar on a phone", async ({ page }) => {
    await folderWith(page, "sel-camera-phone", ["a.png", "b.png"]);
    await tick(page, "a.png").tap();
    await tick(page, "b.png").tap();
    const button = bar(page).getByRole("button", { name: "情報…" });
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await button.tap();
    const item = page.getByRole("menuitem", { name: "カメラ…" });
    expect((await item.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await item.tap();
    const picker = page.getByRole("dialog", { name: /カメラ/ });
    const pentax = picker.getByRole("button", { name: "PENTAX SP" });
    expect((await pentax.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await pentax.tap();
    await expect(page.getByText(/2 枚のカメラを「PENTAX SP」に/)).toBeVisible();
    // Undone, so the fixture camera keeps no photos for other specs.
    await page.getByRole("button", { name: "元に戻す" }).tap();
    await expect(page.getByText("元に戻しました。")).toBeVisible();
  });

  test("tags and shooting data from the bar on a phone", async ({ page }) => {
    await stubMaps(page);
    await folderWith(page, "sel-info-phone", ["a.png", "b.png"]);
    await tick(page, "a.png").tap();
    await tick(page, "b.png").tap();
    await bar(page).getByRole("button", { name: "情報…" }).tap();
    await page.getByRole("menuitem", { name: "タグと撮影データ…" }).tap();
    const sheet = page.getByRole("dialog", { name: /タグと撮影データ/ });
    const apply = sheet.getByRole("button", { name: "適用" });
    await expect(apply).toBeEnabled();
    // A sheet along the bottom: its buttons stay on screen while the
    // sections scroll.
    for (const el of [apply, sheet.getByPlaceholder("タグを追加")]) {
      const r = await el.boundingBox();
      expect(r?.height).toBeGreaterThanOrEqual(44);
      expect((r?.x ?? 0) + (r?.width ?? 0)).toBeLessThanOrEqual(390);
    }
    const r = await apply.boundingBox();
    expect((r?.y ?? 0) + (r?.height ?? 0)).toBeLessThanOrEqual(844);
    await sheet.getByPlaceholder("タグを追加").fill("phone-roll");
    await sheet.getByRole("button", { name: "追加" }).tap();
    await sheet.getByLabel("F 値", { exact: true }).fill("2.8");
    await apply.tap();
    await expect(
      page.getByText(/2 枚のタグと撮影データを変えました。/),
    ).toBeVisible();
    await page.getByRole("button", { name: "元に戻す" }).tap();
    await expect(page.getByText("元に戻しました。")).toBeVisible();
  });

  test("a long press starts selecting; one item can be renamed", async ({
    page,
  }) => {
    await folderWith(page, "sel-long", ["a.png", "b.png"]);
    const a = tile(page, "a.png");
    const box = await a.boundingBox();
    const at = {
      pointerType: "touch",
      isPrimary: true,
      clientX: (box?.x ?? 0) + 40,
      clientY: (box?.y ?? 0) + 40,
    };
    await a.dispatchEvent("pointerdown", at);
    await expect(bar(page)).toContainText("1 件選択");
    await a.dispatchEvent("pointerup", at);
    // The page stays (a long press does not open the photo).
    await expect(page).toHaveURL(/dir=\/mock\/sel-long$/);

    await bar(page).getByRole("button", { name: "名前を変更" }).tap();
    const dialog = page.getByRole("dialog", { name: "名前を変更" });
    await dialog.getByLabel("名前").fill("long.png");
    await dialog.getByRole("button", { name: "変更" }).tap();
    await expect(tile(page, "long.png")).toHaveCount(1);
  });
});
