import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { dropZoneOf } from "./files-helpers";

// Resized copies made in the browser, the alternative to the image
// Worker's Image Transformations (src/lib/resized.ts,
// src/components/resize-maker.tsx; the E2E fixture sets /setting/'s
// 縮小版の作成 to the browser, as the E2E server has no image Worker) and
// stored in the local R2 bucket (MEDIA_CACHE, kept on disk by wrangler
// pages dev): for a photo just
// uploaded, from the file in hand, and by the background maker for a
// photo waiting, from its file in the fake bucket (e2e/fake-b2.mjs
// /__object). The /thumb route serves them from the bucket (the E2E
// server has no image Worker, so a thumbnail there is a stored copy or
// 404).

const port = Number(process.env.ADMIN_E2E_PORT) || 5175;
const fakeB2 = `http://127.0.0.1:${port + 2}`;

/** A real 2000x1000 PNG (a gradient), drawn by the browser. */
const drawnPng = async (page: Page, w: number, h: number) => {
  const base64 = await page.evaluate(
    async ([w, h]) => {
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext("2d")!;
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#1d4ed8");
      g.addColorStop(1, "#f59e0b");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const blob = await c.convertToBlob({ type: "image/png" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    },
    [w, h],
  );
  return Buffer.from(base64, "base64");
};

/** The thumbnail /thumb serves: its type and decoded size. */
const thumb = (page: Page, preset: string, file: string) =>
  page.evaluate(
    async ([preset, file]) => {
      // Not from the browser's cache (the route allows an hour).
      const res = await fetch(`/thumb/${preset}${file}`, { cache: "no-store" });
      if (!res.ok) return { status: res.status };
      const blob = await res.blob();
      const image = await createImageBitmap(blob);
      return {
        status: res.status,
        type: blob.type,
        cache: res.headers.get("cache-control"),
        width: image.width,
        height: image.height,
      };
    },
    [preset, file],
  );

test("the site says which maker makes the copies", async ({ page }) => {
  await page.goto("/setting/");
  const select = page.getByLabel("縮小版の作成");
  await expect(select).toHaveValue("browser");
  await expect(select.locator("option")).toHaveText([
    "Cloudflare で作る",
    "管理画面のブラウザで作る",
  ]);
});

test("an upload gets its resized copies from the file in hand", async ({
  page,
}) => {
  await page.goto("/media/?view=files&dir=/mock");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("resized");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/dir=\/mock\/resized$/);
  await dropZoneOf(page, "/mock/resized");
  const sources: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/source")) sources.push(r.url());
  });
  await page.getByTestId("upload-input").setInputFiles([
    {
      name: "wide.png",
      mimeType: "image/png",
      buffer: await drawnPng(page, 2000, 1000),
    },
  ]);
  await expect(
    page.getByTestId("upload-panel").getByRole("heading"),
  ).toHaveText("1 件アップロードしました");

  const file = "/mock/resized/wide.png";
  await expect
    .poll(async () => (await thumb(page, "w3840", file)).status, {
      timeout: 15_000,
    })
    .toBe(200);
  // Scaled down to each box, never up; WebP; private to this browser.
  expect(await thumb(page, "h240", file)).toEqual({
    status: 200,
    type: "image/webp",
    cache: "private, max-age=3600",
    width: 480,
    height: 240,
  });
  expect(await thumb(page, "w1920", file)).toMatchObject({
    width: 1920,
    height: 960,
  });
  // Larger boxes give the photo at its own size (stored once).
  for (const preset of ["w2560", "w3840"]) {
    expect(await thumb(page, preset, file)).toMatchObject({
      type: "image/webp",
      width: 2000,
      height: 1000,
    });
  }
  // The social cards: JPEG, 1200x630.
  for (const preset of ["og-site", "og"]) {
    expect(await thumb(page, preset, file)).toMatchObject({
      type: "image/jpeg",
      width: 1200,
      height: 630,
    });
  }
  // Nothing was downloaded: the copies came from the uploaded file.
  expect(sources).toEqual([]);
  // The header's indicator is gone once it is done.
  await expect(page.getByTestId("resize-maker")).toBeEmpty();
});

test("an og card the image Worker asks for is drawn again with its caption", async ({
  browser,
  baseURL,
}) => {
  const file = "/mock/resized/wide.png";
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/media/?view=files&dir=/mock/resized");
  const bytes = () =>
    page.evaluate(
      async (f) =>
        Array.from(
          new Uint8Array(
            await (
              await fetch(`/thumb/og${f}`, { cache: "no-store" })
            ).arrayBuffer(),
          ),
        ).join(","),
      file,
    );
  const before = await bytes();
  const id = await page
    .getByTestId("file-tile")
    .filter({ hasText: "wide.png" })
    .first()
    .getAttribute("data-media-id");
  expect(id).toMatch(/^\d+$/);
  // The photo's caption changes, and the Worker asks for the card again.
  await page.request.put(`${fakeB2}/__caption`, {
    data: JSON.stringify({ primary: "2026-11-21", secondary: "#changed" }),
  });
  try {
    const asked = await page.request.post(
      `${baseURL}/e2e/resized/?id=${id}&card=1`,
      { headers: { origin: baseURL! } },
    );
    expect(asked.ok()).toBe(true);
    // A new tab: the maker looks for waiting work again.
    const fresh = await (await browser.newContext()).newPage();
    await fresh.goto("/media/");
    await expect
      .poll(async () => (await bytes()) !== before, { timeout: 15_000 })
      .toBe(true);
    expect(await thumb(page, "og", file)).toMatchObject({
      type: "image/jpeg",
      width: 1200,
      height: 630,
    });
  } finally {
    await page.request.put(`${fakeB2}/__caption`, {
      data: JSON.stringify({
        primary: "2023-12-02 09:00 JST",
        secondary: "logilabo VirtualLens2 · #VRChat",
      }),
    });
    await context.close();
  }
});

test.describe("a photo waiting for its copies", () => {
  // Fixture photo 2 (/mock/vrchat1.png) gets a real file in the fake
  // bucket while this runs, and loses it after.
  const key = "/mock/vrchat1.png";
  const seed = `${fakeB2}/__seed?key=${encodeURIComponent(key)}`;
  test.beforeEach(async ({ request }) => {
    const res = await request.put(seed, {
      data: readFileSync(
        new URL("../src/lib/fixtures/vrchat-2026.png", import.meta.url),
      ),
    });
    expect(res.ok()).toBe(true);
  });
  test.afterEach(async ({ request }) => {
    await request.delete(seed);
  });

  test("is filled by the background maker from its file", async ({
    page,
    baseURL,
  }) => {
    // Before any page is open: every admin page runs the maker, and one
    // opened before the reset would find nothing waiting and remember that
    // for the tab (or claim the photo itself, before `sources` listens).
    const reset = await page.request.post(`${baseURL}/e2e/resized/?id=2`, {
      headers: { origin: baseURL! },
    });
    expect(reset.ok()).toBe(true);
    expect((await page.request.get(`/thumb/h240${key}`)).status()).toBe(404);
    const sources: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/source")) sources.push(r.url());
    });
    // Any page: the maker runs once the browser is idle.
    await page.goto("/media/");
    await expect
      .poll(async () => (await thumb(page, "h240", key)).status, {
        timeout: 15_000,
      })
      .toBe(200);
    expect(sources).toHaveLength(1);
    // The fixture is 8x8: one image, every preset at that size.
    for (const preset of ["h240", "w3840"]) {
      expect(await thumb(page, preset, key)).toMatchObject({
        type: "image/webp",
        width: 8,
        height: 8,
      });
    }
  });

  test("the file route answers only the claim's browser", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");
    const res = await page.request.get(
      `${baseURL}/api/resized/2/source?claim=making:2000-01-01T00:00:00.000Z`,
    );
    expect(res.status()).toBe(404);
    expect(res.headers()["cache-control"]).toBe("private, no-store");
  });
});
