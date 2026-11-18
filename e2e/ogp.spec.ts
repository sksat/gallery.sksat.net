import { test, expect, type Page } from "@playwright/test";

// Test data: e2e/fixture.sql via the API (see public/test-media/README.md).
// VITE_IMAGE_BASE_URL is unset in tests, so og:image is the original file
// rather than the image Worker's `og` card, and its size is unknown.

const meta = (page: Page, key: string) =>
  page
    .locator(`head meta[property="${key}"], head meta[name="${key}"]`)
    .getAttribute("content");

test("top page: site card with the newest photo", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("sksat gallery");
  expect(await meta(page, "og:type")).toBe("website");
  expect(await meta(page, "og:url")).toBe("https://gallery.sksat.net/");
  expect(await meta(page, "og:site_name")).toBe("sksat gallery");
  expect(await meta(page, "og:title")).toBe("sksat gallery");
  expect(await meta(page, "og:description")).toBe(
    await meta(page, "description"),
  );
  // vrcxxxxxxc (2023-12-05) is the newest public photo; the unlisted and
  // private ones are newer but must not be the card.
  expect(await meta(page, "og:image")).toMatch(/\/test-media\/+mock\/vrchat3\.png$/);
  expect(await meta(page, "twitter:card")).toBe("summary_large_image");
});

test("photo page: card describing the photo", async ({ page }) => {
  await page.goto("/photo/vrcxxxxxxa");

  const title = "2023年12月2日の写真 | sksat gallery";
  await expect(page).toHaveTitle(title);
  expect(await meta(page, "og:type")).toBe("article");
  expect(await meta(page, "og:url")).toBe(
    "https://gallery.sksat.net/photo/vrcxxxxxxa/",
  );
  expect(await meta(page, "og:title")).toBe(title);
  // The camera's display name.
  expect(await meta(page, "og:description")).toBe(
    // In the photo's own offset (the fixture's is UTC), as everywhere.
    "2023年12月2日 00:00 撮影。タグ: VRChat。カメラ: VirtualLens2。",
  );
  expect(await meta(page, "og:image")).toMatch(/\/test-media\/+mock\/vrchat1\.png$/);
  expect(await meta(page, "og:image:alt")).toBe("2023年12月2日の写真");
  expect(await meta(page, "twitter:card")).toBe("summary_large_image");
});
