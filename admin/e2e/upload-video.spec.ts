import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { buildMp4 } from "../src/lib/fixtures/video";

// Video uploads into the fake bucket (e2e/fake-b2.mjs) and the local R2
// simulation of wrangler pages dev: the original to B2 (one PUT, or parts
// for a large file), a poster drawn by the browser, and the playback copy
// without the file's metadata, played back from /play/<id>/. Runs after
// the specs that count fixture rows (it adds its own).

const port = Number(process.env.ADMIN_E2E_PORT) || 5175;
const fakeB2 = `http://127.0.0.1:${port + 2}`;

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url));

const newFolder = async (page: Page, name: string) => {
  await page.goto("/media/?view=files&dir=/mock");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(new RegExp(`dir=/mock/${name}$`));
};

type Stored = { key: string; size: number; contentType: string };
const stored = async (page: Page): Promise<Stored[]> =>
  (await page.request.get(`${fakeB2}/__uploads`)).json();

const finished = async (page: Page, count: number) => {
  const panel = page.getByTestId("upload-panel");
  await expect(panel.getByRole("heading")).not.toHaveText(/アップロード中/, {
    timeout: 60_000,
  });
  // The whole panel, so a failure shows its reason.
  await expect(panel).toContainText(`${count} 件アップロードしました`);
  await page.getByRole("button", { name: "閉じる" }).click();
};

/** The edit page's media id, from its URL. */
const openTile = async (page: Page, name: string): Promise<number> => {
  await page.getByTestId("file-tile").filter({ hasText: name }).click();
  await expect(page).toHaveURL(/\/media\/\d+\//);
  // Settled (its loaders and the player's first request), so a click on
  // the page's buttons is not lost to a re-render.
  await page.waitForLoadState("networkidle");
  return Number(/\/media\/(\d+)\//.exec(page.url())![1]);
};

test("upload a video: original, poster and a copy without its metadata", async ({
  page,
}) => {
  await newFolder(page, "vid-1");
  const original = fixture("clip-meta.mp4");
  await page
    .getByTestId("upload-input")
    .setInputFiles([
      { name: "clip-meta.mp4", mimeType: "video/mp4", buffer: original },
    ]);
  await finished(page, 1);

  // The tile: a play mark with its length.
  const tile = page
    .getByTestId("file-tile")
    .filter({ hasText: "clip-meta.mp4" });
  await expect(tile.getByTestId("video-badge")).toHaveText(/0:02/);

  // B2 has the original as it is, and a poster JPEG.
  const keys = await stored(page);
  const orig = keys.find((k) => k.key === "/mock/vid-1/clip-meta.mp4");
  expect(orig).toMatchObject({
    size: original.length,
    contentType: "video/mp4",
  });
  const poster = keys.find((k) => k.key.startsWith("/.poster/"));
  expect(poster?.contentType).toBe("image/jpeg");

  const id = await openTile(page, "clip-meta.mp4");
  await expect(page.getByTestId("video-info")).toHaveText(
    "0:02・320 × 180・vp09",
  );
  // The file's position and device went into the photo's data (private).
  await expect(page.locator("main")).toContainText("35.6895");
  const video = page.getByTestId("admin-video");
  await expect(video).toHaveAttribute("src", `/play/${id}/`);

  // The copy: same size, seekable, and without the metadata.
  const full = await page.request.get(`/play/${id}/`);
  expect(full.status()).toBe(200);
  expect(full.headers()["accept-ranges"]).toBe("bytes");
  const copy = await full.body();
  expect(copy.length).toBe(original.length);
  expect(original.includes("TestMake")).toBe(true);
  expect(copy.includes("TestMake")).toBe(false);
  expect(copy.includes("+35.6895")).toBe(false);
  const part = await page.request.get(`/play/${id}/`, {
    headers: { Range: "bytes=100-199" },
  });
  expect(part.status()).toBe(206);
  expect(part.headers()["content-range"]).toBe(
    `bytes 100-199/${original.length}`,
  );
  expect((await part.body()).length).toBe(100);

  // Chromium decodes VP9: the player gets as far as the first frame.
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1);
});

test("a large video goes up in parts, to B2 and to R2", async ({ page }) => {
  // The fake bucket refuses ListParts for this name, like the upload key
  // without listFiles: the browser's ETags complete the upload.
  test.slow();
  await newFolder(page, "vid-2");
  // 17 MiB: just over one part (multipart.ts). Not decodable, so no
  // poster: the upload goes on without one.
  const big = buildMp4({
    mdat: new Uint8Array(17 * 1024 * 1024).fill(7),
  }).bytes;
  await page
    .getByTestId("upload-input")
    .setInputFiles([
      {
        name: "big-nolist.mp4",
        mimeType: "video/mp4",
        buffer: Buffer.from(big),
      },
    ]);
  await finished(page, 1);
  const keys = await stored(page);
  expect(keys.find((k) => k.key === "/mock/vid-2/big-nolist.mp4")?.size).toBe(
    big.length,
  );
  // No multipart upload is left open.
  expect(
    await (await page.request.get(`${fakeB2}/__multipart`)).json(),
  ).toEqual([]);
  const id = await openTile(page, "big-nolist.mp4");
  const head = await page.request.head(`/play/${id}/`);
  expect(Number(head.headers()["content-length"])).toBe(big.length);
});

test("a WebM video, deleted for good from the trash with its copy", async ({
  page,
}) => {
  await newFolder(page, "vid-3");
  await page
    .getByTestId("upload-input")
    .setInputFiles([
      {
        name: "clip.webm",
        mimeType: "video/webm",
        buffer: fixture("clip.webm"),
      },
    ]);
  await finished(page, 1);
  const id = await openTile(page, "clip.webm");
  expect((await page.request.head(`/play/${id}/`)).status()).toBe(200);
  expect(
    (await stored(page)).some((k) => k.key === "/mock/vid-3/clip.webm"),
  ).toBe(true);
  const postersBefore = (await stored(page)).filter((k) =>
    k.key.startsWith("/.poster/"),
  ).length;

  // Trash it, then delete it for good: the original, its poster and copy.
  await page.getByRole("button", { name: "ゴミ箱へ" }).click();
  await expect(page.getByText(/ゴミ箱にあります/)).toBeVisible();
  await page.goto("/media/trash/");
  const row = page.getByTestId("trash-row").filter({ hasText: "clip.webm" });
  await expect(row.getByTestId("video-badge")).toBeVisible();
  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: "完全に削除…" }).click();
  await page.getByRole("button", { name: "完全に削除する" }).click();
  await expect(page.getByText("1 件を完全に削除しました。")).toBeVisible();

  const after = await stored(page);
  expect(after.some((k) => k.key === "/mock/vid-3/clip.webm")).toBe(false);
  expect(after.filter((k) => k.key.startsWith("/.poster/")).length).toBe(
    postersBefore - 1,
  );
  expect((await page.request.head(`/play/${id}/`)).status()).toBe(404);
});
