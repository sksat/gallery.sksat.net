import { expect, test, type Page } from "@playwright/test";

// The Files view's upload panel after a batch with one photo uploaded and
// one failed (PUTs to the fake bucket of "bad.png" are reset). Named to run
// last: the uploads stay in the shared D1.

const png = (name: string, seed: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(48 * 1024, seed),
  ]),
});

const uploadBatch = async (page: Page, folder: string, seed: string) => {
  await page.route("**/sksat-gallery/**", (route) =>
    route.request().method() === "PUT" && route.request().url().includes("bad")
      ? route.abort("connectionreset")
      : route.continue(),
  );
  await page.goto("/media/?view=files&dir=/mock");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(folder);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(new RegExp(`dir=/mock/${folder}$`));
  await page
    .getByTestId("upload-input")
    .setInputFiles([
      png("VRChat_2026-11-18_01-02-03.456_64x64.png", seed),
      png("bad.png", `${seed}x`),
    ]);
  await expect(
    page.getByTestId("upload-panel").getByRole("heading"),
  ).toHaveText("1 件が失敗しました", { timeout: 15_000 });
  await expect(page.getByTestId("file-tile")).toHaveCount(1);
  await expect(page.getByTestId("upload-folder")).toBeVisible();
};

const shot = (page: Page, name: string) =>
  expect(page).toHaveScreenshot(name, {
    fullPage: true,
    // How far a failed PUT got before the reset varies.
    mask: [page.getByRole("progressbar")],
  });

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("admin: upload panel", async ({ page }) => {
    await uploadBatch(page, "vrt-up", "a");
    await shot(page, "admin-upload.png");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("admin: upload panel (phone)", async ({ page }) => {
    await uploadBatch(page, "vrt-up-phone", "b");
    await shot(page, "admin-upload-phone.png");
  });
});
