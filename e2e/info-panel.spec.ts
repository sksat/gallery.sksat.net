import { test, expect, type Page } from "@playwright/test";

import { openInOverlay } from "./open-photo";

// Test data: e2e/fixture.sql. The info panel shows what the API returns
// for each photo's metadata levels, and nothing else:
//   vrcxxxxxxa everything (second, camera page, world link, all EXIF; no
//              place: VRChat photos have none)
//   vrcxxxxxxb date only, maker only (RICOH), world name only, EXIF hidden
//   reaxxxxxxb camera hidden, basic EXIF (no lens/body), no file name,
//              its place to the city
//   reaxxxxxxa time to the minute, its exact place

const panel = (page: Page) => page.getByTestId("info-panel");

const openPhoto = openInOverlay;

/** Open the panel with its ⓘ button (it starts closed everywhere). */
const openInfo = async (page: Page) => {
  await page.getByTestId("info-toggle").click();
  await expect(page.getByTestId("info-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(panel(page)).toBeInViewport();
};

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("shows every field the API gives", async ({ page }) => {
    await openPhoto(page, "vrcxxxxxxa");
    const p = panel(page);
    await openInfo(page);
    await expect(p.getByTestId("info-taken")).toHaveText(
      "撮影日時2023/12/02 00:00",
    );
    await expect(p.locator("time")).toHaveAttribute(
      "datetime",
      "2023-12-02T00:00Z",
    );
    const camera = p.getByTestId("info-camera");
    await expect(camera.getByRole("link", { name: "VirtualLens2" })).toHaveAttribute(
      "href",
      "/camera/virtuallens2/",
    );
    await expect(camera).toContainText("Canon EOS R5");
    await expect(p.getByTestId("info-lens")).toHaveText(
      "RF35mm F1.8 MACRO IS STM",
    );
    await expect(p.getByTestId("info-exposure")).toHaveText(
      "撮影設定f/2.8 · 1/250 s · ISO 100 · 35 mm",
    );
    await expect(
      p.getByTestId("info-world").getByRole("link", { name: "Fixture World" }),
    ).toHaveAttribute(
      "href",
      "https://vrchat.com/home/world/wrld_0123abcd-4567-89ab-cdef-0123456789ab",
    );
    await expect(p.getByTestId("info-file")).toHaveText(
      "ファイル名/mock/vrchat1.png",
    );
    await expect(p.getByTestId("info-tag")).toHaveText(["VRChat"]);
    // A VRChat photo has no real-world place: none, though its level is
    // exact. The original EXIF time (more precise than the photo's time
    // level) is never shown or kept.
    await expect(p.getByTestId("info-location")).toHaveCount(0);
    await expect(p).not.toContainText("139.76");
    expect(await page.content()).not.toContain("2023-12-02T09:00:00+09:00");
  });

  test("hidden fields are absent", async ({ page }) => {
    await openPhoto(page, "vrcxxxxxxb");
    const p = panel(page);
    await openInfo(page);
    await expect(p.getByTestId("info-taken")).toHaveText("撮影日時2023/12/04");
    // The maker only, as text.
    await expect(p.getByTestId("info-camera")).toHaveText("カメラRICOH");
    await expect(p.getByTestId("info-camera").getByRole("link")).toHaveCount(0);
    // The world's name without a link.
    await expect(p.getByTestId("info-world")).toHaveText(
      "ワールドName Only World",
    );
    await expect(p.getByTestId("info-world").getByRole("link")).toHaveCount(0);
    await expect(p.getByTestId("info-exposure")).toHaveCount(0);
    expect(await page.content()).not.toContain("wrld_fedcba98");

    await openPhoto(page, "reaxxxxxxb");
    await openInfo(page);
    // Only to the city: two decimals, said so.
    await expect(p.getByTestId("info-location")).toContainText("35.66");
    await expect(p.getByTestId("info-location")).toContainText(
      "市区町村くらい",
    );
    await expect(p.getByTestId("info-location")).not.toContainText("35.658");
    await expect(p.getByTestId("info-camera")).toHaveCount(0);
    await expect(p.getByTestId("info-exposure")).toHaveText(
      "撮影設定f/5.6 · 1/1000 s · ISO 200 · 18.3 mm",
    );
    await expect(p.getByTestId("info-file")).toHaveCount(0);
    await expect(p.getByTestId("info-world")).toHaveCount(0);
    // The API leaves out the lens, the body and the camera altogether.
    expect(await page.content()).not.toContain("GR LENS");
    await expect(p).not.toContainText("RICOH");
    await expect(p).not.toContainText("GR III");

    await openPhoto(page, "reaxxxxxxa");
    await openInfo(page);
    await expect(p.getByTestId("info-taken")).toHaveText(
      "撮影日時2023/12/01 00:00",
    );
    // Its place, linking to the map on it.
    const place = p.getByTestId("info-location").getByRole("link");
    await expect(place).toHaveText(/35\.68/);
    await expect(place).toHaveAttribute("href", "/map/?photo=reaxxxxxxa");
  });

  test("closed at first, the photo as large as without it", async ({
    page,
  }) => {
    await openPhoto(page, "vrcxxxxxxa");
    const p = panel(page);
    const toggle = page.getByTestId("info-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(p).not.toBeInViewport();
    // A one-line summary at the bottom edge instead, below the photo.
    const summary = page.getByTestId("info-summary");
    await expect(summary).toHaveText(
      "2023/12/02 00:00 · VirtualLens2 · Fixture World",
    );
    const box = await page.getByTestId("overlay-box").boundingBox();
    // The photo box is 90vw wide, as without the panel.
    expect(box?.width).toBeCloseTo(1280 * 0.9, 0);

    // The summary opens the panel over the photo; the box stays put.
    await summary.click();
    await expect(p).toBeInViewport();
    await expect(p.getByTestId("info-close")).toBeFocused();
    expect(await page.getByTestId("overlay-box").boundingBox()).toEqual(box);
  });

  test("toggles with i and the button", async ({ page }) => {
    await openPhoto(page, "vrcxxxxxxa");
    const p = panel(page);
    const toggle = page.getByTestId("info-toggle");

    await page.keyboard.press("i");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(p).toBeInViewport();
    await page.keyboard.press("i");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(p).not.toBeInViewport();

    // Not remembered: reopening the photo starts closed again.
    await page.keyboard.press("i");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("overlay").click({ position: { x: 5, y: 400 } });
    await expect(page.getByTestId("overlay")).toHaveCount(0);
    await page.getByTestId("gallery-image").nth(3).dispatchEvent("click");
    await expect(page.getByTestId("info-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.keyboard.press("ArrowRight");
    // Newest first: vrcxxxxxxa is followed by reaxxxxxxa, also closed.
    await expect(page).toHaveURL(/\/photo\/reaxxxxxxa\//);
    await expect(page.getByTestId("info-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    // The button opens it, over the summary; clicks on it do not close
    // the photo.
    await openInfo(page);
    await expect(page.getByTestId("info-summary")).toBeHidden();
    await p.getByTestId("info-taken").click();
    await expect(page.getByTestId("overlay")).toBeVisible();

    // `i` with the focus in the sheet closes it and hands the focus back.
    await p.getByTestId("info-close").focus();
    await page.keyboard.press("i");
    await expect(page.getByTestId("info-toggle")).toBeFocused();
    await openInfo(page);

    // The close button hands focus back to the toggle.
    await p.getByTestId("info-close").click();
    await expect(page.getByTestId("info-toggle")).toBeFocused();
    await expect(page.getByTestId("info-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // Arrows still browse; a click outside still closes.
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(/\/photo\/vrcxxxxxxa\//);
    await page.getByTestId("overlay").click({ position: { x: 5, y: 400 } });
    await expect(page.getByTestId("overlay")).toHaveCount(0);
  });

  test("a tag filters the gallery", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("gallery-image").nth(1).dispatchEvent("click");
    await expect(page).toHaveURL(/\/photo\/vrcxxxxxxb\/$/);
    await openInfo(page);
    const night = panel(page).getByTestId("info-tag").filter({ hasText: "night" });
    await expect(night).toHaveAttribute("href", "/?tag=night");
    await night.click();
    await expect(page.getByTestId("overlay")).toHaveCount(0);
    await expect(page).toHaveURL(/\/\?tag=night$/);
    await expect(page.getByTestId("gallery-image")).toHaveCount(2);
    // Back returns to the photo.
    await page.goBack();
    await expect(page).toHaveURL(/\/photo\/vrcxxxxxxb\/$/);
    await expect(page.getByTestId("overlay")).toBeVisible();
  });

  test("is in the server-rendered page of the overlay's URL", async ({
    request,
  }) => {
    // A reload of an open photo loads its page, with the same facts.
    const html = await (await request.get("/photo/vrcxxxxxxa/")).text();
    expect(html).toContain('data-testid="info-exposure"');
    expect(html).toContain("f/2.8 · 1/250 s · ISO 100 · 35 mm");
    expect(html).toContain("Fixture World");
    expect(html).toContain("2023/12/02 00:00");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a summary opens the bottom sheet", async ({ page }) => {
    await openPhoto(page, "vrcxxxxxxa");
    const p = panel(page);
    // Closed by default, with a one-line summary on the photo.
    await expect(page.getByTestId("info-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(p).not.toBeInViewport();
    const summary = page.getByTestId("info-summary");
    await expect(summary).toHaveText(
      "2023/12/02 00:00 · VirtualLens2 · Fixture World",
    );

    await summary.click();
    await expect(p).toBeInViewport();
    await expect(p.getByTestId("info-close")).toBeFocused();
    await expect(p.getByTestId("info-exposure")).toBeVisible();
    await expect(page.getByTestId("overlay")).toBeVisible();

    await p.getByTestId("info-close").click();
    await expect(p).not.toBeInViewport();

    // i toggles here too.
    await page.keyboard.press("i");
    await expect(p).toBeInViewport();
  });

  test("hidden fields are absent", async ({ page }) => {
    await openPhoto(page, "vrcxxxxxxb");
    await expect(page.getByTestId("info-summary")).toHaveText(
      "2023/12/04 · RICOH · Name Only World",
    );
    await page.getByTestId("info-toggle").click();
    const p = panel(page);
    await expect(p.getByTestId("info-exposure")).toHaveCount(0);
    await expect(p.getByTestId("info-world").getByRole("link")).toHaveCount(0);
  });
});
