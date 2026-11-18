import { expect, type Page } from "@playwright/test";

// Shared by the specs that work on photos they upload into their own
// folders under /mock (the fake bucket, e2e/fake-b2.mjs), so the fixture
// rows other specs count stay as they are. Those specs run after the ones
// that count (file names from s on).

const port = Number(process.env.ADMIN_E2E_PORT) || 5175;
const fakeB2 = `http://127.0.0.1:${port + 2}`;

export const png = (name: string, seed: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(8 * 1024, seed),
  ]),
});

export const uploadedKeys = async (page: Page): Promise<string[]> => {
  const res = await page.request.get(`${fakeB2}/__uploads`);
  return ((await res.json()) as { key: string }[]).map((u) => u.key);
};

/** A new folder under /mock with the given files uploaded into it. */
export const folderWith = async (page: Page, name: string, files: string[]) => {
  await page.goto("/media/?view=files&dir=/mock");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(new RegExp(`dir=/mock/${name}$`));
  await page
    .getByTestId("upload-input")
    .setInputFiles(files.map((f) => png(f, `${name}/${f}`)));
  // Up to 150 files at 2–3 at a time: the default 5 s is not enough on a
  // busy CI runner, so allow time per file.
  await expect(
    page.getByTestId("upload-panel").getByRole("heading"),
  ).toHaveText(`${files.length} 件アップロードしました`, {
    timeout: 10_000 + files.length * 300,
  });
  await page.getByRole("button", { name: "閉じる" }).click();
  // The view reloads once the uploads are photos: wait for every tile
  // (150 of them can take more than 5 s to render on CI, too).
  await expect(tiles(page)).toHaveCount(files.length, {
    timeout: 10_000 + files.length * 50,
  });
  // ...and may reload once more (checks of uploads): let it settle, or
  // the next click can land on an element that is being replaced.
  await page.waitForLoadState("networkidle");
};

export const tiles = (page: Page) => page.getByTestId("file-tile");

/** A tile (an option named after the photo or folder). */
export const tile = (page: Page, name: string) =>
  page.getByRole("option", { name, exact: true });

/** A tile's tick mark: a click on it picks the tile. */
export const tick = (page: Page, name: string) =>
  tile(page, name).getByTestId("tile-check");
