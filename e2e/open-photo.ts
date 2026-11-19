import { expect, type Page } from "@playwright/test";

/** The public photos of e2e/fixture.sql as the gallery lists them (newest first). */
export const GALLERY_ORDER = [
  "vrcxxxxxxc",
  "vrcxxxxxxb",
  "reaxxxxxxb",
  "vrcxxxxxxa",
  "reaxxxxxxa",
  // Undated: last.
  "vdxxxxxxxa",
];

/**
 * Open a photo in the gallery's overlay: load a list and click its tile
 * (loading the photo URL shows the same, but this goes through the list).
 * `list` is the list's URL and `order` its photos in display order.
 */
export const openInOverlay = async (
  page: Page,
  id: string,
  list = "/",
  order = GALLERY_ORDER,
) => {
  const index = order.indexOf(id);
  if (index === -1) throw new Error(`${id} is not in ${list}`);
  await page.goto(list);
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(order.length, { timeout: 10000 });
  // dispatchEvent bypasses DOM hit testing (the caption covers tiny images).
  await images.nth(index).dispatchEvent("click");
  await expect(page.getByTestId("overlay")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/photo/${id}/`));
};

/** The photos taken with VirtualLens2, as /camera/virtuallens2/ lists them. */
export const VIRTUALLENS2_ORDER = ["vrcxxxxxxc", "vrcxxxxxxa"];
