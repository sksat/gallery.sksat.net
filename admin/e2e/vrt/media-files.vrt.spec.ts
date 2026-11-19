import { expect, test, type Page } from "@playwright/test";
import { hideMapCanvas, stubMaps } from "../map-helpers";

/**
 * The bar's 情報… menu → `item`, until the picker `testId` shows; then
 * nothing that varies between runs (hover, focus ring, the text
 * selection Ctrl+A leaves).
 */
const openPicker = async (page: Page, item: string, testId: string) => {
  await page
    .getByTestId("selection-bar")
    .getByRole("button", { name: "情報…" })
    .click();
  await page.getByRole("menuitem", { name: item }).click();
  await expect(page.getByTestId(testId)).toBeVisible();
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
};

/** The VRChat photos selected, the タグと撮影データ sheet open and read. */
const openInfo = async (page: Page) => {
  // The 撮影場所 map below the fold: no external style, no WebGL drawing.
  await stubMaps(page);
  await page.goto("/media/?view=files&dir=/mock");
  await expect(page.getByTestId("upload-folder")).toBeVisible();
  for (const name of ["vrchat1.png", "vrchat2.png", "vrchat3.png"]) {
    await page.getByRole("option", { name }).getByTestId("tile-check").click();
  }
  await openPicker(page, "タグと撮影データ…", "bulk-info");
  await expect(page.getByTestId("bulk-tags")).toBeVisible();
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await hideMapCanvas(page);
};

/** Every tile selected, and 公開 picked: the bar with its look first. */
const selectForPublic = async (page: Page, phone: boolean) => {
  if (phone) {
    await page
      .getByRole("option", { name: "vrchat2.png" })
      .getByTestId("tile-check")
      .click();
    await page
      .getByRole("option", { name: "vrchat3.png" })
      .getByTestId("tile-check")
      .click();
  } else {
    await page.keyboard.press("ControlOrMeta+a");
  }
  await page
    .getByTestId("selection-bar")
    .getByRole("button", { name: "公開", exact: true })
    .click();
  await expect(page.getByTestId("visibility-confirm")).toBeVisible();
  // Deterministic: no hover on the button just clicked, no text selection
  // left from Ctrl+A, and the focus where a click leaves it every time.
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    (document.activeElement as HTMLElement | null)?.blur();
  });
};

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("admin: media files view", async ({ page }) => {
    await page.goto("/media/?view=files&dir=/mock");
    await expect(page.getByTestId("file-tile")).toHaveCount(5);
    // Shown once the page knows the browser can pick folders.
    await expect(page.getByTestId("upload-folder")).toBeVisible();
    await expect(page).toHaveScreenshot("admin-media-files.png", {
      fullPage: true,
    });
  });

  test("admin: media files selection", async ({ page }) => {
    await page.goto("/media/?view=files&dir=/mock");
    await expect(page.getByTestId("upload-folder")).toBeVisible();
    await selectForPublic(page, false);
    await expect(page).toHaveScreenshot("admin-media-files-selection.png");
  });

  test("admin: media files camera picker", async ({ page }) => {
    await page.goto("/media/?view=files&dir=/mock");
    await expect(page.getByTestId("upload-folder")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+a");
    await openPicker(page, "カメラ…", "camera-picker");
    await expect(page).toHaveScreenshot("admin-media-files-camera.png");
  });

  test("admin: media files info sheet", async ({ page }) => {
    await openInfo(page);
    // The map's top is in view here: the same frame once it has loaded.
    await expect(page.getByTestId("location-map")).toHaveAttribute(
      "data-ready",
      "",
      { timeout: 20_000 },
    );
    await expect(page).toHaveScreenshot("admin-media-files-info.png");
  });

  test("admin: media files list and context menu", async ({ page }) => {
    await page.goto("/media/?view=files&dir=/mock");
    await expect(page.getByTestId("upload-folder")).toBeVisible();
    await page.getByRole("button", { name: "リスト" }).click();
    await page
      .getByRole("option", { name: "vrchat1.png" })
      .click({ button: "right", position: { x: 300, y: 10 } });
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page).toHaveScreenshot("admin-media-files-list.png");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("admin: media files view (phone)", async ({ page }) => {
    await page.goto("/media/?view=files&dir=/mock");
    await expect(page.getByTestId("file-tile")).toHaveCount(5);
    await expect(page.getByTestId("upload-folder")).toBeVisible();
    await expect(page).toHaveScreenshot("admin-media-files-phone.png", {
      fullPage: true,
    });
  });

  test("admin: media files selection (phone)", async ({ page }) => {
    await page.goto("/media/?view=files&dir=/mock");
    await expect(page.getByTestId("upload-folder")).toBeVisible();
    await selectForPublic(page, true);
    await expect(page).toHaveScreenshot(
      "admin-media-files-selection-phone.png",
    );
  });

  test("admin: media files camera picker (phone)", async ({ page }) => {
    await page.goto("/media/?view=files&dir=/mock");
    await expect(page.getByTestId("upload-folder")).toBeVisible();
    await page
      .getByRole("option", { name: "real2.png" })
      .getByTestId("tile-check")
      .click();
    await openPicker(page, "カメラ…", "camera-picker");
    await expect(page).toHaveScreenshot("admin-media-files-camera-phone.png");
  });

  test("admin: media files info sheet (phone)", async ({ page }) => {
    await openInfo(page);
    await expect(page).toHaveScreenshot("admin-media-files-info-phone.png");
  });
});
