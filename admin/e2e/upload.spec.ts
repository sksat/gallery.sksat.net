import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

// Uploads from the Files view into a fake bucket (e2e/fake-b2.mjs on
// PORT+2, which checks the presigned PUTs). Named to run last: uploaded
// rows stay in the shared D1 and would change other specs' counts.

const port = Number(process.env.ADMIN_E2E_PORT) || 5175;
const fakeB2 = `http://127.0.0.1:${port + 2}`;

const VRCHAT = "VRChat_2026-11-18_01-02-03.456_64x64.png";

/** A file for setInputFiles; `seed` makes the content (and hash) unique. */
const png = (name: string, seed: string, kb = 64) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(kb * 1024, seed),
  ]),
});
const jpeg = (name: string, seed: string) => ({
  name,
  mimeType: "image/jpeg",
  buffer: Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(4096, seed)]),
});

const newFolder = async (page: Page, parent: string, name: string) => {
  await page.goto(`/media/?view=files&dir=${parent}`);
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(new RegExp(`dir=${parent}/${name}$`));
};

/** Hold every PUT to the bucket until the returned function is called. */
const holdPuts = async (page: Page) => {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  await page.route("**/sksat-gallery/**", async (route: Route) => {
    if (route.request().method() === "PUT") await released;
    await route.continue();
  });
  return release;
};

const uploadedKeys = async (page: Page): Promise<string[]> => {
  const res = await page.request.get(`${fakeB2}/__uploads`);
  return ((await res.json()) as { key: string }[]).map((u) => u.key);
};

const rows = (page: Page) => page.getByTestId("upload-row");

test("upload two photos into a new folder", async ({ page }) => {
  await newFolder(page, "/mock", "up-1");
  const release = await holdPuts(page);
  await page
    .getByTestId("upload-input")
    .setInputFiles([png(VRCHAT, "a"), jpeg("IMG 0001.jpg", "b")]);

  const panel = page.getByTestId("upload-panel");
  await expect(panel).toContainText("アップロード中 0 / 2");
  await expect(rows(page).filter({ hasText: VRCHAT })).toHaveAttribute(
    "data-status",
    "uploading",
  );
  release();

  await expect(rows(page)).toHaveCount(2);
  for (const r of await rows(page).all()) {
    await expect(r).toHaveAttribute("data-status", "done");
  }
  await expect(panel.getByRole("heading")).toHaveText(
    "2 件アップロードしました",
  );
  await expect(
    panel.getByRole("progressbar", { name: "全体の進み具合" }),
  ).toHaveAttribute("aria-valuenow", "100");
  expect(await uploadedKeys(page)).toEqual(
    expect.arrayContaining([`/mock/up-1/${VRCHAT}`, "/mock/up-1/IMG_0001.jpg"]),
  );

  // The folder reloads with the new photos.
  const tiles = page.getByTestId("file-tile");
  await expect(tiles).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "This folder is empty" }),
  ).toHaveCount(0);

  // Private, with the time from the VRChat file name and the platform.
  await tiles.filter({ hasText: VRCHAT }).click();
  await expect(page.locator("main")).toContainText("Private");
  await expect(page.locator("main")).toContainText("2026/11/18 01:02");
  await expect(page.locator('select[name="platform"]')).toHaveValue("VRChat");
});

test("a slow upload shows its percentage, then the time left", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await newFolder(page, "/mock", "up-slow");
  // The fake bucket reads a key with "slow" in it at 1 MiB/s: ~24 s, well
  // beyond what the loopback socket buffers can take at once.
  await page
    .getByTestId("upload-input")
    .setInputFiles([png("slow.png", "s", 24 * 1024)]);
  const panel = page.getByTestId("upload-panel");
  const bar = panel.getByRole("progressbar", { name: "全体の進み具合" });
  const text = panel.getByTestId("upload-progress-text");

  // The percentage first, the time left only once the speed is known.
  await expect(text).toHaveText(/^\d+%$/);
  await expect(text).toHaveText(/^\d+%残り/, { timeout: 15_000 });
  await expect(panel.getByTestId("upload-time-left")).toHaveText(
    /^残り(約 \d+ 分| 1 分未満)$/,
  );
  expect(Number(await bar.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  await expect(bar).toHaveAttribute("aria-valuetext", /^\d+%、残り/);
  await expect(rows(page).getByTestId("upload-row-percent")).toHaveText(
    /^\d+%$/,
  );

  await expect(rows(page)).toHaveAttribute("data-status", "done", {
    timeout: 45_000,
  });
  await expect(text).toHaveCount(0);
  await expect(bar).toHaveAttribute("aria-valuenow", "100");
});

test("make uploaded photos public from the panel", async ({ page }) => {
  await newFolder(page, "/mock", "up-2");
  await page
    .getByTestId("upload-input")
    .setInputFiles([png("a.png", "c"), png("b.png", "d")]);
  const panel = page.getByTestId("upload-panel");
  await expect(panel.getByRole("heading")).toHaveText(
    "2 件アップロードしました",
  );
  await expect(panel).toContainText("2 枚は非公開で追加されました");
  await panel.getByRole("button", { name: "公開する" }).click();
  await expect(page.getByRole("status")).toContainText("2 changed to Public");

  await page.goto("/media/?visibility=public&q=/mock/up-2/");
  await expect(page.locator("table tbody tr")).toHaveCount(2);
});

test("the same photo is not uploaded twice", async ({ page }) => {
  await newFolder(page, "/mock", "up-3");
  const input = page.getByTestId("upload-input");
  await input.setInputFiles([png("x.png", "e")]);
  await expect(rows(page)).toHaveAttribute("data-status", "done");
  // Same content under another name: skipped, pointing at the first.
  await input.setInputFiles([png("y.png", "e")]);
  const second = rows(page).filter({ hasText: "y.png" });
  await expect(second).toHaveAttribute("data-status", "skipped");
  await expect(second).toContainText("同じ写真が /mock/up-3/x.png にあります");
  // Not a picture at all: skipped without a request.
  await input.setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") },
  ]);
  await expect(rows(page).filter({ hasText: "notes.txt" })).toHaveAttribute(
    "data-status",
    "skipped",
  );
});

/** Every upload request the page makes (init or PUT), as "METHOD url". */
const uploadRequests = (page: Page) => {
  const seen: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/sksat-gallery/") || /\/api\/upload(\/|$)/.test(url)) {
      seen.push(`${req.method()} ${url}`);
    }
  });
  return seen;
};

/** A PNG that is only its signature and IHDR chunk, claiming w × h. */
const pngHeaderOnly = (name: string, width: number, height: number) => {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "latin1");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; // bit depth
  ihdr[17] = 2; // RGB
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ihdr,
    ]),
  };
};

test("files the image Worker could not resize are refused before uploading", async ({
  page,
}) => {
  await newFolder(page, "/mock", "up-limits");
  const sent = uploadRequests(page);
  // Just over 100 MB, sparse on disk (setInputFiles buffers stop at 50 MB).
  const dir = mkdtempSync(join(tmpdir(), "admin-upload-"));
  const big = join(dir, "big.png");
  writeFileSync(big, Buffer.alloc(0));
  truncateSync(big, 123_400_000);
  const input = page.getByTestId("upload-input");
  await input.setInputFiles(big);
  const bigRow = rows(page).filter({ hasText: "big.png" });
  await expect(bigRow).toHaveAttribute("data-status", "skipped");
  await expect(bigRow).toContainText(
    "ファイルが大きすぎます：123.4 MB（117.7 MiB）。上限は 100 MB（95.4 MiB）です。",
  );

  await input.setInputFiles([
    pngHeaderOnly("wide.png", 13_000, 9_000),
    pngHeaderOnly("dense.png", 12_000, 10_000),
  ]);
  const wide = rows(page).filter({ hasText: "wide.png" });
  await expect(wide).toHaveAttribute("data-status", "skipped");
  await expect(wide).toContainText(
    "画像が大きすぎます：13,000 × 9,000 px。1 辺 12,000 px までです。",
  );
  const dense = rows(page).filter({ hasText: "dense.png" });
  await expect(dense).toHaveAttribute("data-status", "skipped");
  await expect(dense).toContainText(
    "画素数が多すぎます：120 MP。上限は 100 MP です。",
  );

  // Nothing was asked for or sent, and nothing was added.
  expect(sent).toEqual([]);
  await page.reload();
  await expect(page.getByTestId("file-tile")).toHaveCount(0);
  await expect(page.getByTestId("incomplete-uploads")).toHaveCount(0);
});

test("the server refuses an over-limit init with the same words", async ({
  page,
}) => {
  await page.goto("/media/?view=files&dir=/mock");
  const res = await page.request.post("/api/upload", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      file: "/mock/up-limits-api.png",
      size: 1234,
      contentType: "image/png",
      sha256: "1".repeat(64),
      timestamp: null,
      width: 13_000,
      height: 9_000,
    },
  });
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({
    error: "画像が大きすぎます：13,000 × 9,000 px。1 辺 12,000 px までです。",
  });
});

test("a different photo with a taken name gets a numbered one", async ({
  page,
}) => {
  await newFolder(page, "/mock", "up-6");
  const input = page.getByTestId("upload-input");
  await input.setInputFiles([png("image.jpg.png", "k")]);
  await expect(rows(page)).toHaveAttribute("data-status", "done");
  await input.setInputFiles([png("image.jpg.png", "l")]);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(1)).toHaveAttribute("data-status", "done");
  expect(await uploadedKeys(page)).toEqual(
    expect.arrayContaining([
      "/mock/up-6/image.jpg.png",
      "/mock/up-6/image.jpg-1.png",
    ]),
  );
  await expect(page.getByTestId("file-tile")).toHaveCount(2);
});

test("a photo is not marked ready unless the bucket has it", async ({
  page,
}) => {
  await newFolder(page, "/mock", "up-7");
  // The PUT "succeeds" without reaching the bucket.
  await page.route("**/sksat-gallery/**", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*" },
        })
      : route.continue(),
  );
  await page.getByTestId("upload-input").setInputFiles([png("ghost.png", "m")]);
  const row = rows(page);
  await expect(row).toHaveAttribute("data-status", "failed");
  await expect(row).toContainText("B2 にファイルがありません");
  // Checked again on the next page view, and still missing: it stays,
  // with the reason.
  await page.reload();
  await expect(page.getByTestId("incomplete-row")).toHaveText(/ghost\.png/);
  await expect(page.getByTestId("incomplete-reason")).toHaveText(
    "B2 にファイルがありません",
  );
  await expect(page.getByTestId("file-tile")).toHaveCount(0);
});

test("a failed upload can be retried, or resumed after a reload", async ({
  page,
}) => {
  await newFolder(page, "/mock", "up-4");
  let fail = true;
  await page.route("**/sksat-gallery/**", (route) =>
    fail && route.request().method() === "PUT"
      ? route.abort("connectionreset")
      : route.continue(),
  );
  const input = page.getByTestId("upload-input");
  await input.setInputFiles([png("r.png", "f"), png("s.png", "g")]);
  // Three tries each (with backoff), then failed.
  const r = rows(page).filter({ hasText: "r.png" });
  await expect(r).toHaveAttribute("data-status", "failed", { timeout: 15_000 });
  await expect(r).toContainText("ネットワークエラー");
  await expect(
    page.getByTestId("upload-panel").getByRole("heading"),
  ).toHaveText("2 件が失敗しました", { timeout: 15_000 });

  // Retry one by hand once the network is back.
  fail = false;
  await r.getByRole("button", { name: "r.png を再試行" }).click();
  await expect(r).toHaveAttribute("data-status", "done");

  // Leave the other one: after a reload it is an incomplete upload...
  await page.reload();
  const incomplete = page.getByTestId("incomplete-uploads");
  await expect(incomplete.getByTestId("incomplete-row")).toHaveText(/s\.png/);
  await expect(incomplete.getByTestId("incomplete-reason")).toHaveText(
    "B2 にファイルがありません",
  );
  await expect(page.getByTestId("file-tile")).toHaveCount(1);

  // ...that uploading the same file again finishes.
  await page
    .getByLabel("/mock/up-4/s.png をアップロードし直す")
    .setInputFiles([png("s.png", "g")]);
  await expect(rows(page)).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("file-tile")).toHaveCount(2);
  await expect(incomplete).toHaveCount(0);
});

test("an incomplete upload can be deleted", async ({ page }) => {
  await newFolder(page, "/mock", "up-5");
  await page.route("**/sksat-gallery/**", (route) =>
    route.request().method() === "PUT"
      ? route.abort("connectionreset")
      : route.continue(),
  );
  await page.getByTestId("upload-input").setInputFiles([png("z.png", "h")]);
  await expect(rows(page)).toHaveAttribute("data-status", "failed", {
    timeout: 15_000,
  });
  await page.reload();
  const incomplete = page.getByTestId("incomplete-uploads");
  // Let the page's own re-check finish first (it disables the buttons).
  await expect(incomplete.getByTestId("incomplete-reason")).toHaveText(
    "B2 にファイルがありません",
  );
  await incomplete
    .getByRole("button", {
      name: "/mock/up-5/z.png の未完了のアップロードを削除",
    })
    .click();
  await expect(incomplete).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "This folder is empty" }),
  ).toBeVisible();
});

/** Upload `name` while every completion call fails (the PUT succeeds). */
const uploadWithFailingCheck = async (
  page: Page,
  folder: string,
  name: string,
  seed: string,
) => {
  await newFolder(page, "/mock", folder);
  await page.route(/\/api\/upload\/\d+$/, (route) => route.abort("failed"));
  await page.getByTestId("upload-input").setInputFiles([png(name, seed)]);
  await expect(
    page.getByTestId("upload-panel").getByRole("heading"),
  ).toHaveText("1 件が失敗しました", { timeout: 15_000 });
  await page.unroute(/\/api\/upload\/\d+$/);
};

const putCount = async (page: Page, key: string) =>
  (await uploadedKeys(page)).filter((k) => k === key).length;

// Regressions for production: the PUT went through but the completion
// check failed (the image Worker's stat hung). The row must become a photo
// on its own, without uploading again.
test("a stored upload whose check failed completes on the next page load", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await uploadWithFailingCheck(page, "up-check", "c.png", "q");
  await page.reload();
  await expect(page.getByTestId("file-tile")).toHaveCount(1);
  await expect(page.getByTestId("incomplete-uploads")).toHaveCount(0);
  expect(await putCount(page, "/mock/up-check/c.png")).toBe(1);
  expect(errors).toEqual([]);
});

test("閉じる after a failure clears the panel and completes stored files", async ({
  page,
}) => {
  await uploadWithFailingCheck(page, "up-close", "d.png", "r");
  const panel = page.getByTestId("upload-panel");
  await panel.getByRole("button", { name: "閉じる" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("file-tile")).toHaveCount(1);
  await expect(page.getByTestId("incomplete-uploads")).toHaveCount(0);
  expect(await putCount(page, "/mock/up-close/d.png")).toBe(1);
});

/** A tiny synthetic image from src/lib/fixtures (Pillow, no real photo). */
const fixture = (name: string, mimeType: string) => ({
  name,
  mimeType,
  buffer: readFileSync(new URL(`../src/lib/fixtures/${name}`, import.meta.url)),
});

test("the file's EXIF and VRChat world fill the shooting data, editable", async ({
  page,
}) => {
  await newFolder(page, "/mock", "up-meta");
  await page
    .getByTestId("upload-input")
    .setInputFiles([
      fixture("exif-gps.jpg", "image/jpeg"),
      fixture("vrchat-xmp.png", "image/png"),
    ]);
  await expect(page.getByTestId("file-tile")).toHaveCount(2);

  await page
    .getByTestId("file-tile")
    .filter({ hasText: "exif-gps.jpg" })
    .click();
  const data = page.getByTestId("photo-data");
  await expect(data.getByTestId("exif-gear")).toHaveText(
    "FUJIFILM X-T5 · XF35mmF1.4 R",
  );
  await expect(data.getByTestId("exif-exposure")).toHaveText(
    "35mm · f/2.8 · 1/250 秒 · ISO 400",
  );
  await expect(data.getByTestId("location-link")).toHaveText(
    "35.6587083, 139.7447",
  );
  await expect(data.getByTestId("location-source")).toHaveText("EXIF");
  // The taken-at time came from DateTimeOriginal.
  await expect(page.locator("main")).toContainText("2023/12/11 01:21");
  // The camera its EXIF names got a row of its own and is set.
  await expect(page.locator("#edit-camera option:checked")).toHaveText("X-T5");
  // Public at a glance: location is hidden by default, exif shown.
  await expect(data.getByTestId("public-location")).toHaveAttribute(
    "data-public",
    "false",
  );
  await expect(data.getByTestId("public-exif")).toHaveAttribute(
    "data-public",
    "true",
  );

  // Edit the position by hand and publish it at city level.
  await data.getByTestId("edit-location").locator("summary").click();
  await page.getByLabel("緯度").fill("35.7");
  await data.getByTestId("metadata-location").selectOption("city");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();
  await page.reload();
  await expect(data.getByTestId("location-link")).toHaveText("35.7, 139.7447");
  await expect(data.getByTestId("manual-location")).toContainText("手入力");
  await expect(data.getByTestId("public-location")).toHaveAttribute(
    "data-public",
    "true",
  );
  // Back to the file's position: the reader reads it again on its own.
  await data.getByRole("button", { name: "ファイルの値に戻す" }).click();
  await expect(page.getByText(/ファイルの値に戻します/)).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(data.getByTestId("location-link")).toHaveText(
      "35.6587083, 139.7447",
      { timeout: 1000 },
    );
  }).toPass({ timeout: 20_000 });
  await expect(data.getByTestId("manual-location")).toHaveCount(0);

  await page.goto("/media/?view=files&dir=/mock/up-meta");
  await page
    .getByTestId("file-tile")
    .filter({ hasText: "vrchat-xmp.png" })
    .click();
  const world = page.getByTestId("world-link");
  await expect(world).toHaveText("The Black Cat & Friends");
  await expect(world).toHaveAttribute(
    "href",
    "https://vrchat.com/home/world/wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b",
  );
  // Saving without touching the shooting data keeps it as read.
  await page.getByLabel("Tags (comma-separated)").fill("cat");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("world-link")).toHaveText(
    "The Black Cat & Friends",
  );
});

test("a scanner's file: スキャン日時, its device, the taken-at by hand, no EXIF", async ({
  page,
}) => {
  await newFolder(page, "/mock", "up-scan");
  const scan = fixture("gcmc-scan.jpg", "image/jpeg");
  await page.getByTestId("upload-input").setInputFiles([
    scan,
    // Another scan from the same scanner (other bytes after the image).
    {
      ...scan,
      name: "gcmc-scan-2.jpg",
      buffer: Buffer.concat([scan.buffer, Buffer.from([0])]),
    },
  ]);
  await expect(page.getByTestId("file-tile")).toHaveCount(2);
  await page
    .getByTestId("file-tile")
    .filter({ hasText: "gcmc-scan.jpg" })
    .click();

  // A GCMC Scanner with an unset clock: 2021-01-01 is when it was scanned,
  // not a taken-at, and its EXIF is not the shooting data.
  await expect(page.getByTestId("digitized-at")).toContainText("2021/01/01");
  await expect(page.locator("#edit-taken-at")).toHaveValue("");
  await expect(page.getByTestId("exif-gear")).toHaveCount(0);
  await page.getByTestId("file-exif").locator("summary").click();
  await expect(page.getByTestId("file-exif")).toContainText("GCMC");

  // No camera row named it: the upload created one (a scanner) and set it,
  // and no shooting camera.
  const device = page.locator("#edit-digitizer");
  await expect(device.locator("option:checked")).toHaveText("Scanner");
  await expect(page.locator("#edit-camera option:checked")).toHaveText(
    "(none)",
  );

  // The taken-at from the folder, and no EXIF in its served images.
  await page.locator("#edit-taken-at").fill("2024-02-01T00:00");
  await page.locator("#edit-embed-exif").selectOption("off");
  // The scan's levels beside the scan's fields.
  await page.getByTestId("metadata-digitized_at").selectOption("month");
  await page.getByTestId("metadata-digitizer").selectOption("model");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();
  await page.reload();
  await expect(page.locator("#edit-taken-at")).toHaveValue("2024-02-01T00:00");
  await expect(page.locator("#media-meta")).toContainText("2024/02/01");
  await expect(page.locator("#edit-embed-exif")).toHaveValue("off");
  await expect(page.getByTestId("metadata-digitized_at")).toHaveValue("month");
  await expect(page.getByTestId("metadata-digitizer")).toHaveValue("model");

  // The device is one camera row, shared by both scans, counted apart.
  await page.goto("/camera/");
  const scanner = page.locator("li").filter({ hasText: "Scanner" });
  await expect(scanner).toHaveCount(1);
  await expect(scanner.getByTestId("camera-digitized-count")).toHaveText(
    "スキャン 2",
  );
});

test("photos uploaded unread are read in the background, quietly", async ({
  page,
}) => {
  await newFolder(page, "/mock", "up-unread");
  // An old tab: the upload carries no metadata, so the photos stay unread.
  await page.route("**/api/upload", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    delete body.meta;
    delete body.timestamp;
    delete body.timestampSource;
    await route.continue({ postData: JSON.stringify(body) });
  });
  const VR = "VRChat_2026-11-02_11-31-36.000_8x8.png";
  await page
    .getByTestId("upload-input")
    .setInputFiles([
      { ...fixture("vrchat-2026.png", "image/png"), name: VR },
      fixture("lab-scan.jpg", "image/jpeg"),
    ]);
  await expect(page.getByTestId("file-tile")).toHaveCount(2);
  await page.unroute("**/api/upload");

  // Any admin page reads them once the browser is idle.
  await page.goto("/");
  await expect(async () => {
    await page.goto("/media/?view=files&dir=/mock/up-unread");
    await page.getByTestId("file-tile").filter({ hasText: VR }).click();
    await expect(page.getByTestId("world-link")).toHaveText(
      "桜の川 （Sakura）",
      { timeout: 1000 },
    );
  }).toPass({ timeout: 30_000 });
  // The XMP CreateDate, to the millisecond, over the file name.
  await expect(page.locator("main")).toContainText("2026/11/02 11:31");

  // Digitised on a lab's scanner: its EXIF is the file's, not the shot's,
  // and its date the スキャン日時, not a taken-at.
  await page.goto("/media/?view=files&dir=/mock/up-unread");
  await page
    .getByTestId("file-tile")
    .filter({ hasText: "lab-scan.jpg" })
    .click();
  // Its scanner got a camera row of its own, set as the スキャン機材.
  await expect(page.locator("#edit-digitizer option:checked")).toHaveText(
    "SP-2000",
  );
  await expect(page.getByTestId("exif-gear")).toHaveCount(0);
  await expect(page.getByTestId("digitized-at")).toContainText("2023/12/12");
  await expect(page.locator("#media-meta")).not.toContainText("2023/12/12");
  await expect(page.locator("#edit-taken-at")).toHaveValue("");

  // Nothing left to read: no indicator at all.
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("metadata-reader")).toBeEmpty();
});

test("upload a folder: its subfolders are created under the open one", async ({
  page,
}) => {
  const root = mkdtempSync(join(tmpdir(), "admin-upload-"));
  const trip = join(root, "Trip 1");
  mkdirSync(join(trip, "day1"), { recursive: true });
  writeFileSync(join(trip, "b.jpg"), jpeg("b.jpg", "n").buffer);
  writeFileSync(join(trip, "day1", "a.png"), png("a.png", "o").buffer);
  writeFileSync(join(trip, ".DS_Store"), "x");
  writeFileSync(join(trip, "notes.txt"), "hello");

  await newFolder(page, "/mock", "up-dir");
  await expect(page.getByTestId("upload-folder")).toBeVisible();
  await page.getByTestId("upload-folder-input").setInputFiles(trip);

  const panel = page.getByTestId("upload-panel");
  // The hidden file is left out; the text file is skipped.
  await expect(rows(page)).toHaveCount(3);
  await expect(panel.getByRole("heading")).toHaveText(
    "2 件アップロードしました",
  );
  await expect(rows(page).filter({ hasText: "notes.txt" })).toHaveAttribute(
    "data-status",
    "skipped",
  );
  expect(await uploadedKeys(page)).toEqual(
    expect.arrayContaining([
      "/mock/up-dir/Trip_1/b.jpg",
      "/mock/up-dir/Trip_1/day1/a.png",
    ]),
  );
  // The new folders are in the tree.
  await expect(page.getByTestId("folder-tile")).toHaveText(
    /Trip_1.*0 \/ 2 公開/,
  );
});

// The drop tests also run in Firefox (the `firefox` project, after the
// rest): their folders and file contents differ per browser, so the
// second run neither finds the folders taken nor its files already
// uploaded.
const browserSuffix = () => {
  const name = test.info().project.name;
  return name === "e2e" ? "" : `-${name}`;
};
const seedOf = (n: number) =>
  test.info().project.name === "e2e" ? n : n + 100;

test("drop files on the Files view to upload them", async ({ page }) => {
  const dir = `/mock/up-drop${browserSuffix()}`;
  await newFolder(page, "/mock", `up-drop${browserSuffix()}`);
  const zone = page.getByTestId("drop-zone");
  const dt = await pngTransfer(page, "dropped.png", seedOf(7));
  await zone.dispatchEvent("dragenter", { dataTransfer: dt });
  await expect(zone).toContainText(`ここにドロップして ${dir} にアップロード`);
  await zone.dispatchEvent("dragover", { dataTransfer: dt });
  await zone.dispatchEvent("drop", { dataTransfer: dt });
  await expect(rows(page)).toHaveAttribute("data-status", "done");
  await expect(zone).not.toContainText("ここにドロップして");
  expect(await uploadedKeys(page)).toContain(`${dir}/dropped.png`);
  await expect(page.getByTestId("file-tile")).toHaveCount(1);
});

/** A DataTransfer holding one small PNG, as the OS hands it over. */
const pngTransfer = (page: Page, name: string, seed: number) =>
  page.evaluateHandle(
    ([name, seed]) => {
      const d = new DataTransfer();
      const bytes = new Uint8Array(2048).fill(seed);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      d.items.add(new File([bytes], name, { type: "image/png" }));
      return d;
    },
    [name, seed] as const,
  );

test("drop files whose drag does not list Files until the drop", async ({
  page,
}) => {
  // Firefox, depending on the platform and the file manager, may list only
  // a URI list (or nothing) while dragging, and hand over the files at the
  // drop. The drag over an empty folder must still be accepted.
  const dir = `/mock/up-late${browserSuffix()}`;
  await newFolder(page, "/mock", `up-late${browserSuffix()}`);
  await expect(page.getByText("This folder is empty")).toBeVisible();
  const zone = page.getByTestId("drop-zone");
  const dragging = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.setData("text/uri-list", "file:///home/me/late.png");
    return d;
  });
  const empty = page.getByText("This folder is empty");
  await empty.dispatchEvent("dragenter", { dataTransfer: dragging });
  await expect(zone).toContainText(`ここにドロップして ${dir} にアップロード`);
  const accepted = await empty.evaluate((el, d) => {
    const e = new DragEvent("dragover", {
      dataTransfer: d,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  }, dragging);
  expect(accepted).toBe(true);
  const dropped = await pngTransfer(page, "late.png", seedOf(21));
  await empty.dispatchEvent("drop", { dataTransfer: dropped });
  await expect(rows(page)).toHaveAttribute("data-status", "done");
  expect(await uploadedKeys(page)).toContain(`${dir}/late.png`);
  await page.getByRole("button", { name: "閉じる" }).click();

  // Text alone: nothing to upload, and the toast says so.
  const text = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.setData("text/plain", "hello");
    return d;
  });
  await zone.dispatchEvent("dragenter", { dataTransfer: text });
  await zone.dispatchEvent("dragover", { dataTransfer: text });
  await zone.dispatchEvent("drop", { dataTransfer: text });
  await expect(
    page.getByText("ドロップされたものにファイルがありませんでした"),
  ).toBeVisible();
  await expect(zone).not.toContainText("ここにドロップして");
  await expect(rows(page)).toHaveCount(0);
});

test("drop files on a folder to upload them into it", async ({ page }) => {
  const parent = `/mock/up-target${browserSuffix()}`;
  await newFolder(page, "/mock", `up-target${browserSuffix()}`);
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("sub");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(new RegExp(`dir=${parent}/sub$`));
  await page.goBack();
  const zone = page.getByTestId("drop-zone");
  const sub = page.getByTestId("folder-tile").filter({ hasText: "sub" });
  await expect(sub).toHaveCount(1);

  // On a folder tile: marked like a move's target, no overlay, and the
  // file goes into that folder.
  const dt1 = await pngTransfer(page, "on-tile.png", seedOf(11));
  await zone.dispatchEvent("dragenter", { dataTransfer: dt1 });
  await expect(zone).toContainText("ここにドロップして");
  await sub.dispatchEvent("dragenter", { dataTransfer: dt1 });
  await sub.dispatchEvent("dragover", { dataTransfer: dt1 });
  await expect(sub).toHaveAttribute("data-drop-over", "");
  await expect(zone).not.toContainText("ここにドロップして");
  await sub.dispatchEvent("drop", { dataTransfer: dt1 });
  await expect(sub).not.toHaveAttribute("data-drop-over");
  await expect(rows(page)).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("upload-dest")).toHaveText(`${parent}/sub へ`);
  expect(await uploadedKeys(page)).toContain(`${parent}/sub/on-tile.png`);
  await expect(page.getByTestId("file-tile")).toHaveCount(0);
  await page.getByRole("button", { name: "閉じる" }).click();

  // On a folder in the tree.
  const tree = page.getByRole("navigation", { name: "Folders" });
  const treeSub = tree.locator(`[data-drop="${parent}/sub"]`);
  const dt2 = await pngTransfer(page, "on-tree.png", seedOf(12));
  await treeSub.dispatchEvent("dragenter", { dataTransfer: dt2 });
  await treeSub.dispatchEvent("dragover", { dataTransfer: dt2 });
  await expect(treeSub).toHaveAttribute("data-drop-over", "");
  await treeSub.dispatchEvent("drop", { dataTransfer: dt2 });
  await expect(treeSub).not.toHaveAttribute("data-drop-over");
  await expect(rows(page)).toHaveAttribute("data-status", "done");
  expect(await uploadedKeys(page)).toContain(`${parent}/sub/on-tree.png`);
  await page.getByRole("button", { name: "閉じる" }).click();

  // Anywhere else: the open folder.
  const dt3 = await pngTransfer(page, "on-space.png", seedOf(13));
  await zone.dispatchEvent("dragenter", { dataTransfer: dt3 });
  await expect(zone).toContainText(
    `ここにドロップして ${parent} にアップロード`,
  );
  await zone.dispatchEvent("dragover", { dataTransfer: dt3 });
  await zone.dispatchEvent("drop", { dataTransfer: dt3 });
  await expect(rows(page)).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("upload-dest")).toHaveText(`${parent} へ`);
  expect(await uploadedKeys(page)).toContain(`${parent}/on-space.png`);
  await expect(page.getByTestId("file-tile")).toHaveCount(1);
  await page.getByRole("button", { name: "閉じる" }).click();
  await expect(rows(page)).toHaveCount(0);

  // A drag within the page still moves, and uploads nothing. (Playwright's
  // drags in Firefox are dispatched from script, so Qwik's sync$ handlers,
  // which qwikloader runs after a microtask, accept them too late: the
  // move itself is checked in Chromium only.)
  const before = (await uploadedKeys(page)).length;
  await page
    .getByTestId("file-tile")
    .filter({ hasText: "on-space.png" })
    .dragTo(sub);
  if (test.info().project.name !== "firefox") {
    await expect(
      page.getByText(`1 件を ${parent}/sub に移動しました。`),
    ).toBeVisible();
    await expect(page.getByTestId("file-tile")).toHaveCount(0);
  }
  await expect(page.getByTestId("upload-panel")).toHaveCount(0);
  expect(await uploadedKeys(page)).toHaveLength(before);

  // After that move, a drop from outside is still an upload: on a
  // breadcrumb, from inside the subfolder.
  await page.goto(`/media/?view=files&dir=${parent}/sub`);
  const crumb = page
    .getByRole("navigation", { name: "Folder path" })
    .locator(`[data-drop="${parent}"]`);
  const dt4 = await pngTransfer(page, "on-crumb.png", seedOf(14));
  // The zone listens once it is visible, a moment after the load.
  await expect(async () => {
    await crumb.dispatchEvent("dragenter", { dataTransfer: dt4 });
    await crumb.dispatchEvent("dragover", { dataTransfer: dt4 });
    await expect(crumb).toHaveAttribute("data-drop-over", "", {
      timeout: 500,
    });
  }).toPass();
  await crumb.dispatchEvent("drop", { dataTransfer: dt4 });
  await expect(rows(page)).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("upload-dest")).toHaveText(`${parent} へ`);
  expect(await uploadedKeys(page)).toContain(`${parent}/on-crumb.png`);
});

test.describe("on an iPhone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });

  test("there is no folder upload (Safari cannot pick folders)", async ({
    page,
  }) => {
    await page.goto("/media/?view=files&dir=/mock");
    await expect(page.locator("label", { hasText: /^Upload$/ })).toBeVisible();
    // The support check has run, and left it hidden.
    const folder = page.getByTestId("upload-folder");
    await expect(folder).toHaveAttribute("data-checked", "");
    await expect(folder).toBeHidden();
  });
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("upload photos", async ({ page }) => {
    await newFolder(page, "/mock", "up-phone");
    for (const button of [
      page.locator("label", { hasText: /^Upload$/ }),
      // Android: folders can be picked too.
      page.getByTestId("upload-folder"),
    ]) {
      await expect(button).toBeVisible();
      expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await page
      .getByTestId("upload-input")
      .setInputFiles([png("p1.png", "i"), png("p2.png", "j")]);
    await expect(
      page.getByTestId("upload-panel").getByRole("heading"),
    ).toHaveText("2 件アップロードしました");
    await expect(page.getByTestId("file-tile")).toHaveCount(2);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
