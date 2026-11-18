import { expect, test, type Page } from "@playwright/test";

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
});
