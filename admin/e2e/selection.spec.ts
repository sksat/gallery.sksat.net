import { expect, test, type Page } from "@playwright/test";
import { folderWith, tiles } from "./files-helpers";

// The Files view's selection: picking tiles and what the selection bar
// does with them, on photos uploaded into folders of its own.

const summary = (page: Page) => page.getByTestId("selection-summary");
const bar = (page: Page) => page.getByTestId("selection-bar");
const tick = (page: Page, name: string) =>
  page.getByRole("checkbox", { name: `${name} を選ぶ` });
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
    await expect(page.locator("li[data-selected]")).toHaveCount(3);

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
    // Keys work right after ticking a box (it keeps the focus).
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
      await bar(page).getByRole("button", { name: "公開する情報…" }).click();
      return page.getByRole("dialog", { name: /公開する情報/ });
    };

    let dialog = await open();
    await expect(dialog).toContainText("2 枚");
    await expect(dialog.getByLabel("カメラ")).toHaveValue("");
    await dialog.getByLabel("カメラ").selectOption("hidden");
    await dialog.getByLabel("ワールド").selectOption("name");
    await dialog.getByRole("button", { name: "適用" }).click();
    await expect(page.getByText("2 枚の公開する情報を変えました。")).toBeVisible();
    await expect(dialog).toHaveCount(0);

    dialog = await open();
    await expect(dialog.getByLabel("カメラ")).toHaveValue("hidden");
    await expect(dialog.getByLabel("ワールド")).toHaveValue("name");
    await dialog.getByRole("button", { name: "やめる" }).click();
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press("Escape");

    // One photo differs: its field says so and is left alone.
    await tick(page, "a.png").click();
    await bar(page).getByRole("button", { name: "公開する情報…" }).click();
    await dialog.getByLabel("カメラ").selectOption("manufacturer");
    await dialog.getByRole("button", { name: "適用" }).click();
    await expect(page.getByText("1 枚の公開する情報を変えました。")).toBeVisible();
    dialog = await open();
    await expect(dialog.getByLabel("カメラ")).toHaveValue("keep");
    await expect(dialog.getByLabel("ワールド")).toHaveValue("name");
    await dialog.getByLabel("ワールド").selectOption("");
    await dialog.getByRole("button", { name: "適用" }).click();
    await expect(page.getByText("2 枚の公開する情報を変えました。")).toBeVisible();
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByText("元に戻しました。")).toBeVisible();

    dialog = await open();
    await expect(dialog.getByLabel("ワールド")).toHaveValue("name");
    await expect(dialog.getByLabel("カメラ")).toHaveValue("keep");
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
});
