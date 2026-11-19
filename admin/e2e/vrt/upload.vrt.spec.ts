import { expect, test, type Page } from "@playwright/test";

// The Files view's upload panel after a batch with one photo uploaded and
// one failed (PUTs to the fake bucket of "bad.png" are reset), and one
// refused as too wide before uploading. Named to run last: the uploads
// stay in the shared D1.

const png = (name: string, seed: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(48 * 1024, seed),
  ]),
});

/** A PNG header (signature + IHDR) too wide for the image Worker. */
const tooWide = (name: string) => {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "latin1");
  ihdr.writeUInt32BE(13_000, 8);
  ihdr.writeUInt32BE(9_000, 12);
  ihdr[16] = 8;
  ihdr[17] = 2;
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ihdr,
    ]),
  };
};

const uploadBatch =async (page: Page, folder: string, seed: string) => {
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
      tooWide("wide.png"),
    ]);
  await expect(
    page.getByTestId("upload-row").filter({ hasText: "wide.png" }),
  ).toHaveAttribute("data-status", "skipped");
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
