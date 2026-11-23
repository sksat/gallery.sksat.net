import { test, expect, type Page } from "@playwright/test";

// Test data: e2e/fixture.sql via the API (see public/test-media/README.md)
//   reaxxxxxxa Real   pentax-sp
//   vrcxxxxxxa VRChat virtuallens2
//   vrcxxxxxxc VRChat virtuallens2
//   unxxxxxxxx VRChat virtuallens2 (unlisted: never listed)

const chip = (page: Page, tag: string) =>
  page.getByTestId("tag-chip").filter({ hasText: new RegExp(`^${tag}\\d+$`) });

test("camera: the caption links a photo to its camera page", async ({
  page,
}) => {
  await page.goto("/");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(5, { timeout: 10000 });

  // The caption (and its link) only takes clicks while the tile is hovered.
  const tile = page
    .getByTestId("gallery-tile")
    .filter({
      has: page.getByTestId("camera-link").getByText("VirtualLens2", {
        exact: true,
      }),
    })
    .first();
  await tile.hover();
  const link = tile.getByTestId("camera-link");
  await expect(link).toHaveText("VirtualLens2");
  await link.click();

  await expect(page).toHaveURL(/\/camera\/virtuallens2\/$/);
  const header = page.getByTestId("camera-header");
  await expect(
    header.getByRole("heading", { name: "VirtualLens2" }),
  ).toBeVisible();
  await expect(header).toContainText("バーチャルカメラ");
  const manufacturer = header.getByRole("link", { name: "logilabo" });
  await expect(manufacturer).toHaveAttribute(
    "href",
    "https://example.com/logilabo",
  );
  await expect(manufacturer).toHaveAttribute("rel", "noopener noreferrer");
  await expect(header).toContainText("Virtual camera for VRChat.");
  const product = header.getByRole("link", { name: "製品ページ" });
  await expect(product).toHaveAttribute(
    "href",
    "https://example.com/virtuallens2",
  );
  await expect(product).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page).toHaveTitle("VirtualLens2 | sksat gallery");
  // Pictures of the camera: the default one large, all as thumbnails.
  await expect(header.getByTestId("camera-image")).toHaveCount(1);
  await expect(header.getByTestId("camera-thumb")).toHaveCount(3);
  await expect(
    header.getByTestId("camera-image").getByRole("img"),
  ).toHaveAttribute("alt", "VirtualLens2: Front");

  // What was taken with it: its two public photos (not the unlisted one),
  // their dates, and its own tag, which links to its photos with the tag.
  const facts = header.getByTestId("camera-facts");
  await expect(facts).toContainText("写真2 枚");
  await expect(facts).toContainText("撮影期間2023年12月2日 – 2023年12月5日");
  await expect(facts.getByRole("link", { name: "VRChat" })).toHaveAttribute(
    "href",
    "/?camera=virtuallens2&tag=VRChat",
  );

  // The photos come after the camera, with no filters of their own, and
  // all of them are shown (fewer than a page): no 「さらに表示」.
  await expect(
    page.getByRole("heading", { name: "このカメラで撮影した写真" }),
  ).toBeVisible();
  await expect(images).toHaveCount(2);
  await expect(page.getByTestId("show-more")).toHaveCount(0);
  await expect(page.getByTestId("tag-chip")).toHaveCount(0);
  await expect(page.getByTestId("camera-select")).toHaveCount(0);
  await expect(page.getByTestId("camera-all-photos")).toHaveAttribute(
    "href",
    "/?camera=virtuallens2",
  );
});

test("camera: its photos link to the gallery filtered by it", async ({
  page,
}) => {
  await page.goto("/camera/virtuallens2/");
  await page.getByTestId("camera-all-photos").click();
  await expect(page).toHaveURL(/\/\?camera=virtuallens2$/);
  await expect(page.getByTestId("gallery-image")).toHaveCount(2, {
    timeout: 10000,
  });
  await expect(page.getByTestId("camera-select")).toHaveValue("virtuallens2");
  await expect(chip(page, "VRChat")).toHaveText("VRChat2");
});

test("camera: photos open and close within the camera page", async ({
  page,
}) => {
  await page.goto("/camera/virtuallens2/");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(2, { timeout: 10000 });

  // Newest first (the default sort): vrcxxxxxxc, then vrcxxxxxxa. The
  // unlisted photo taken with it (unxxxxxxxx, newer) is not listed.
  await images.first().dispatchEvent("click");
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible();
  await expect(page).toHaveURL(
    /\/photo\/vrcxxxxxxc\/\?camera=virtuallens2$/,
  );

  // Arrow keys stay within the camera's photos, skipping the others.
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(
    /\/photo\/vrcxxxxxxa\/\?camera=virtuallens2$/,
  );

  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(overlay).not.toBeVisible();
  await expect(page).toHaveURL(/\/camera\/virtuallens2\/$/);
  await expect(images).toHaveCount(2);

  // Forward reopens the photo over the camera page, and closing returns to
  // that page again.
  await page.goForward();
  await expect(overlay).toBeVisible();
  await expect(page).toHaveURL(/\/photo\/vrcxxxxxxa\/\?camera=virtuallens2$/);
  await expect(page.getByTestId("camera-header")).toContainText(
    "VirtualLens2",
  );
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(page).toHaveURL(/\/camera\/virtuallens2\/$/);
});

test("camera: a thumbnail brings up that picture, which opens in the overlay", async ({
  page,
}) => {
  await page.goto("/camera/virtuallens2/");
  const header = page.getByTestId("camera-header");
  const thumbs = header.getByTestId("camera-thumb");
  await expect(thumbs.nth(0)).toHaveAttribute("aria-pressed", "true");
  await thumbs.nth(2).click();
  await expect(thumbs.nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(thumbs.nth(0)).toHaveAttribute("aria-pressed", "false");
  const main = header.getByTestId("camera-image");
  await expect(main.getByRole("img")).toHaveAttribute(
    "alt",
    "VirtualLens2: Side",
  );
  await main.click();
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay.locator("img").first()).toHaveAttribute(
    "src",
    /\/camera\/virtuallens2\/side\.png$/,
  );
  // Not a photo: the URL stays on the camera page.
  await expect(page).toHaveURL(/\/camera\/virtuallens2\/$/);
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(overlay).not.toBeVisible();
});

test("camera: a camera with no picture shows its details alone", async ({
  page,
}) => {
  await page.goto("/camera/pentax-sp/");
  const header = page.getByTestId("camera-header");
  await expect(header.getByTestId("camera-image")).toHaveCount(0);
  await expect(header.getByTestId("camera-maker")).toHaveText("Asahi");
  const facts = header.getByTestId("camera-facts");
  await expect(facts).toContainText("種類フィルムカメラ");
  await expect(facts).toContainText("機種Pentax SP");
  await expect(facts).toContainText("撮影日2023年12月1日");
  await expect(page.getByTestId("gallery-image")).toHaveCount(1, {
    timeout: 10000,
  });
});

test("camera: the back link returns to every photo", async ({ page }) => {
  await page.goto("/camera/pentax-sp/");
  await page.getByRole("link", { name: "すべての写真" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("gallery-image")).toHaveCount(5, {
    timeout: 10000,
  });
  await expect(page.getByTestId("camera-header")).toHaveCount(0);
});

test("camera list: site link, cards and navigation to a camera", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "カメラ", exact: true }).click();
  await expect(page).toHaveURL(/\/camera\/$/);
  await expect(page).toHaveTitle("カメラ | sksat gallery");
  // The site's links leave out the page's own section.
  const site = page.getByRole("navigation", { name: "サイト" });
  await expect(site.getByRole("link")).toHaveText([
    /カレンダー/,
    /地図/,
  ]);

  // Most photos first: VirtualLens2 (2 public photos), then PENTAX SP (1).
  const cards = page.getByTestId("camera-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("VirtualLens2");
  await expect(cards.nth(0)).toContainText("バーチャルカメラ");
  await expect(cards.nth(0)).toContainText("2 枚");
  await expect(cards.nth(1)).toContainText("PENTAX SP");
  await expect(cards.nth(1)).toContainText("1 枚");
  // Covers: the camera's first picture, else its newest photo.
  await expect(cards.nth(0).locator("img")).toHaveAttribute(
    "src",
    /\/camera\/virtuallens2\/front\.png$/,
  );
  await expect(cards.nth(1).locator("img")).toHaveAttribute(
    "src",
    /\/mock\/real1\.png$/,
  );
  // The manufacturer's site is its own link, above the card's link.
  await expect(
    cards.nth(0).getByRole("link", { name: "logilabo" }),
  ).toHaveAttribute("href", "https://example.com/logilabo");

  // The whole card is the link: click on its cover image area.
  await cards.nth(1).click({ position: { x: 20, y: 20 } });
  await expect(page).toHaveURL(/\/camera\/pentax-sp\/$/);
  await expect(page.getByTestId("gallery-image")).toHaveCount(1, {
    timeout: 10000,
  });

  // And back to the list from the camera page.
  await page.getByRole("link", { name: "← カメラ一覧" }).click();
  await expect(page).toHaveURL(/\/camera\/$/);
});

test("camera: an unknown ?camera= on a photo link is ignored", async ({
  page,
}) => {
  await page.goto("/photo/reaxxxxxxb/detail/?camera=no-such-camera");
  await expect(page.getByTestId("photo-detail")).toBeVisible({
    timeout: 10000,
  });
  // Back to every photo, and previous / next through every photo.
  await expect(page.getByTestId("back-link")).toHaveAttribute("href", "/");
  await expect(page.getByTestId("next-link")).toHaveAttribute(
    "href",
    "/photo/vrcxxxxxxa/detail/",
  );

  // The photo URL opens it over every photo.
  await page.goto("/photo/reaxxxxxxb/?camera=no-such-camera");
  await expect(page.getByTestId("overlay")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("gallery-image")).toHaveCount(5);
  await expect(page.getByTestId("camera-header")).toHaveCount(0);
  // It leaves the address, and closing goes to the whole gallery.
  await expect(page).toHaveURL(/\/photo\/reaxxxxxxb\/$/);
  await page.getByTestId("overlay").click({ position: { x: 5, y: 5 } });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("gallery-image")).toHaveCount(5);

  // On the gallery, too.
  await page.goto("/?camera=no-such-camera&tag=night");
  await expect(page).toHaveURL(/\/\?tag=night$/);
  await expect(page.getByTestId("gallery-image")).toHaveCount(2);
});

test("camera filter: combines with a calendar date", async ({ page }) => {
  await page.goto("/?camera=virtuallens2&date=2023-12-05");
  await expect(page.getByTestId("gallery-image")).toHaveCount(1, {
    timeout: 10000,
  });
  await expect(page.getByTestId("date-heading")).toBeVisible();
  await expect(page.getByTestId("camera-select")).toHaveValue("virtuallens2");
  await page.getByTestId("camera-select").selectOption("");
  await expect(page).toHaveURL(/\/\?date=2023-12-05$/);
});

test("camera filter: picks a camera on the gallery, with tags, in the URL", async ({
  page,
}) => {
  await page.goto("/");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(5, { timeout: 10000 });
  const select = page.getByTestId("camera-select");
  // The cameras of the public photos shown at "model", most photos first.
  await expect(select.locator("option")).toHaveText([
    "すべてのカメラ",
    "VirtualLens2 (2)",
    "PENTAX SP (1)",
  ]);

  await select.selectOption("virtuallens2");
  await expect(page).toHaveURL(/\/\?camera=virtuallens2$/);
  await expect(images).toHaveCount(2);
  await expect(page.getByTestId("result-count")).toHaveText("2 枚");
  // Tags are counted over that camera's photos.
  await expect(chip(page, "VRChat")).toHaveText("VRChat2");
  await expect(chip(page, "Real")).toHaveCount(0);

  // Combined with a tag; the camera's count follows the tags.
  await chip(page, "Neos VR").click();
  await expect(page).toHaveURL(/\/\?camera=virtuallens2&tag=Neos\+VR$/);
  await expect(images).toHaveCount(1);
  await expect(select.locator("option:checked")).toHaveText(
    "VirtualLens2 (1)",
  );

  // A photo opened over it carries the list, and closing returns to it.
  await images.first().dispatchEvent("click");
  await expect(page).toHaveURL(
    /\/photo\/vrcxxxxxxc\/\?camera=virtuallens2&tag=Neos\+VR$/,
  );
  await page.getByTestId("overlay").click({ position: { x: 5, y: 5 } });
  await expect(page).toHaveURL(/\/\?camera=virtuallens2&tag=Neos\+VR$/);

  await expect(page.getByTestId("overlay")).toHaveCount(0);
  await expect(images).toHaveCount(1);

  // Loading the URL again keeps it.
  await page.goto("/?camera=virtuallens2&tag=Neos+VR", {
    waitUntil: "commit",
  });
  await expect(images).toHaveCount(1, { timeout: 10000 });
  await expect(select).toHaveValue("virtuallens2");

  // Clearing the camera keeps the tag.
  await select.selectOption("");
  await expect(page).toHaveURL(/\/\?tag=Neos\+VR$/);
  await expect(images).toHaveCount(1);
  await chip(page, "Neos VR").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(images).toHaveCount(5);
});

test("camera filter: a photo URL with ?camera= closes to the filtered gallery", async ({
  page,
}) => {
  await page.goto("/photo/vrcxxxxxxc/?camera=virtuallens2");
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("gallery-image")).toHaveCount(2);
  // Arrow keys stay within the camera's photos.
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/photo\/vrcxxxxxxa\/\?camera=virtuallens2$/);
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(overlay).toHaveCount(0);
  await expect(page).toHaveURL(/\/\?camera=virtuallens2$/);
  await expect(page.getByTestId("camera-select")).toHaveValue("virtuallens2");

  // Its detail page goes back to the same list.
  await page.goto("/photo/vrcxxxxxxc/detail/?camera=virtuallens2");
  await expect(page.getByTestId("back-link")).toHaveAttribute(
    "href",
    "/?camera=virtuallens2",
  );
});

test("camera filter: an old camera page link with a filter opens the gallery", async ({
  page,
}) => {
  await page.goto("/camera/virtuallens2/?tag=VRChat&sort=old");
  await expect(page).toHaveURL(/\/\?camera=virtuallens2&tag=VRChat&sort=old$/);
  await expect(page.getByTestId("gallery-image")).toHaveCount(2, {
    timeout: 10000,
  });
});

test("camera: an unknown slug is a 404", async ({ page }) => {
  const res = await page.goto("/camera/no-such-camera/");
  expect(res?.status()).toBe(404);
});
