import { expect, test } from "@playwright/test";
import { hideMapCanvas, mapLoaded, stubMaps } from "../map-helpers";

for (const [label, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`admin: map (${label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await stubMaps(page);
    await page.goto("/map/");
    await mapLoaded(page.getByTestId("admin-map"));
    await expect(page.getByTestId("map-marker")).toHaveCount(2);
    await hideMapCanvas(page);
    await expect(page).toHaveScreenshot(`admin-map-${label}.png`, {
      fullPage: true,
    });
  });
}
