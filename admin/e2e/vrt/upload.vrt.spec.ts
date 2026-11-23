import { expect, test, type Page } from "@playwright/test";
import { dropZoneOf, newFolder } from "../files-helpers";

// The Files view's upload panel after a batch with one photo uploaded and
// one failed (PUTs to the fake bucket of "bad.png" are reset), and one
// refused before uploading (too wide, and its display copy cannot be
// made: only a header). Named to run last: the uploads stay in the shared
// D1.

const png = (name: string, seed: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(48 * 1024, seed),
  ]),
});

/**
 * A PNG header (signature + IHDR) too wide for the image Worker, with
 * nothing to decode a display copy from.
 */
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

const uploadBatch = async (page: Page, folder: string, seed: string) => {
  await page.route("**/sksat-gallery/**", (route) =>
    route.request().method() === "PUT" && route.request().url().includes("bad")
      ? route.abort("connectionreset")
      : route.continue(),
  );
  await page.goto("/media/?view=files&dir=/mock");
  await newFolder(page, "/mock", folder, { open: false });
  // Opened afresh: without the toast of the new folder.
  await page.goto(`/media/?view=files&dir=/mock/${folder}`);
  await dropZoneOf(page, `/mock/${folder}`);
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

  test("admin: upload panel while uploading", async ({ page }) => {
    await page.goto("/media/?view=files&dir=/mock");
    await newFolder(page, "/mock", "vrt-up-slow", { open: false });
    await page.goto("/media/?view=files&dir=/mock/vrt-up-slow");
    await dropZoneOf(page, "/mock/vrt-up-slow");
    // The fake bucket reads a key with "slow" in it at 1 MiB/s. The test
    // ends before it is done (the row stays an incomplete upload).
    await page.getByTestId("upload-input").setInputFiles([
      {
        name: "slow.png",
        mimeType: "image/png",
        buffer: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(30 * 1024 * 1024, "v"),
        ]),
      },
    ]);
    await expect(page.getByTestId("upload-time-left")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveScreenshot("admin-upload-progress.png", {
      fullPage: true,
      // How far it got and how long is left depend on the machine.
      mask: [
        page.getByRole("progressbar"),
        page.getByTestId("upload-progress-text"),
        page.getByTestId("upload-row-percent"),
      ],
    });
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("admin: upload panel (phone)", async ({ page }) => {
    await uploadBatch(page, "vrt-up-phone", "b");
    await shot(page, "admin-upload-phone.png");
  });
});
