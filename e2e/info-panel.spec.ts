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

/** The details are shown (as they are until the viewer closes them). */
const expectShown = async (page: Page) => {
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
    await expectShown(page);
    // The date heads the summary line, the details' first line.
    const date = page.getByTestId("info-taken").locator("time");
    await expect(date).toBeVisible();
    await expect(date).toHaveText("2023/12/02 00:00");
    await expect(date).toHaveAttribute("datetime", "2023-12-02T00:00Z");
    const camera = p.getByTestId("info-camera");
    await expect(camera.getByRole("link", { name: "VirtualLens2" })).toHaveAttribute(
      "href",
      "/camera/virtuallens2/",
    );
    await expect(camera).toContainText("Canon EOS R5");
    await expect(p.getByTestId("info-lens")).toHaveText(
      "RF35mm F1.8 MACRO IS STM",
    );
    await expect(p.getByTestId("info-exposure-value")).toHaveText([
      "f/2.8",
      "1/250 s",
      "ISO 100",
      "35 mm",
    ]);
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
    await expectShown(page);
    await expect(page.getByTestId("info-taken").locator("time")).toHaveText(
      "2023/12/04",
    );
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
    await expectShown(page);
    // Only to the city: two decimals, said so.
    await expect(p.getByTestId("info-location")).toContainText("35.66");
    await expect(p.getByTestId("info-location")).toContainText(
      "市区町村くらい",
    );
    await expect(p.getByTestId("info-location")).not.toContainText("35.658");
    await expect(p.getByTestId("info-camera")).toHaveCount(0);
    await expect(p.getByTestId("info-exposure-value")).toHaveText([
      "f/5.6",
      "1/1000 s",
      "ISO 200",
      "18.3 mm",
    ]);
    await expect(p.getByTestId("info-file")).toHaveCount(0);
    await expect(p.getByTestId("info-world")).toHaveCount(0);
    // The API leaves out the lens, the body and the camera altogether.
    expect(await page.content()).not.toContain("GR LENS");
    await expect(p).not.toContainText("RICOH");
    await expect(p).not.toContainText("GR III");

    await openPhoto(page, "reaxxxxxxa");
    await expectShown(page);
    await expect(page.getByTestId("info-taken").locator("time")).toHaveText(
      "2023/12/01 00:00",
    );
    // Its place, linking to the map on it.
    const place = p.getByTestId("info-location").getByRole("link");
    await expect(place).toHaveText(/35\.68/);
    await expect(place).toHaveAttribute("href", "/map/?photo=reaxxxxxxa");
  });

  test("a tag's fields, under the tag; hidden and private ones absent", async ({
    page,
  }) => {
    await openPhoto(page, "reaxxxxxxa");
    const p = panel(page);
    await expectShown(page);
    const group = p.getByTestId("info-tag-fields");
    await expect(group).toHaveCount(1);
    await expect(group.locator("> dt")).toHaveText("film");
    await expect(group.locator("dd dt")).toHaveText(["銘柄", "ISO"]);
    await expect(group.locator("dd dd")).toHaveText([
      "Kodak Portra 400",
      "400",
    ]);
    // ラボ is hidden by default.
    expect(await page.content()).not.toContain("Fixture Lab");
    // The private tag "draft"'s field, on vrcxxxxxxc.
    await openPhoto(page, "vrcxxxxxxc");
    await expectShown(page);
    await expect(p.getByTestId("info-tag-fields")).toHaveCount(0);
    expect(await page.content()).not.toContain("draft memo");
  });

  test("under the photo, which stays centred and where it is", async ({
    page,
  }) => {
    const photo = page.getByTestId("overlay-box");
    // 16:9 and 3:4 alike: the block at the bottom left under the photo.
    for (const id of ["vrcxxxxxxa", "reaxxxxxxa"]) {
      await openPhoto(page, id);
      await expectShown(page);
      const box = (await photo.boundingBox())!;
      const block = (await page
        .getByTestId("info-summary")
        .locator("..")
        .boundingBox())!;
      expect(box.x + box.width / 2).toBeCloseTo(640, 0);
      expect(block.y).toBeGreaterThanOrEqual(box.y + box.height);
      expect(block.x).toBeLessThan(20);
    }

    // Closed, the photo stays where it was.
    const shown = await photo.boundingBox();
    await page.getByTestId("info-toggle").click();
    await expect(panel(page)).toBeHidden();
    expect(await photo.boundingBox()).toEqual(shown);
  });

  test("i, the button and the summary close and open the details, remembered", async ({
    page,
  }) => {
    await openPhoto(page, "vrcxxxxxxa");
    const p = panel(page);
    const toggle = page.getByTestId("info-toggle");
    const summary = page.getByTestId("info-summary");

    // Open at first, under the summary line, which stays when they close.
    await expectShown(page);
    await expect(summary).toHaveText(
      "撮影日時 2023/12/02 00:00 · Fixture World · VirtualLens2 · f/2.8 1/250 s ISO 100 35 mm",
    );
    await summary.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(p).toBeHidden();
    await expect(summary).toBeVisible();
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await summary.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(summary).toBeVisible();

    // Open, it stays open on the next photo.
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/\/photo\/reaxxxxxxa\//);
    await expect(page.getByTestId("info-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(/\/photo\/vrcxxxxxxa\//);
    await expect(page.getByTestId("info-taken")).toHaveText(
      /2023\/12\/02 00:00/,
    );
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Closed, it stays closed on the next photo, on reopening and on a
    // reload.
    await page.keyboard.press("i");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowRight");
    // Newest first: vrcxxxxxxa is followed by reaxxxxxxa.
    await expect(page).toHaveURL(/\/photo\/reaxxxxxxa\//);
    await expect(page.getByTestId("info-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.getByTestId("overlay").click({ position: { x: 5, y: 400 } });
    await expect(page.getByTestId("overlay")).toHaveCount(0);
    await page.getByTestId("gallery-image").nth(3).dispatchEvent("click");
    await expect(page.getByTestId("info-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.reload();
    await expect(page.getByTestId("info-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(p).toBeHidden();

    // The button shows it again; clicks on it do not close the photo.
    await page.getByTestId("info-toggle").click();
    await expect(page.getByTestId("info-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(p).toBeInViewport();
    await p.getByTestId("info-camera").click();
    await expect(page.getByTestId("overlay")).toBeVisible();

    // `i` with the focus in the panel hides it and hands the focus to the
    // button.
    await p.getByTestId("info-tag").focus();
    await page.keyboard.press("i");
    await expect(page.getByTestId("info-toggle")).toBeFocused();
    await expect(p).toBeHidden();
    await page.keyboard.press("i");
    await expect(p).toBeInViewport();

    // Arrows still browse; a click outside still closes.
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(/\/photo\/reaxxxxxxb\//);
    await page.getByTestId("overlay").click({ position: { x: 5, y: 400 } });
    await expect(page.getByTestId("overlay")).toHaveCount(0);
  });

  test("a tag filters the gallery", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("gallery-image").nth(1).dispatchEvent("click");
    await expect(page).toHaveURL(/\/photo\/vrcxxxxxxb\/$/);
    await expectShown(page);
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

  test("without JS the details show, under the photo", async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.goto("/photo/vrcxxxxxxa/");
    await expect(panel(page)).toBeVisible();
    await expect(page.getByTestId("info-summary")).toBeVisible();
    const box = (await page.getByTestId("overlay-box").boundingBox())!;
    const info = (await panel(page).boundingBox())!;
    expect(info.y).toBeGreaterThanOrEqual(box.y + box.height);
    await context.close();
  });

  test("is in the server-rendered page of the overlay's URL", async ({
    request,
  }) => {
    // A reload of an open photo renders the overlay with its info: the
    // details and the summary, the screen's width choosing between them.
    const html = await (await request.get("/photo/vrcxxxxxxa/")).text();
    expect(html).toContain('data-testid="overlay"');
    expect(html).toContain('data-testid="info-exposure"');
    expect(html).toContain('data-testid="info-summary"');
    for (const part of ["f/2.8", "1/250 s", "35 mm", "シャッター"]) {
      expect(html).toContain(part);
    }
    expect(html).toContain("Fixture World");
    expect(html).toContain("2023/12/02 00:00");
  });
});

test.describe("short wide screen", () => {
  test.use({ viewport: { width: 1366, height: 480 } });

  test("the photo keeps most of the height; the info never over it", async ({
    page,
  }) => {
    await openPhoto(page, "reaxxxxxxa");
    await expectShown(page);
    const box = (await page.getByTestId("overlay-box").boundingBox())!;
    const block = (await page
      .getByTestId("info-summary")
      .locator("..")
      .boundingBox())!;
    expect(box.height).toBeGreaterThan(480 * 0.55);
    expect(block.y).toBeGreaterThanOrEqual(box.y + box.height);
    expect(block.y + block.height).toBeLessThanOrEqual(480);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the info right under the centred photo, its date in view", async ({
    page,
  }) => {
    for (const id of ["vrcxxxxxxa", "reaxxxxxxa"]) {
      await openPhoto(page, id);
      await expectShown(page);
      const photo = (await page.getByTestId("overlay-box").boundingBox())!;
      // Its first line: the summary, headed by the date.
      const date = (await page.getByTestId("info-taken").boundingBox())!;
      // The photo in the middle of the first screen (the progress bar
      // under it is in the centring too).
      expect(Math.abs(photo.y + photo.height / 2 - 844 / 2)).toBeLessThan(12);
      // The info right under it, its date on the first screen (a tall
      // photo leaves room for it).
      expect(date.y).toBeGreaterThanOrEqual(photo.y + photo.height);
      expect(date.y + date.height).toBeLessThan(844);
    }
    // Landscape: the rest of the info is in view too.
    await openPhoto(page, "vrcxxxxxxa");
    const p = panel(page);
    await expect(p.getByTestId("info-exposure")).toBeInViewport();

    // The button hides it; `i` too.
    await page.getByTestId("info-toggle").click();
    await expect(p).toBeHidden();
    await expect(page.getByTestId("overlay")).toBeVisible();
    await page.keyboard.press("i");
    await expect(p).toBeInViewport();
  });

  test("hidden fields are absent", async ({ page }) => {
    await openPhoto(page, "vrcxxxxxxb");
    const p = panel(page);
    await expectShown(page);
    await expect(page.getByTestId("info-taken").locator("time")).toHaveText(
      "2023/12/04",
    );
    await expect(p.getByTestId("info-exposure")).toHaveCount(0);
    await expect(p.getByTestId("info-world").getByRole("link")).toHaveCount(0);
  });
});
