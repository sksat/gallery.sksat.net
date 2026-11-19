import { test, expect, type Page } from "@playwright/test";

import { openInOverlay } from "./open-photo";

// Test data: e2e/fixture.sql, served by the API Worker (see
// public/test-media/README.md). Public photos, by public id:
//   reaxxxxxxa Real   [film]          2023-12-01
//   vrcxxxxxxa VRChat [VRChat]        2023-12-02
//   reaxxxxxxb Real   [night]         2023-12-03
//   vrcxxxxxxb VRChat [VRChat, night] 2023-12-04
//   vrcxxxxxxc Neos VR [VRChat]       2023-12-05
//   vdxxxxxxxa VRChat [VRChat]        undated (a video)
// plus unxxxxxxxx (unlisted) and pvxxxxxxxx (private), which must never
// show up in the grid, the tag counts or the arrow-key order.

const chip = (page: Page, tag: string) =>
  page.getByTestId("tag-chip").filter({ hasText: new RegExp(`^${tag}\\d+$`) });

test("gallery: a platform the owner added is a tag by its name", async ({
  page,
}) => {
  await page.goto("/");
  const images = page.getByTestId("gallery-image");
  await expect(images.first()).toBeVisible({ timeout: 10000 });
  await expect(chip(page, "Neos VR")).toHaveText(/^Neos VR1$/);
  await chip(page, "Neos VR").click();
  await expect(images).toHaveCount(1);
  await expect(page).toHaveURL(/\/\?tag=Neos(\+|%20)VR$/);
  await images.first().dispatchEvent("click");
  await expect(page).toHaveURL(/\/photo\/vrcxxxxxxc\//);
});

test("gallery: filter by tags with AND / OR", async ({ page }) => {
  await page.goto("/");

  const images = page.getByTestId("gallery-image");
  const count = page.getByTestId("result-count");
  await expect(images.first()).toBeVisible({ timeout: 10000 });

  // No tag selected → every photo
  await expect(images).toHaveCount(6);
  await expect(count).toHaveText("6 枚");

  // "Real" is just a tag (from the platform field)
  await chip(page, "Real").click();
  await expect(chip(page, "Real")).toHaveAttribute("aria-pressed", "true");
  await expect(images).toHaveCount(2);
  await expect(page).toHaveURL(/\/\?tag=Real$/);

  // Second tag → AND by default: Real ∧ night = photo 2
  await chip(page, "night").click();
  await expect(images).toHaveCount(1);
  await expect(page).toHaveURL(/\/\?tag=Real&tag=night$/);

  // OR: Real ∨ night = photos 0, 2, 3
  await page.getByLabel("どれかを含む").check();
  await expect(images).toHaveCount(3);
  await expect(page).toHaveURL(/\/\?tag=Real&tag=night&mode=or$/);

  // Clear → back to everything with a bare URL
  await page.getByRole("button", { name: "クリア" }).click();
  await expect(images).toHaveCount(6);
  await expect(page).toHaveURL(/\/$/);
});

test("gallery: view and navigate photos within the filter", async ({ page }) => {
  await page.goto("/?tag=Real&tag=night&mode=or");

  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(3, { timeout: 10000 });
  await expect(chip(page, "Real")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, "night")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("どれかを含む")).toBeChecked();

  // Click first image (newest first: photo 3) → overlay appears, URL keeps
  // the filter.
  // dispatchEvent bypasses DOM hit testing (metadata overlay covers tiny test images)
  await images.first().dispatchEvent("click");
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible();
  await expect(page).toHaveURL(
    /\/photo\/vrcxxxxxxb\/\?tag=Real&tag=night&mode=or$/,
  );

  // ArrowRight walks the filtered set in display order
  // (vrcxxxxxxb → reaxxxxxxb → reaxxxxxxa), skipping vrcxxxxxxa
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/photo\/reaxxxxxxb\/\?/);
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/photo\/reaxxxxxxa\/\?/);

  // At the boundary → stays on the same photo
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/photo\/reaxxxxxxa\/\?/);

  // ArrowLeft → back
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/\/photo\/reaxxxxxxb\/\?/);

  // Close overlay by clicking the dark area (top-left corner, outside the image)
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(overlay).not.toBeVisible();
  await expect(page).toHaveURL(/\/\?tag=Real&tag=night&mode=or$/);
  await expect(images).toHaveCount(3);
});

test("gallery: browser Back closes the photo without reloading", async ({
  page,
}) => {
  // Start unfiltered so Back lands on a URL different from the loaded one.
  await page.goto("/");

  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(6, { timeout: 10000 });
  await chip(page, "VRChat").click();
  await expect(images).toHaveCount(4);

  // A full reload would drop this marker.
  await page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });

  await images.first().dispatchEvent("click");
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible();
  await expect(page).toHaveURL(/\/photo\/vrcxxxxxxc\/\?tag=VRChat$/);

  // ArrowRight replaces the entry, so one Back returns to the list.
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/photo\/vrcxxxxxxb\/\?tag=VRChat$/);

  await page.goBack();
  await expect(overlay).not.toBeVisible();
  await expect(page).toHaveURL(/\/\?tag=VRChat$/);
  await expect(images).toHaveCount(4);
  expect(
    await page.evaluate(
      () => (window as unknown as { __noReload?: boolean }).__noReload,
    ),
  ).toBe(true);
});

test("gallery: the overlay is on the photo's URL, over the list", async ({
  page,
}) => {
  await page.goto("/?tag=VRChat");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(4, { timeout: 10000 });
  const length = () => page.evaluate(() => history.length);
  const before = await length();
  await page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });
  const noReload = () =>
    page.evaluate(
      () => (window as unknown as { __noReload?: boolean }).__noReload,
    );

  // Opening pushes the photo's own URL (a path the analytics beacon sees),
  // with the list in its query.
  await images.first().dispatchEvent("click");
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible();
  await expect(page).toHaveURL(/\/photo\/vrcxxxxxxc\/\?tag=VRChat$/);
  expect(await length()).toBe(before + 1);

  // Closing goes back to the list entry: no new entry, and Forward
  // reopens the photo.
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(overlay).toHaveCount(0);
  await expect(page).toHaveURL(/\/\?tag=VRChat$/);
  expect(await length()).toBe(before + 1);
  await page.goForward();
  await expect(overlay).toBeVisible();
  await expect(page).toHaveURL(/\/photo\/vrcxxxxxxc\/\?tag=VRChat$/);
  await expect(images).toHaveCount(4);
  expect(await noReload()).toBe(true);

  // A reload of that URL shows the same: the photo over the same list.
  await page.reload();
  await expect(overlay).toBeVisible({ timeout: 10000 });
  await expect(images).toHaveCount(4);
  await expect(page.getByTestId("photo-detail")).toHaveCount(0);

  // The reloaded page took over the entries the gallery pushed: Back from
  // it shows the list again.
  await page.goBack();
  await expect(page).toHaveURL(/\/\?tag=VRChat$/);
  await expect(overlay).toHaveCount(0);
  await expect(images).toHaveCount(4, { timeout: 10000 });
});

test("gallery: the photo URL loaded as it is opens the photo over the list", async ({
  page,
}) => {
  await page.goto("/photo/vrcxxxxxxb/");
  const overlay = page.getByTestId("overlay");
  const images = page.getByTestId("gallery-image");
  // The whole gallery behind the photo, as after a click on its tile.
  await expect(overlay).toBeVisible({ timeout: 10000 });
  await expect(images).toHaveCount(6);
  await expect(page.getByTestId("result-count")).toHaveText("6 枚");
  await expect(page.getByTestId("photo-detail")).toHaveCount(0);
  await expect(page.locator('head meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/photo\/vrcxxxxxxb\/$/,
  );

  // The arrows step through the list.
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/photo\/reaxxxxxxb\/$/);
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/\/photo\/vrcxxxxxxb\/$/);

  // There is no list entry under it: closing replaces it with the list.
  const length = await page.evaluate(() => history.length);
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(overlay).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => history.length)).toBe(length);
  await expect(images).toHaveCount(6);

  // With a list in its query, that list.
  await page.goto("/photo/vrcxxxxxxb/?tag=VRChat&sort=old");
  await expect(overlay).toBeVisible({ timeout: 10000 });
  await expect(images).toHaveCount(4);
  await expect(page.getByTestId("sort-select")).toHaveValue("old");
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(page).toHaveURL(/\/\?tag=VRChat&sort=old$/);
});

test("gallery: the overlay's page button and Enter open the detail page", async ({
  page,
}) => {
  for (const how of ["button", "Enter"] as const) {
    await openInOverlay(page, "vrcxxxxxxb");
    if (how === "button") await page.getByTestId("detail-link").click();
    else await page.keyboard.press("Enter");
    await expect(page.getByTestId("photo-detail")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("overlay")).toHaveCount(0);
    await expect(page).toHaveURL(/\/photo\/vrcxxxxxxb\/detail\/$/);
    // A reload stays on the detail page.
    await page.reload();
    await expect(page.getByTestId("photo-detail")).toBeVisible({
      timeout: 10000,
    });
    await expect(page).toHaveURL(/\/photo\/vrcxxxxxxb\/detail\/$/);
    // Back from it returns to the photo open over the list, and Back again
    // to the list.
    await page.goBack();
    await expect(page).toHaveURL(/\/photo\/vrcxxxxxxb\/$/);
    await expect(page.getByTestId("overlay")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("gallery-image")).toHaveCount(6);
    await expect(page.getByTestId("photo-detail")).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("overlay")).toHaveCount(0);
    await expect(page.getByTestId("gallery-image")).toHaveCount(6, {
      timeout: 10000,
    });
  }
});

test("gallery: header link always clears the filter", async ({ page }) => {
  // The gallery rewrites the URL itself, so the header must not go through
  // Qwik City's SPA router, which would treat a stale "/" as the same page.
  await page.goto("/?tag=Real");
  const images = page.getByTestId("gallery-image");
  const home = page.getByRole("link", { name: "sksat gallery" });
  await expect(images).toHaveCount(2, { timeout: 10000 });

  for (const tag of ["Real", "VRChat"]) {
    if (tag !== "Real") await chip(page, tag).click();
    await expect(chip(page, tag)).toHaveAttribute("aria-pressed", "true");
    await home.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(images).toHaveCount(6);
    await expect(chip(page, tag)).toHaveAttribute("aria-pressed", "false");
  }
});

test("gallery: keys while a photo is open do not touch the filter", async ({
  page,
}) => {
  await page.goto("/?tag=Real&tag=night");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(1, { timeout: 10000 });

  // Focus the AND/OR radio, then open the photo.
  await page.getByLabel("すべて含む").focus();
  await images.first().dispatchEvent("click");
  await expect(page.getByTestId("overlay")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(/\/photo\/reaxxxxxxb\/\?tag=Real&tag=night$/);
  await expect(page.getByLabel("すべて含む")).toBeChecked();
});

test("photo page: arrows still work on a photo outside the filter", async ({
  page,
}) => {
  // vrcxxxxxxa is not tagged Real (e.g. a hand-edited URL, or a reload of
  // the overlay's URL after the filter changed).
  await page.goto("/photo/vrcxxxxxxa/detail/?tag=Real");
  await expect(page.getByTestId("photo-detail")).toBeVisible({
    timeout: 10000,
  });

  // Browses all photos in display order (newest first), so the next one is
  // the oldest.
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/photo\/reaxxxxxxa\/detail\/\?tag=Real$/);
});

test("gallery: sort order is selectable and kept in the URL", async ({
  page,
}) => {
  await page.goto("/");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(6, { timeout: 10000 });
  const order = () =>
    images.evaluateAll((els) => els.map((el) => el.getAttribute("src")));
  const select = page.getByTestId("sort-select");

  // Default: newest first (fixture dates run 12-01 … 12-05 by index).
  await expect(select).toHaveValue("new");
  const newest = await order();
  expect(newest[0]).toContain("vrchat3");

  await select.selectOption("old");
  await expect(page).toHaveURL(/\/\?sort=old$/);
  // The undated video stays last either way.
  const undated = newest[newest.length - 1];
  await expect
    .poll(order)
    .toEqual([...newest.slice(0, -1).reverse(), undated]);

  // Random: a seed goes into the URL, and reloading keeps the same order.
  await select.selectOption("random");
  await expect(page).toHaveURL(/\/\?sort=random&seed=\d+$/);
  const shuffled = await order();
  expect([...shuffled].sort()).toEqual([...newest].sort());
  await page.reload();
  await expect(select).toHaveValue("random");
  await expect.poll(order).toEqual(shuffled);
  await expect(page.getByTestId("reshuffle")).toBeVisible();

  // Opening a photo keeps the sort in the photo URL too.
  await images.first().dispatchEvent("click");
  await expect(page).toHaveURL(/\/photo\/[a-z2-9]{10}\/\?sort=random&seed=\d+$/);
});

test("gallery: direct navigation to /photo/{id}", async ({ page }) => {
  // Navigate directly to a photo (VRChat image in test fixture)
  await page.goto("/photo/vrcxxxxxxa/detail/");
  // A listed photo's page may be indexed.
  await expect(page.locator('head meta[name="robots"]')).toHaveCount(0);

  // The photo's own page, with the image
  const overlay = page.getByTestId("photo-detail");
  await expect(overlay).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("overlay")).toHaveCount(0);
  // The full-size image is fetched (with a progress bar), then stacked over
  // the thumbnail as a blob: URL — even though this page was rendered on
  // the server.
  const full = overlay.getByTestId("overlay-image");
  await expect(full).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() =>
      full.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
    )
    .toBeGreaterThan(0);
  // The bar reached 100% and faded out.
  const bar = overlay.getByTestId("overlay-progress");
  await expect(bar).toHaveClass(/opacity-0/);
});

test("gallery: progress bar shows the download of the full-size photo", async ({
  page,
}) => {
  // Hold the full-size download so the bar can be observed mid-way.
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/test-media/mock/vrchat1.png", async (route) => {
    if (route.request().resourceType() === "fetch") await gate;
    await route.continue();
  });

  await page.goto("/photo/vrcxxxxxxa/detail/");
  const bar = page.getByTestId("overlay-progress");
  await expect(bar).toHaveClass(/opacity-100/, { timeout: 10000 });
  await expect(bar).toHaveAttribute("role", "progressbar");
  await expect(page.getByTestId("overlay-image")).toHaveCount(0);

  release();
  await expect(page.getByTestId("overlay-image")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await expect(bar).toHaveClass(/opacity-0/);
});

test("visibility: an unlisted photo opens by URL but is in no list", async ({
  page,
}) => {
  // Its URL opens it over the gallery, which does not list it.
  await page.goto("/photo/unxxxxxxxx");
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible({ timeout: 10000 });
  await expect(overlay.locator("img").first()).toHaveAttribute(
    "src",
    /\/mock\/unlisted\.png$/,
  );
  await expect(page.getByTestId("gallery-image")).toHaveCount(6);
  await expect(page.getByTestId("result-count")).toHaveText("6 枚");
  // Kept out of search; listed photos are not.
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex",
  );
  // In no previous / next order: the arrows do nothing.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/photo\/unxxxxxxxx\/$/);
  await expect(overlay.locator("img").first()).toHaveAttribute(
    "src",
    /\/mock\/unlisted\.png$/,
  );
  // Its detail page is a click away; closing goes to the gallery.
  await expect(page.getByTestId("detail-link")).toHaveAttribute(
    "href",
    "/photo/unxxxxxxxx/detail/",
  );
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(overlay).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("gallery-image")).toHaveCount(6);

  // Its detail page, likewise kept out of search.
  await page.goto("/photo/unxxxxxxxx/detail/");
  const detail = page.getByTestId("photo-detail");
  await expect(detail).toBeVisible({ timeout: 10000 });
  await expect(detail.locator("img").first()).toHaveAttribute(
    "src",
    /\/mock\/unlisted\.png$/,
  );
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex",
  );

  // Nor in the previous / next order: no links, the arrows do nothing.
  await expect(page.getByTestId("prev-link")).toHaveCount(0);
  await expect(page.getByTestId("next-link")).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/photo\/unxxxxxxxx\/detail\/$/);

  // Not in the grid, the count or the tag counts (it is VRChat + night),
  // and the old ?photo= does not open it (or anything) over the list.
  await page.goto("/?photo=unxxxxxxxx");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(6, { timeout: 10000 });
  await expect(page.getByTestId("overlay")).toHaveCount(0);
  await expect(page.getByTestId("result-count")).toHaveText("6 枚");
  await expect(chip(page, "VRChat")).toHaveText(/^VRChat4$/);
  await expect(chip(page, "night")).toHaveText(/^night2$/);
  for (const src of await images.evaluateAll((els) =>
    els.map((el) => el.getAttribute("src")),
  )) {
    expect(src).not.toContain("unlisted");
  }
});

test("visibility: a private photo is a 404 and in no list", async ({
  page,
}) => {
  const response = await page.goto("/photo/pvxxxxxxxx");
  expect(response?.status()).toBe(404);
  const detail = await page.goto("/photo/pvxxxxxxxx/detail/");
  expect(detail?.status()).toBe(404);

  await page.goto("/");
  await expect(page.getByTestId("gallery-image")).toHaveCount(6, {
    timeout: 10000,
  });
  await expect(chip(page, "secret")).toHaveCount(0);
});

test("old numeric photo URLs are not found", async ({ request }) => {
  // (Qwik City first adds the trailing slash, so ask with it.)
  const res = await request.get("/photo/1/", { maxRedirects: 0 });
  expect(res.status()).toBe(404);
  // /?imageId=N is just the top page now.
  const top = await request.get("/?imageId=2", { maxRedirects: 0 });
  expect(top.status()).toBe(200);
});

test("gallery: private tags and hidden metadata never show", async ({
  page,
  request,
}) => {
  const api = `http://127.0.0.1:${process.env.E2E_API_PORT || 5178}/api`;
  const list = await (await request.get(`${api}/media`)).json();
  expect(JSON.stringify(list)).not.toContain("draft");
  const vrchat2 = list.find((m: { id: string }) => m.id === "vrcxxxxxxb");
  expect(vrchat2).toMatchObject({
    timestamp: "2023-12-04T00:00:00+09:00",
    timestamp_precision: "date",
  });

  await page.goto("/");
  await expect(page.getByTestId("gallery-image")).toHaveCount(6, {
    timeout: 10000,
  });
  expect(await page.content()).not.toContain("draft");
  await expect(chip(page, "draft")).toHaveCount(0);
  // Only the date of vrcxxxxxxb is shown, on its own day.
  await expect(page.getByText("2023/12/04", { exact: true })).toHaveCount(1);
});

// reaxxxxxxb's file name is hidden (its metadata visibility in the
// fixture); the other photos' names are.
test("gallery: a photo whose file name is not public never shows it", async ({
  page,
  request,
}) => {
  const api = `http://127.0.0.1:${process.env.E2E_API_PORT || 5178}/api`;
  const one = await (await request.get(`${api}/media/reaxxxxxxb`)).json();
  expect(one.file).toBeNull();
  const list = await (await request.get(`${api}/media`)).json();
  expect(JSON.stringify(list)).not.toContain("real2");
  expect(list.find((m: { id: string }) => m.id === "reaxxxxxxa").file).toBe(
    "/mock/real1.png",
  );

  // The page itself (grid and the photo's own page) has no trace of it.
  await page.goto("/");
  await expect(page.getByTestId("gallery-image")).toHaveCount(6);
  expect(await page.content()).not.toContain("real2");
  await page.goto("/photo/reaxxxxxxb/detail/");
  await expect(page.getByTestId("photo-detail")).toBeVisible({
    timeout: 10000,
  });
  expect(await page.content()).not.toContain("real2");
  await openInOverlay(page, "reaxxxxxxb");
  expect(await page.content()).not.toContain("real2");
  await page.goto("/photo/reaxxxxxxb/");
  await expect(page.getByTestId("overlay")).toBeVisible({ timeout: 10000 });
  expect(await page.content()).not.toContain("real2");
});
