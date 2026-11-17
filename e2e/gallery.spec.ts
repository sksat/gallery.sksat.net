import { test, expect, type Page } from "@playwright/test";

// Test data: public/test-media/media.json (see public/test-media/README.md)
//   0 Real   [film]
//   1 VRChat [VRChat]
//   2 Real   [night]
//   3 VRChat [VRChat, night]
//   4 VRChat [VRChat]

const chip = (page: Page, tag: string) =>
  page.getByTestId("tag-chip").filter({ hasText: new RegExp(`^${tag}\\d+$`) });

test("gallery: filter by tags with AND / OR", async ({ page }) => {
  await page.goto("/");

  const images = page.getByTestId("gallery-image");
  const count = page.getByTestId("result-count");
  await expect(images.first()).toBeVisible({ timeout: 10000 });

  // No tag selected → every photo
  await expect(images).toHaveCount(5);
  await expect(count).toHaveText("5 枚");

  // "Real" is just a tag (from the world field)
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
  await expect(images).toHaveCount(5);
  await expect(page).toHaveURL(/\/$/);
});

test("gallery: view and navigate photos within the filter", async ({ page }) => {
  await page.goto("/?tag=Real&tag=night&mode=or");

  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(3, { timeout: 10000 });
  await expect(chip(page, "Real")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, "night")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("どれかを含む")).toBeChecked();

  // Click first image → overlay appears, URL keeps the filter
  // dispatchEvent bypasses DOM hit testing (metadata overlay covers tiny test images)
  await images.first().dispatchEvent("click");
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible();
  await expect(page).toHaveURL(/\/photo\/0\?tag=Real&tag=night&mode=or$/);

  // ArrowRight walks the filtered set (0 → 2 → 3), skipping photo 1
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/photo\/2\?/);
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/photo\/3\?/);

  // At the boundary → stays on the same photo
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/photo\/3\?/);

  // ArrowLeft → back
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/\/photo\/2\?/);

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
  await expect(images).toHaveCount(5, { timeout: 10000 });
  await chip(page, "VRChat").click();
  await expect(images).toHaveCount(3);

  // A full reload would drop this marker.
  await page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });

  await images.first().dispatchEvent("click");
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible();
  await expect(page).toHaveURL(/\/photo\/1\?tag=VRChat$/);

  // ArrowRight replaces the entry, so one Back returns to the list.
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/photo\/3\?tag=VRChat$/);

  await page.goBack();
  await expect(overlay).not.toBeVisible();
  await expect(page).toHaveURL(/\/\?tag=VRChat$/);
  await expect(images).toHaveCount(3);
  expect(
    await page.evaluate(
      () => (window as unknown as { __noReload?: boolean }).__noReload,
    ),
  ).toBe(true);
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
    await expect(images).toHaveCount(5);
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
  await expect(page).toHaveURL(/\/photo\/2\?tag=Real&tag=night$/);
  await expect(page.getByLabel("すべて含む")).toBeChecked();
});

test("gallery: arrows still work on a photo outside the filter", async ({
  page,
}) => {
  // Photo 1 is not tagged Real (e.g. a hand-edited or old shared URL).
  await page.goto("/photo/1?tag=Real");
  await expect(page.getByTestId("overlay")).toBeVisible({ timeout: 10000 });

  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/photo\/2\?tag=Real$/);
  await expect(page.getByTestId("overlay")).toBeVisible();
});

test("gallery: direct navigation to /photo/{id}", async ({ page }) => {
  // Navigate directly to photo 1 (VRChat image in test fixture)
  await page.goto("/photo/1");

  // Overlay should appear with the image
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible({ timeout: 10000 });
  // The full-size image is stacked over the thumbnail and loads.
  await expect
    .poll(() =>
      overlay
        .getByTestId("overlay-image")
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
    )
    .toBeGreaterThan(0);
});
