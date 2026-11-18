import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  await expect(data.getByTestId("location-source")).toHaveText("手入力");
  await expect(data.getByTestId("public-location")).toHaveAttribute(
    "data-public",
    "true",
  );

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

test("drop files on the Files view to upload them", async ({ page }) => {
  await newFolder(page, "/mock", "up-drop");
  const zone = page.getByTestId("drop-zone");
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    const bytes = new Uint8Array(2048).fill(7);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    d.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    return d;
  });
  await zone.dispatchEvent("dragenter", { dataTransfer: dt });
  await expect(zone).toContainText(
    "ここにドロップして /mock/up-drop にアップロード",
  );
  await zone.dispatchEvent("dragover", { dataTransfer: dt });
  await zone.dispatchEvent("drop", { dataTransfer: dt });
  await expect(rows(page)).toHaveAttribute("data-status", "done");
  await expect(zone).not.toContainText("ここにドロップして");
  expect(await uploadedKeys(page)).toContain("/mock/up-drop/dropped.png");
  await expect(page.getByTestId("file-tile")).toHaveCount(1);
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
