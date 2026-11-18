import { test, expect, type Page } from "@playwright/test";

// Test data: e2e/fixture.sql. reaxxxxxxa is at an exact position and
// reaxxxxxxb only to the city; the VRChat, private and hidden positions
// must not appear. The map style has no tiles (VITE_MAP_STYLE_URL).

/** Fails the test on any request that leaves the test servers. */
const noExternalRequests = async (page: Page) => {
  const external: string[] = [];
  await page.route(
    (url) => url.hostname !== "127.0.0.1" && url.protocol !== "data:",
    (route) => {
      external.push(route.request().url());
      return route.abort();
    },
  );
  return external;
};

const mapReady = (page: Page) =>
  expect(page.getByTestId("photo-map")).toHaveAttribute("data-ready", "", {
    timeout: 20_000,
  });

const browseMap = async (page: Page) => {
  const external = await noExternalRequests(page);
  await page.goto("/");
  await page.getByRole("link", { name: "地図", exact: true }).click();
  await expect(page).toHaveURL(/\/map\/$/);
  await mapReady(page);

  // Two places: a pin and an approximate area.
  const markers = page.getByTestId("map-marker");
  await expect(markers).toHaveCount(2);
  const area = page.locator(
    '[data-testid=map-marker][data-place="city:35.66,139.7"]',
  );
  await expect(area).toHaveClass(/is-area/);
  await expect(area).toHaveAccessibleName(
    "35.66°N 139.70°E（市区町村くらい） 1枚",
  );

  // The list has the same places; no VRChat, private or hidden one.
  const list = page.getByTestId("map-list");
  await expect(page.getByTestId("map-list-place")).toHaveCount(2);
  for (const id of ["vrcxxxxxxa", "vrcxxxxxxc", "pvxxxxxxxx"]) {
    await expect(list.locator(`a[href="/photo/${id}/"]`)).toHaveCount(0);
  }

  // A pin → its photos → the photo's page.
  await page
    .locator('[data-testid=map-marker][data-place="exact:35.68124,139.76713"]')
    .click();
  const popup = page.getByTestId("map-popup");
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("35.6812°N 139.7671°E");
  await popup.getByTestId("map-popup-photo").click();
  await expect(page).toHaveURL(/\/photo\/reaxxxxxxa\/?$/);
  expect(external).toEqual([]);
};

test("map: places, popups and the photo page", async ({ page }) => {
  await browseMap(page);
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("map: the same on a phone", async ({ page }) => {
    await browseMap(page);
  });
});

test("map: ?photo= opens on that photo's place", async ({ page }) => {
  await noExternalRequests(page);
  await page.goto("/map/?photo=reaxxxxxxb");
  await mapReady(page);
  const popup = page.getByTestId("map-popup");
  await expect(popup).toContainText("市区町村くらい");
  await expect(popup.locator('a[href="/photo/reaxxxxxxb/"]')).toHaveCount(1);
});

test("map: the list shows a place on the map (keyboard)", async ({ page }) => {
  await noExternalRequests(page);
  await page.goto("/map/");
  await mapReady(page);
  const button = page
    .getByTestId("map-list")
    .getByRole("button", { name: /^35\.6812°N/ });
  await button.focus();
  await page.keyboard.press("Enter");
  const popup = page.getByTestId("map-popup");
  await expect(popup).toBeVisible();
  await expect(popup.locator('a[href="/photo/reaxxxxxxa/"]')).toHaveCount(1);
  // The list's choice moves the keyboard focus into the popup.
  await expect
    .poll(() =>
      page.evaluate(
        () => !!document.activeElement?.closest(".maplibregl-popup"),
      ),
    )
    .toBe(true);
});

test("map: positions never leave the API beyond their level", async ({
  request,
}) => {
  // The page's own data comes from here (every page has the list).
  const media = (await (
    await request.get(
      `http://127.0.0.1:${process.env.E2E_API_PORT || 5178}/api/media`,
    )
  ).json()) as { id: string; location: unknown }[];
  const at = (id: string) => media.find((m) => m.id === id)?.location;
  expect(at("reaxxxxxxa")).toEqual({
    latitude: 35.68124,
    longitude: 139.76713,
    precision: "exact",
  });
  expect(at("reaxxxxxxb")).toEqual({
    latitude: 35.66,
    longitude: 139.7,
    precision: "city",
  });
  // VRChat (exact level) and hidden positions: nothing.
  expect(at("vrcxxxxxxa")).toBeNull();
  expect(at("vrcxxxxxxc")).toBeNull();
  expect(media.some((m) => m.id === "pvxxxxxxxx")).toBe(false);
});
