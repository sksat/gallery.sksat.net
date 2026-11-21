import { test, expect, type Page } from "@playwright/test";

import { imagesSettled } from "./images";

// The map's own drawing (the WebGL canvas: the stub style's background and
// the areas, which GPUs antialias differently) is hidden, not masked: a mask
// would cover the DOM markers and popup above it, which are what is compared
// here along with the page and the list. The style has no tiles.
const HIDE_CANVAS = ".maplibregl-canvas { visibility: hidden; }";

const ready = async (page: Page) => {
  await expect(page.getByTestId("photo-map")).toHaveAttribute(
    "data-ready",
    "",
    { timeout: 20_000 },
  );
  await expect(page.getByTestId("map-marker")).toHaveCount(2);
  await imagesSettled(page, "main img");
};

for (const [label, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`map (${label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/map/");
    await ready(page);
    await page.addStyleTag({ content: HIDE_CANVAS });
    await expect(page).toHaveScreenshot(`map-${label}.png`, {
      fullPage: true,
    });
  });
}

test("map with a photo's popup", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/map/?photo=reaxxxxxxa");
  await ready(page);
  await expect(page.getByTestId("map-popup")).toBeVisible();
  await page.addStyleTag({ content: HIDE_CANVAS });
  await expect(page).toHaveScreenshot("map-popup.png");
});
