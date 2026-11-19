import { test, expect, type Page } from "@playwright/test";

// The grid keeps each photo's aspect ratio (src/components/gallery/tile.ts):
// a portrait photo is laid out tall, not cropped to a short wide tile.
// Fixture sizes (e2e/fixture.sql): reaxxxxxxa 60 × 80 (3:4), vrcxxxxxxa and
// vrcxxxxxxb 16:9 from the API; vrcxxxxxxc (64 × 36) and reaxxxxxxb (grey
// 1 × 1 stand-in) without a size, so they take the loaded image's shape.

/** Width / height of a photo's tile as rendered. */
const tileAspect = (page: Page, id: string) =>
  page
    .locator(`[data-testid=gallery-tile][data-photo-id=${id}]`)
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.width / r.height;
    });

const expectAspect = async (page: Page, id: string, want: number) => {
  // Within 3 %: rounding to whole pixels on small tiles.
  await expect
    .poll(async () => Math.abs((await tileAspect(page, id)) / want - 1), {
      message: `${id} at ${want.toFixed(3)}`,
    })
    .toBeLessThan(0.03);
};

for (const [name, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test.describe(name, () => {
    test.use({ viewport });

    test("lays every photo out at its own aspect ratio", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByTestId("gallery-tile")).toHaveCount(6, {
        timeout: 10000,
      });
      // Sizes from the API, before or after the images load.
      await expectAspect(page, "reaxxxxxxa", 60 / 80);
      await expectAspect(page, "vrcxxxxxxa", 16 / 9);
      await expectAspect(page, "vrcxxxxxxb", 16 / 9);
      // Unknown sizes: the image's own once it has loaded.
      await expectAspect(page, "vrcxxxxxxc", 64 / 36);
      await expectAspect(page, "reaxxxxxxb", 1);
      // The video (320 × 180), whose image here is a 1 × 1 stand-in.
      await expectAspect(page, "vdxxxxxxxa", 320 / 180);
    });

    test("never crops an image: it fills its tile at its own shape", async ({
      page,
    }) => {
      await page.goto("/");
      const images = page.getByTestId("gallery-image");
      await expect(images).toHaveCount(6, { timeout: 10000 });
      await expect
        .poll(() =>
          images.evaluateAll((imgs) =>
            (imgs as HTMLImageElement[]).every(
              (i) => i.complete && i.naturalWidth > 0,
            ),
          ),
        )
        .toBe(true);
      // The largest mismatch between a drawn image and its own shape (the
      // tiles of unknown size take theirs right after loading).
      await expect
        .poll(() =>
          images.evaluateAll((imgs) =>
            Math.max(
              // Not the video's: its poster is a 1 × 1 stand-in in tests.
              ...(imgs as HTMLImageElement[])
                .filter((i) => !i.closest("[data-photo-id=vdxxxxxxxa]"))
                .map((i) => {
                const r = i.getBoundingClientRect();
                return Math.abs(
                  r.width / r.height / (i.naturalWidth / i.naturalHeight) - 1,
                );
              }),
            ),
          ),
        )
        .toBeLessThan(0.03);
    });

    test("keeps the tiles of a row at one height", async ({ page }) => {
      await page.goto("/");
      const tiles = page.getByTestId("gallery-tile");
      await expect(tiles).toHaveCount(6, { timeout: 10000 });
      await expectAspect(page, "vrcxxxxxxc", 64 / 36);
      const rects = await tiles.evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { top: Math.round(r.top), height: r.height };
        }),
      );
      const rows = new Map<number, number[]>();
      for (const r of rects) rows.set(r.top, [...(rows.get(r.top) ?? []), r.height]);
      for (const heights of rows.values()) {
        for (const h of heights) expect(Math.abs(h - heights[0])).toBeLessThan(2);
      }
      // The last row is not stretched: it stays at the row height.
      const rowHeight = await page
        .getByTestId("gallery-grid")
        .evaluate((g) => {
          const probe = document.createElement("div");
          probe.style.height = "var(--row-h)";
          g.append(probe);
          const h = probe.getBoundingClientRect().height;
          probe.remove();
          return h;
        });
      const last = [...rows.entries()].sort(([a], [b]) => b - a)[0][1];
      expect(Math.abs(last[0] - rowHeight)).toBeLessThan(2);
    });
  });
}
