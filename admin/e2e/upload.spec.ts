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

  // Private, with the time from the VRChat file name and the world.
  await tiles.filter({ hasText: VRCHAT }).click();
  await expect(page.locator("main")).toContainText("Private");
  await expect(page.locator("main")).toContainText("2026/11/18 01:02");
  await expect(page.locator('select[name="world"]')).toHaveValue("VRChat");
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
  await expect(row).toContainText("バケットにファイルがありません");
  await page.reload();
  await expect(page.getByTestId("file-tile")).toHaveCount(0);
  await expect(page.getByTestId("incomplete-row")).toHaveText(/ghost\.png/);
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
  await expect(page.getByTestId("file-tile")).toHaveCount(1);

  // ...that picking the same file again finishes.
  await page.getByTestId("upload-input").setInputFiles([png("s.png", "g")]);
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

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("upload photos", async ({ page }) => {
    await newFolder(page, "/mock", "up-phone");
    const button = page.locator("label", { hasText: "Upload" });
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
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
