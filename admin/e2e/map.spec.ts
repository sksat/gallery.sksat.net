import { expect, test } from "@playwright/test";
import { mapLoaded, stubMaps } from "./map-helpers";

// Fixture (e2e/fixture.sql): photo 1 (public) at Tokyo Station, photo 5
// (private) in Osaka. The map styles are stubbed (no tiles), and nothing
// else may leave the test server.

test("map: every photo with a position, private ones too", async ({ page }) => {
  const external = await stubMaps(page);
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .first()
    .getByRole("link", { name: "Map" })
    .click();
  await expect(page).toHaveURL(/\/map\/$/);
  await mapLoaded(page.getByTestId("admin-map"));
  await expect(page.getByTestId("map-marker")).toHaveCount(2);
  await expect(page.getByTestId("map-list-place")).toHaveCount(2);

  // The private photo's place (a marker) → its edit page.
  await page
    .locator(
      '[data-testid=map-marker][data-place="exact:34.702485,135.495951"]',
    )
    .click();
  const popup = page.getByTestId("map-popup");
  await expect(popup).toContainText("非公開");
  await popup.getByTestId("map-popup-photo").click();
  await expect(page).toHaveURL(/\/media\/5\/$/);
  expect(external).toEqual([]);
});

test("edit page: set, move and clear the position on the map", async ({
  page,
}) => {
  const external = await stubMaps(page);
  // Photo 2 is a VRChat one: no real-world place, no map.
  await page.goto("/media/2/");
  await expect(page.getByRole("heading", { name: "Edit #2" })).toBeVisible();
  await expect(page.getByTestId("location-map")).toHaveCount(0);

  // Photo 3 (Real) has no position yet.
  await page.goto("/media/3/");
  const map = page.getByTestId("location-map");
  await mapLoaded(map);
  const lat = page.getByLabel("緯度");
  const lng = page.getByLabel("経度");
  await expect(lat).toHaveValue("");
  await expect(page.getByRole("button", { name: "位置を消す" })).toHaveCount(0);

  // Arrow keys on the map move the map, not to the next photo.
  await map.locator("canvas").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/media\/3\/$/);

  // A click puts the pin there, and shows the inputs it filled.
  await map.click({ position: { x: 100, y: 100 } });
  await expect(lat).toBeVisible();
  await expect(lat).not.toHaveValue("");
  await expect(lng).not.toHaveValue("");
  const first = [await lat.inputValue(), await lng.inputValue()];

  // A click on the pin itself changes nothing.
  const pin = page.getByTestId("location-pin");
  await pin.click();
  expect([await lat.inputValue(), await lng.inputValue()]).toEqual(first);

  // Dragging it moves it.
  const box = (await pin.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height + 30, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(async () => [await lat.inputValue(), await lng.inputValue()])
    .not.toEqual(first);

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();
  await page.reload();
  const data = page.getByTestId("photo-data-location");
  await expect(data.getByTestId("location-source")).toHaveText("手入力");

  // 位置を消す → no position once saved.
  await page.getByRole("button", { name: "位置を消す" }).click();
  await expect(lat).toHaveValue("");
  await expect(lng).toHaveValue("");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();
  await page.reload();
  await expect(data.getByTestId("location-link")).toHaveCount(0);
  expect(external).toEqual([]);
});

test("edit page: edits made while the map is loading are kept", async ({
  page,
}) => {
  await stubMaps(page);
  // Hold the MapLibre chunk (the script that defines setWorkerUrl): the
  // map stays loading until released.
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  let holding = false;
  await page.route("**/build/*.js", async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    if (body.length > 100_000 && body.includes("setWorkerUrl")) {
      holding = true;
      await held;
    }
    await route.fulfill({ response, body });
  });
  // Photo 1 has a position.
  await page.goto("/media/1/");
  const clear = page.getByRole("button", { name: "位置を消す" });
  await expect(clear).toBeVisible();
  const map = page.getByTestId("location-map");
  await map.scrollIntoViewIfNeeded();
  await page
    .getByTestId("photo-data-location")
    .getByTestId("edit-location")
    .locator("summary")
    .click();
  // MapLibre is on its way and held.
  await expect.poll(() => holding).toBe(true);
  const lat = page.getByLabel("緯度");
  const lng = page.getByLabel("経度");
  await lat.fill("");
  await lng.fill("");
  await lng.blur();
  // Followed before the map is there.
  await expect(clear).toHaveCount(0);
  await expect(map).not.toHaveAttribute("data-ready", "");

  release();
  await mapLoaded(map);
  // The pin starts from the inputs, not the saved position.
  await expect(page.getByTestId("location-pin")).toHaveCount(0);
  await lat.fill("35.0");
  await lng.fill("135.0");
  await lng.blur();
  await expect(page.getByTestId("location-pin")).toHaveCount(1);
  await expect(clear).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("map from the menu", async ({ page }) => {
    await stubMaps(page);
    await page.goto("/");
    await page.locator("summary[aria-label=Menu]").tap();
    await page.getByRole("link", { name: "Map" }).tap();
    await expect(page).toHaveURL(/\/map\/$/);
    await mapLoaded(page.getByTestId("admin-map"));
    await expect(page.getByTestId("map-list-place")).toHaveCount(2);
    // The list opens a place on the map, too.
    await page
      .getByTestId("map-list")
      .getByRole("button", { name: /^35\.681236, 139\.767125/ })
      .tap();
    await expect(page.getByTestId("map-popup")).toContainText("公開");
  });
});
