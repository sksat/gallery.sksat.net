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
  // Pictures of the camera: the first large, the rest in a strip.
  await expect(header.getByTestId("camera-image")).toHaveCount(3);
  await expect(header.getByRole("img").first()).toHaveAttribute(
    "alt",
    "VirtualLens2: Front",
  );

  // Its two public photos (not the unlisted one).
  await expect(images).toHaveCount(2);
  await expect(page.getByTestId("result-count")).toHaveText("2 枚");
  // Tags are counted over this camera's photos only.
  await expect(chip(page, "VRChat")).toHaveText("VRChat2");
  await expect(chip(page, "Real")).toHaveCount(0);
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

  // The overlay's URL loaded as it is shows the same: the photo over the
  // camera's list, and closing it leaves the camera page.
  await page.goto("/photo/vrcxxxxxxc/?camera=virtuallens2");
  await expect(overlay).toBeVisible({ timeout: 10000 });
  await expect(images).toHaveCount(2);
  await expect(page.getByTestId("camera-header")).toContainText(
    "VirtualLens2",
  );
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(overlay).toHaveCount(0);
  await expect(page).toHaveURL(/\/camera\/virtuallens2\/$/);

  // Its detail page goes back to the camera.
  await page.goto("/photo/vrcxxxxxxc/detail/?camera=virtuallens2");
  await expect(page.getByTestId("back-link")).toHaveAttribute(
    "href",
    "/camera/virtuallens2/",
  );
});

test("camera: the sort order works on a camera page", async ({ page }) => {
  await page.goto("/camera/virtuallens2/");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(2, { timeout: 10000 });

  await page.getByTestId("sort-select").selectOption("old");
  await expect(page).toHaveURL(/\/camera\/virtuallens2\/\?sort=old$/);
  // Oldest first: vrchat1 before vrchat3.
  await expect(images.first()).toHaveAttribute("src", /vrchat1\.png$/);
  await images.first().dispatchEvent("click");
  await expect(page).toHaveURL(
    /\/photo\/vrcxxxxxxa\/\?camera=virtuallens2&sort=old$/,
  );
});

test("camera: a picture of the camera opens in the overlay", async ({
  page,
}) => {
  await page.goto("/camera/virtuallens2/");
  const header = page.getByTestId("camera-header");
  await header.getByTestId("camera-image").nth(2).click();
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

test("camera: a tag filter on a camera page stays in its URL", async ({
  page,
}) => {
  await page.goto("/camera/pentax-sp/");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(1, { timeout: 10000 });
  await expect(page.getByTestId("camera-header")).toContainText(
    "フィルムカメラ",
  );

  await chip(page, "film").click();
  await expect(page).toHaveURL(/\/camera\/pentax-sp\/\?tag=film$/);
  await expect(images).toHaveCount(1);
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
  // Closing it goes to the gallery, not to a camera page that is not.
  await page.getByTestId("overlay").click({ position: { x: 5, y: 5 } });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("gallery-image")).toHaveCount(5);
});

test("camera: an unknown slug is a 404", async ({ page }) => {
  const res = await page.goto("/camera/no-such-camera/");
  expect(res?.status()).toBe(404);
});
