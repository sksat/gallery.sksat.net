import { expect, type Page } from "@playwright/test";

/**
 * Wait until the page's pictures are on screen as they will stay: every
 * image matching `selector` has loaded (lazy ones below the fold never
 * start, so leave them out of the selector; callers check how many there
 * are first), and every grid tile of a photo whose size the API does not
 * give (`data-unsized`) has loaded and taken its image's shape. Such a tile is 3:2 until its load handler, which runs
 * after the image is `complete`, sets `--ar` (src/components/gallery/
 * tile.ts), so `complete` alone lets a screenshot catch the 3:2 tile.
 */
export const imagesSettled = (page: Page, selector: string) =>
  expect
    .poll(
      () =>
        page.evaluate((selector) => {
          const imgs = Array.from(
            document.querySelectorAll<HTMLImageElement>(selector),
          );
          if (!imgs.every((i) => i.complete && i.naturalWidth > 0)) {
            return "loading";
          }
          for (const img of document.querySelectorAll<HTMLImageElement>(
            "[data-testid=gallery-tile] img[data-unsized]",
          )) {
            if (!img.complete || img.naturalWidth === 0) {
              return `tile ${img.dataset.unsized} loading`;
            }
            // As tileStyle writes it.
            const ar = String(
              Math.round((img.naturalWidth / img.naturalHeight) * 1e4) / 1e4,
            );
            const tile = img.closest<HTMLElement>("[data-testid=gallery-tile]");
            if (tile?.style.getPropertyValue("--ar") !== ar) {
              return `tile ${img.dataset.unsized} not ${ar} yet`;
            }
          }
          return "settled";
        }, selector),
      { timeout: 10_000 },
    )
    .toBe("settled");
