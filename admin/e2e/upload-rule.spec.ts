import { expect, test, type Page } from "@playwright/test";
import { dropZoneOf, folderWith, png, tile } from "./files-helpers";

// /setting/upload-rule/: the rules that decide a new photo's platform,
// camera, tags, ... (src/lib/upload-rules.ts), and applying them to photos
// already uploaded. Each test removes the rules it adds, so the built-in
// two are all that is left for upload.spec.ts, which runs next.

const PAGE = "/setting/upload-rule/";
const VRCHAT = "VRChat_2026-11-18_01-02-03.456_64x64.png";

const cards = (page: Page) => page.getByTestId("rule-card");
const card = (page: Page, title: string) =>
  cards(page).filter({ has: page.getByRole("heading", { name: title }) });
const editor = (page: Page) => page.getByTestId("rule-editor");

/** Wait for the save of a change (its toast). */
const saved = async (page: Page, text: string | RegExp) => {
  await expect(page.getByRole("status")).toContainText(text);
};

/**
 * The rules page, settled: a click right after the previous page's
 * requests were cut off by the navigation was sometimes lost.
 */
const open = async (page: Page) => {
  await page.goto(PAGE, { waitUntil: "networkidle" });
};

const removeRule = async (page: Page, title: string) => {
  await open(page);
  await card(page, title).getByRole("button", { name: "削除" }).click();
  await saved(page, "削除しました");
  await expect(card(page, title)).toHaveCount(0);
};

const BUILT_IN = ["vrchat-folder", "vrchat-name"];

// A test that failed halfway leaves its rules: remove them, so the next
// tests (and upload.spec.ts) start from the built-in two.
test.afterEach(async ({ page }) => {
  await open(page);
  for (;;) {
    const ids = await cards(page).evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-rule") ?? ""),
    );
    const id = ids.find((x) => !BUILT_IN.includes(x));
    if (id === undefined) break;
    const extra = page.locator(`[data-testid="rule-card"][data-rule="${id}"]`);
    await extra.getByRole("button", { name: "削除" }).click();
    await expect(extra).toHaveCount(0);
  }
});

/** A photo's edit page, from its folder in the Files view. */
const openPhoto = async (page: Page, dir: string, name: string) => {
  await page.goto(`/media/?view=files&dir=${dir}`, {
    waitUntil: "networkidle",
  });
  await tile(page, name).dblclick();
  await expect(page).toHaveURL(/\/media\/\d+\//);
};

test("the built-in rules reproduce the VRChat platform guess", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByTestId("rules-order")).toHaveText("上のルールが優先");
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(0)).toContainText("/VRChat/ フォルダ");
  await expect(cards(page).nth(0)).toContainText("VRChat");
  await expect(cards(page).nth(1)).toContainText("VRChat のファイル名");
});

test("a camera rule sets the camera of a VRChat upload, shown in the panel", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "＋ ルールを追加" }).click();
  const sheet = editor(page);
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("名前").fill("VirtualLens2 で撮った");
  await sheet.getByTestId("add-condition").selectOption({ label: "ファイル名" });
  // VRChat's names are the first choice.
  await expect(sheet.locator("#rule-cond-name")).toHaveValue("vrchat");
  await sheet.getByTestId("add-action").selectOption({ label: "カメラ" });
  await sheet.locator("#rule-action-cameraId").selectOption({
    label: "VirtualLens2",
  });
  await sheet.getByTestId("add-action").selectOption({ label: "タグ" });
  await sheet.locator("#rule-action-tags").fill("vl2");
  await sheet.getByRole("button", { name: "保存" }).click();
  await saved(page, "ルールを追加しました");
  await expect(sheet).toHaveCount(0);
  const added = card(page, "VirtualLens2 で撮った");
  await expect(added).toContainText("VRChat のファイル名");
  await expect(added).toContainText("VirtualLens2");
  await expect(added).toContainText("#vl2");

  // Upload a VRChat screenshot.
  await page.goto("/media/?view=files&dir=/mock");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("rule-cam");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/dir=\/mock\/rule-cam$/);
  await dropZoneOf(page, "/mock/rule-cam");
  await page.getByTestId("upload-input").setInputFiles([png(VRCHAT, "rule")]);
  const panel = page.getByTestId("upload-panel");
  await expect(panel.getByRole("heading")).toHaveText("1 件アップロードしました");
  const applied = panel.getByTestId("upload-applied");
  await expect(applied.locator('[data-field="camera"]')).toHaveText(
    "VirtualLens2 ← VirtualLens2 で撮った",
  );
  await expect(applied.locator('[data-field="platform"]')).toHaveText(
    "VRChat ← VRChat のファイル名",
  );
  await expect(applied.locator('[data-field="tag"]')).toHaveText(
    "#vl2 ← VirtualLens2 で撮った",
  );
  await page.getByRole("button", { name: "閉じる" }).click();

  await openPhoto(page, "/mock/rule-cam", VRCHAT);
  await expect(page.locator("#edit-camera")).toHaveValue("1");
  await expect(page.locator("#edit-tags")).toHaveValue("vl2");
  await expect(page.locator('select[name="platform"]')).toHaveValue("VRChat");

  // Deleting can be undone.
  await open(page);
  await card(page, "VirtualLens2 で撮った")
    .getByRole("button", { name: "削除" })
    .click();
  await saved(page, "削除しました");
  await page.getByRole("button", { name: "元に戻す" }).click();
  await saved(page, "元に戻しました");
  await expect(card(page, "VirtualLens2 で撮った")).toHaveCount(1);
  await page.reload();
  await expect(card(page, "VirtualLens2 で撮った")).toHaveCount(1);
  await removeRule(page, "VirtualLens2 で撮った");
});

test("edit, turn off and reorder rules", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "＋ ルールを追加" }).click();
  const sheet = editor(page);
  await sheet.getByTestId("add-condition").selectOption({ label: "拡張子" });
  await sheet.getByTestId("add-action").selectOption({ label: "公開範囲" });
  await sheet.getByText("限定公開").click();
  await sheet.getByRole("button", { name: "保存" }).click();
  await saved(page, "ルールを追加しました");
  // No name: titled by its condition.
  const rule = card(page, ".png");
  await expect(rule).toContainText("限定公開");
  await expect(cards(page).nth(2)).toHaveAttribute("data-rule", /.+/);
  const id = await rule.getAttribute("data-rule");

  // Edit: a name, and JPEG instead of PNG.
  await rule.getByRole("button", { name: "編集" }).click();
  await sheet.getByLabel("名前").fill("JPEG は限定公開");
  await sheet.getByText("JPEG", { exact: true }).click();
  await sheet.getByRole("button", { name: "保存" }).click();
  await saved(page, "保存しました");
  const edited = card(page, "JPEG は限定公開");
  await expect(edited).toContainText(".jpg");

  // Turn it off.
  const toggle = edited.getByRole("switch");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await saved(page, "止めました");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(edited).toHaveAttribute("data-enabled", "false");

  // Move it to the top.
  await edited.getByRole("button", { name: "JPEG は限定公開 を上へ" }).click();
  await saved(page, "並べ替えました");
  await edited.getByRole("button", { name: "JPEG は限定公開 を上へ" }).click();
  await saved(page, "並べ替えました");
  await expect(cards(page).nth(0)).toHaveAttribute("data-rule", id!);
  await expect(
    edited.getByRole("button", { name: "JPEG は限定公開 を上へ" }),
  ).toBeDisabled();

  // Kept across a reload.
  await page.reload();
  await expect(cards(page).nth(0)).toHaveAttribute("data-rule", id!);
  await expect(cards(page).nth(0).getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await removeRule(page, "JPEG は限定公開");
  await expect(cards(page).nth(0)).toContainText("/VRChat/ フォルダ");
});

test("a rule without a condition is not saved", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "＋ ルールを追加" }).click();
  const sheet = editor(page);
  await sheet.getByTestId("add-action").selectOption({ label: "Platform" });
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet.getByRole("alert")).toHaveText(
    "条件を 1 つ以上選んでください",
  );
  await sheet.getByRole("button", { name: "やめる" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(cards(page)).toHaveCount(2);
});

test("apply the rules to photos already uploaded", async ({
  page,
}) => {
  await folderWith(page, "rule-apply", ["a.png", "b.png"]);

  await open(page);
  await page.getByRole("button", { name: "＋ ルールを追加" }).click();
  const sheet = editor(page);
  await sheet.getByLabel("名前").fill("rule-apply のカメラ");
  await sheet.getByTestId("add-condition").selectOption({ label: "フォルダ" });
  await sheet.locator("#rule-cond-folder").fill("/mock/rule-apply");
  await sheet.getByTestId("add-action").selectOption({ label: "カメラ" });
  await sheet.locator("#rule-action-cameraId").selectOption({
    label: "PENTAX SP",
  });
  await sheet.getByRole("button", { name: "保存" }).click();
  await saved(page, "ルールを追加しました");

  const apply = page.getByTestId("apply-existing");
  await apply.getByLabel("フォルダ (下のフォルダも含む)").fill("/mock/rule-apply");
  await apply.getByRole("button", { name: "確認" }).click();
  await expect(page.getByTestId("apply-preview")).toContainText(
    "/mock/rule-apply の 2 枚のうち 2 枚が変わります",
  );
  await expect(
    card(page, "rule-apply のカメラ").getByTestId("rule-count"),
  ).toHaveText("2 枚が変わります");
  await apply.getByRole("button", { name: "2 枚に適用" }).click();
  await saved(page, "2 枚に適用しました");

  const cameraOf = async (name: string) => {
    await openPhoto(page, "/mock/rule-apply", name);
    return page.locator("#edit-camera");
  };
  await expect(await cameraOf("a.png")).toHaveValue("2");

  // Applied again: nothing left to change.
  await open(page);
  await apply.getByLabel("フォルダ (下のフォルダも含む)").fill("/mock/rule-apply");
  await apply.getByRole("button", { name: "確認" }).click();
  await expect(page.getByTestId("apply-preview")).toContainText(
    "2 枚のうち 0 枚が変わります",
  );
  await removeRule(page, "rule-apply のカメラ");
});

test("every photo only when chosen: an empty or odd folder is refused", async ({
  page,
}) => {
  await open(page);
  const apply = page.getByTestId("apply-existing");
  const input = apply.getByLabel("フォルダ (下のフォルダも含む)");
  // The page sends them as typed: the refusal comes from the server.
  for (const raw of ["", "/", "..", "/mock/../"]) {
    await input.fill(raw);
    await apply.getByRole("button", { name: "確認" }).click();
    await expect(page.getByRole("alert")).toContainText(
      raw.trim() === "" ? "フォルダを入力してください" : "/VRChat のように",
    );
    await expect(page.getByTestId("apply-preview")).toHaveCount(0);
    await page.getByRole("button", { name: "Dismiss" }).click();
  }
  await apply.getByLabel("すべての写真").check();
  await expect(input).toBeDisabled();
  await apply.getByRole("button", { name: "確認" }).click();
  await expect(page.getByTestId("apply-preview")).toContainText(
    /すべての写真 の \d+ 枚のうち/,
  );
});

test("undo of applying to existing photos", async ({ page }) => {
  await folderWith(page, "rule-undo", ["c.png"]);
  await open(page);
  await page.getByRole("button", { name: "＋ ルールを追加" }).click();
  const sheet = editor(page);
  await sheet.getByLabel("名前").fill("rule-undo のタグ");
  await sheet.getByTestId("add-condition").selectOption({ label: "フォルダ" });
  await sheet.locator("#rule-cond-folder").fill("/mock/rule-undo/");
  await sheet.getByTestId("add-action").selectOption({ label: "タグ" });
  await sheet.locator("#rule-action-tags").fill("undo-me");
  await sheet.getByRole("button", { name: "保存" }).click();
  await saved(page, "ルールを追加しました");
  // The trailing slash is dropped.
  await expect(card(page, "rule-undo のタグ")).toContainText(
    "/mock/rule-undo/ フォルダ",
  );

  const apply = page.getByTestId("apply-existing");
  await apply.getByLabel("フォルダ (下のフォルダも含む)").fill("/mock/rule-undo");
  await apply.getByRole("button", { name: "確認" }).click();
  await apply.getByRole("button", { name: "1 枚に適用" }).click();
  await saved(page, "1 枚に適用しました");
  await page.getByRole("button", { name: "元に戻す" }).click();
  await saved(page, "元に戻しました");

  await openPhoto(page, "/mock/rule-undo", "c.png");
  await expect(page.locator("#edit-tags")).toHaveValue("");
  await removeRule(page, "rule-undo のタグ");
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("add a rule in the sheet", async ({ page }) => {
    await page.goto("/setting/");
    await page.getByRole("link", { name: "アップロード時のルール" }).click();
    await expect(page).toHaveURL(/\/setting\/upload-rule\/$/);
    for (const b of [
      cards(page).nth(0).getByRole("switch"),
      cards(page).nth(0).getByRole("button", { name: "編集" }),
      cards(page).nth(0).getByRole("button", { name: /を下へ$/ }),
    ]) {
      expect((await b.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button", { name: "＋ ルールを追加" }).click();
    const sheet = editor(page);
    await sheet.getByTestId("add-condition").selectOption({ label: "位置情報" });
    await sheet.getByTestId("add-action").selectOption({ label: "公開する情報" });
    await sheet.getByTestId("rule-metadata-location").selectOption("hidden");
    // The sheet sits along the bottom of the screen and scrolls inside.
    const box = (await page.locator("dialog[open]").boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
    expect(Math.round(box.y + box.height)).toBe(844);
    // Its buttons stay on screen.
    await expect(sheet.getByRole("button", { name: "保存" })).toBeInViewport({
      ratio: 1,
    });
    await sheet.getByRole("button", { name: "保存" }).click();
    await saved(page, "ルールを追加しました");
    await expect(card(page, "位置情報あり")).toContainText(
      "撮影場所: 出さない",
    );
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    await removeRule(page, "位置情報あり");
  });
});
