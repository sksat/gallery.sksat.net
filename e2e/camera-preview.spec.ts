import { test, expect, type Page } from "@playwright/test";

import { openInOverlay } from "./open-photo";

// The card previewing a camera on its link in the overlay's info. Test
// data: e2e/fixture.sql (vrcxxxxxxa is taken with VirtualLens2, which has
// pictures; reaxxxxxxa with the PENTAX SP, which has none).

const cameraLink = (page: Page) =>
  page.getByTestId("info-camera").getByRole("link");
const card = (page: Page) => page.getByTestId("camera-preview");

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("hovering the camera link shows its card; Esc hides it first", async ({
    page,
  }) => {
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await openInOverlay(page, "vrcxxxxxxa");
    await expect(card(page)).toBeHidden();
    // Nothing of the card (its pictures) is asked for before it is wanted.
    expect(urls.filter((u) => u.includes("/camera/virtuallens2/"))).toEqual(
      [],
    );

    await cameraLink(page).hover();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText("VirtualLens2");
    await expect(card(page)).toContainText("logilabo · バーチャルカメラ");
    await expect(card(page)).toContainText("2 枚");
    // Its first picture, and its newest photos.
    await expect(
      card(page).locator('img[src$="/camera/virtuallens2/front.png"]'),
    ).toHaveCount(1);
    await expect(
      card(page).getByTestId("camera-preview-photos").locator("img"),
    ).toHaveCount(2);
    await expect(cameraLink(page)).toHaveAttribute(
      "aria-describedby",
      /^camera-preview-/,
    );

    await page.mouse.move(5, 400);
    await expect(card(page)).toBeHidden();

    // The focus shows it; Esc hides it and leaves the photo open.
    await cameraLink(page).focus();
    await expect(card(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card(page)).toBeHidden();
    await expect(page.getByTestId("overlay")).toBeVisible();

    // The link still goes to the camera's page.
    await cameraLink(page).click();
    await expect(page).toHaveURL(/\/camera\/virtuallens2\/$/);

    for (const u of urls) {
      if (u.startsWith("blob:") || u.startsWith("data:")) continue;
      expect(new URL(u).hostname, u).toBe("127.0.0.1");
    }
  });

  test("a camera without pictures shows its photos only", async ({ page }) => {
    await openInOverlay(page, "reaxxxxxxa");
    await cameraLink(page).hover();
    await expect(card(page)).toContainText("PENTAX SP");
    await expect(card(page)).toContainText("Asahi · フィルムカメラ");
    await expect(card(page).locator('img[src*="/camera/"]')).toHaveCount(0);
    await expect(
      card(page).getByTestId("camera-preview-photos").locator("img"),
    ).not.toHaveCount(0);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a button beside the link shows the card", async ({ page }) => {
    await openInOverlay(page, "vrcxxxxxxa");
    const toggle = page.getByTestId("camera-preview-toggle");
    await toggle.tap();
    await expect(card(page)).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(card(page)).toContainText("VirtualLens2");
  });
});
