import { expect, type Locator, type Page } from "@playwright/test";

// The admin's maps in tests: the OpenFreeMap styles are answered here with
// a plain background (no tiles), and any other request that leaves the
// test servers is refused and recorded.

const STYLE = JSON.stringify({
  version: 8,
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#ddd" } },
  ],
});

/** Stub the map styles; returns the external requests that were refused. */
export const stubMaps = async (page: Page): Promise<string[]> => {
  const external: string[] = [];
  await page.route(
    (url) =>
      url.hostname !== "localhost" &&
      url.hostname !== "127.0.0.1" &&
      url.protocol !== "data:" &&
      url.protocol !== "blob:",
    (route) => {
      const url = route.request().url();
      if (url.startsWith("https://tiles.openfreemap.org/styles/")) {
        return route.fulfill({ contentType: "application/json", body: STYLE });
      }
      external.push(url);
      return route.abort();
    },
  );
  return external;
};

/** Wait until a map has loaded (it loads once scrolled into view). */
export const mapLoaded = async (map: Locator) => {
  await map.scrollIntoViewIfNeeded();
  await expect(map).toHaveAttribute("data-ready", "", { timeout: 20_000 });
};

/**
 * For screenshots: the map's WebGL drawing differs between GPUs, so it is
 * hidden (not masked: a mask would also cover the markers above it).
 */
export const hideMapCanvas = (page: Page) =>
  page.addStyleTag({ content: ".maplibregl-canvas { visibility: hidden; }" });
