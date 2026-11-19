import { expect, test, type Page } from "@playwright/test";

// /setting/upload-rule/ with the built-in rules, and a rule's editor
// sheet (opened on the first rule, then left without saving).

const open = async (page: Page) => {
  await page.goto("/setting/upload-rule/", { waitUntil: "networkidle" });
  await expect(page.getByTestId("rule-card")).toHaveCount(2);
};

const openEditor = async (page: Page) => {
  await page
    .getByTestId("rule-card")
    .first()
    .getByRole("button", { name: "編集" })
    .click();
  const sheet = page.getByTestId("rule-editor");
  await expect(sheet).toBeVisible();
  // Every kind of control: add the rest of the actions.
  for (const label of ["カメラ", "タグ", "公開範囲"]) {
    await sheet.getByTestId("add-action").selectOption({ label });
  }
  await sheet.getByTestId("add-condition").selectOption({ label: "ファイル名" });
  await sheet.getByLabel("名前").focus();
  return sheet;
};

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("admin: upload rules", async ({ page }) => {
    await open(page);
    await expect(page).toHaveScreenshot("admin-upload-rules.png", {
      fullPage: true,
    });
  });

  test("admin: upload rule editor", async ({ page }) => {
    await open(page);
    await openEditor(page);
    await expect(page).toHaveScreenshot("admin-upload-rule-editor.png");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("admin: upload rules (phone)", async ({ page }) => {
    await open(page);
    await expect(page).toHaveScreenshot("admin-upload-rules-phone.png", {
      fullPage: true,
    });
  });

  test("admin: upload rule editor (phone)", async ({ page }) => {
    await open(page);
    await openEditor(page);
    await expect(page).toHaveScreenshot("admin-upload-rule-editor-phone.png");
  });
});
