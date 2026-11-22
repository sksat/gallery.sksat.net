import { expect, test, type Page } from "@playwright/test";
import { png, retouchJpeg } from "../files-helpers";

// Retouched versions: the upload panel's offer for a file named like a
// photo's retouch, the merge page's pairs side by side, and the edit
// page's files with one retouched version. Its uploads stay in the shared
// D1: named to run after the other specs (upload.vrt.spec.ts included).

const toFolder = async (page: Page, name: string) => {
  await page.goto("/media/?view=files&dir=/mock");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(new RegExp(`dir=/mock/${name}$`));
  const zone = page.getByTestId("drop-zone");
  await expect(zone).toHaveAttribute("data-dir", `/mock/${name}`);
  await expect(zone).toHaveAttribute("data-ready", "");
};

const panel = (page: Page) => page.getByTestId("upload-panel");

test.describe.configure({ mode: "serial" });

test("admin: an upload that may be a photo's retouch", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await toFolder(page, "vrt-retouch");
  await page
    .getByTestId("upload-input")
    .setInputFiles([png("IMG_0042.png", "vrt-retouch/a")]);
  await expect(panel(page).getByRole("heading")).toHaveText("1 件アップロードしました");
  await page.getByRole("button", { name: "閉じる" }).click();
  await page
    .getByTestId("upload-input")
    .setInputFiles([retouchJpeg("IMG_0042-Edit.jpg", "vrt-retouch/b")]);
  await expect(page.getByTestId("upload-similar")).toBeVisible();
  await expect(panel(page)).toHaveScreenshot("admin-upload-retouch-offer.png");
});

for (const [label, size] of [
  ["", { width: 1280, height: 800 }],
  ["-phone", { width: 390, height: 844 }],
] as const) {
  test(`admin: merge candidates${label}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/media/retouch/");
    await expect(page.getByTestId("merge-candidate")).toHaveCount(1);
    await expect(page).toHaveScreenshot(`admin-merge-candidates${label}.png`, {
      fullPage: true,
    });
  });
}

test("admin: a photo's files with a retouched version", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/media/retouch/");
  await page
    .getByRole("checkbox", { name: "IMG_0042-Edit.jpg を IMG_0042.png に統合する" })
    .check();
  await page.getByRole("button", { name: "統合", exact: true }).click();
  await expect(page.getByTestId("toast")).toContainText("1 組を統合しました。");
  await page.goto("/media/?view=files&dir=/mock/vrt-retouch", {
    waitUntil: "networkidle",
  });
  await page.getByRole("option", { name: "IMG_0042.png", exact: true }).dblclick();
  const files = page.getByTestId("photo-files");
  await expect(files.getByTestId("photo-file")).toHaveCount(2);
  await files.getByText("現像の記録").click();
  // The sticky top bar would cover the section's top.
  await page.addStyleTag({
    content: "header { visibility: hidden !important; }",
  });
  for (const [label, size] of [
    ["", { width: 1280, height: 800 }],
    ["-phone", { width: 390, height: 844 }],
  ] as const) {
    await page.setViewportSize(size);
    await expect(files).toHaveScreenshot(`admin-photo-files${label}.png`, {
      mask: [files.getByTestId("file-added")],
    });
  }
});
