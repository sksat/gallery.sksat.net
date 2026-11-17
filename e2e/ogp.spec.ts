import { test, expect, type Page } from "@playwright/test";

// Test data: public/test-media/media.json (see public/test-media/README.md).
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
  // Photo 4 (2023-12-05) is the newest.
  expect(await meta(page, "og:image")).toMatch(/\/test-media\/+mock\/vrchat3\.png$/);
  expect(await meta(page, "twitter:card")).toBe("summary_large_image");
});

test("photo page: card describing the photo", async ({ page }) => {
  await page.goto("/photo/1");

  const title = "2023年12月2日の写真 | sksat gallery";
  await expect(page).toHaveTitle(title);
  expect(await meta(page, "og:type")).toBe("article");
  expect(await meta(page, "og:url")).toBe("https://gallery.sksat.net/photo/1/");
  expect(await meta(page, "og:title")).toBe(title);
  // The camera's published display name (media.json `camera.name`).
  expect(await meta(page, "og:description")).toBe(
    "2023年12月2日 09:00 撮影。タグ: VRChat。カメラ: VirtualLens2。",
  );
  expect(await meta(page, "og:image")).toMatch(/\/test-media\/+mock\/vrchat1\.png$/);
  expect(await meta(page, "og:image:alt")).toBe("2023年12月2日の写真");
  expect(await meta(page, "twitter:card")).toBe("summary_large_image");
});
