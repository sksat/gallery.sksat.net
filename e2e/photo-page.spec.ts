import { test, expect, type Page } from "@playwright/test";

import { openInOverlay, VIRTUALLENS2_ORDER } from "./open-photo";

// A photo's detail page, /photo/<id>/detail/. Test data: e2e/fixture.sql (see the
// table in gallery.spec.ts and info-panel.spec.ts). Newest first, the
// VRChat photos are vrcxxxxxxc, vrcxxxxxxb, vrcxxxxxxa.

const detail = (page: Page) => page.getByTestId("photo-detail");

/**
 * The page has resumed (its visible tasks ran: the photo area took its
 * touch-action), so a key press reaches its handlers.
 */
const resumed = (page: Page) =>
  expect
    .poll(() =>
      page
        .getByTestId("photo-area")
        .evaluate((el: HTMLElement) => el.style.touchAction),
    )
    .toBe("pan-y pinch-zoom");

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("list → overlay → detail page, keeping the list", async ({ page }) => {
    await page.goto("/?tag=VRChat");
    await expect(page.getByTestId("gallery-image")).toHaveCount(3, {
      timeout: 10000,
    });
    await page.getByTestId("gallery-image").nth(1).dispatchEvent("click");
    await expect(page).toHaveURL(/\/photo\/vrcxxxxxxb\/\?tag=VRChat$/);
    await expect(page.getByTestId("overlay")).toBeVisible();

    // The page button loads the detail page, within the same list.
    await page.getByTestId("detail-link").click();
    await expect(detail(page)).toBeVisible();
    await expect(page.getByTestId("overlay")).toHaveCount(0);
    await expect(page).toHaveURL(/\/photo\/vrcxxxxxxb\/detail\/\?tag=VRChat$/);

    // Previous / next within the VRChat photos, and back to that list.
    await expect(page.getByTestId("prev-link")).toHaveAttribute(
      "href",
      "/photo/vrcxxxxxxc/detail/?tag=VRChat",
    );
    await expect(page.getByTestId("next-link")).toHaveAttribute(
      "href",
      "/photo/vrcxxxxxxa/detail/?tag=VRChat",
    );
    await expect(page.getByTestId("back-link")).toHaveAttribute(
      "href",
      "/?tag=VRChat",
    );

    // The arrow keys step like the links.
    await resumed(page);
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/\/photo\/vrcxxxxxxa\/detail\/\?tag=VRChat$/);
    await expect(page.getByTestId("next-link")).toHaveCount(0);
    await resumed(page);
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(/\/photo\/vrcxxxxxxb\/detail\/\?tag=VRChat$/);

    await page.getByTestId("back-link").click();
    await expect(page).toHaveURL(/\/\?tag=VRChat$/);
    await expect(page.getByTestId("gallery-image")).toHaveCount(3);
  });

  test("Enter in the overlay opens the detail page", async ({ page }) => {
    await openInOverlay(
      page,
      "vrcxxxxxxc",
      "/camera/virtuallens2/",
      VIRTUALLENS2_ORDER,
    );
    // Resumed: the info panel answers its key.
    await page.keyboard.press("i");
    await expect(page.getByTestId("info-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      /\/photo\/vrcxxxxxxc\/detail\/\?camera=virtuallens2$/,
    );
    await expect(page.getByTestId("back-link")).toHaveText("← VirtualLens2");
    await expect(page.getByTestId("back-link")).toHaveAttribute(
      "href",
      "/camera/virtuallens2/",
    );
    await expect(detail(page)).toBeVisible();
    // Back returns to the photo open over the camera's list.
    await page.goBack();
    await expect(page).toHaveURL(
      /\/photo\/vrcxxxxxxc\/\?camera=virtuallens2$/,
    );
    await expect(page.getByTestId("overlay")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("gallery-image")).toHaveCount(2);
    await expect(page.getByTestId("camera-header")).toBeVisible();
  });

  test("the page button on a camera page keeps the camera", async ({
    page,
  }) => {
    await openInOverlay(page, "vrcxxxxxxa", "/camera/virtuallens2/?sort=old", [
      ...VIRTUALLENS2_ORDER,
    ].reverse());
    await page.getByTestId("detail-link").click();
    await expect(page).toHaveURL(
      /\/photo\/vrcxxxxxxa\/detail\/\?camera=virtuallens2&sort=old$/,
    );
    // Oldest first within the camera: vrcxxxxxxa, then vrcxxxxxxc.
    await expect(page.getByTestId("prev-link")).toHaveCount(0);
    await expect(page.getByTestId("next-link")).toHaveAttribute(
      "href",
      "/photo/vrcxxxxxxc/detail/?camera=virtuallens2&sort=old",
    );
  });

  test("Enter on a focused link follows it, not the page", async ({
    page,
  }) => {
    await openInOverlay(page, "vrcxxxxxxa");
    const tag = page.getByTestId("info-tag");
    // The info is shown from the start.
    await expect(page.getByTestId("info-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await tag.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/\?tag=VRChat$/);
    await expect(page.getByTestId("overlay")).toHaveCount(0);
  });

  test("everything public about the photo", async ({ page }) => {
    await page.goto("/photo/vrcxxxxxxa/detail/");
    const d = detail(page);
    // The date heads the page.
    await expect(d.getByRole("heading", { level: 1 })).toHaveText(
      "2023/12/02 00:00",
    );
    await expect(d.getByTestId("info-taken").locator("time")).toHaveAttribute(
      "datetime",
      "2023-12-02T00:00Z",
    );
    await expect(d.getByTestId("info-exposure-value")).toHaveText([
      "f/2.8",
      "1/250 s",
      "100",
      "35 mm",
    ]);
    await expect(
      d.getByTestId("info-world").getByRole("link", { name: "Fixture World" }),
    ).toHaveAttribute("href", /vrchat\.com\/home\/world\/wrld_0123abcd/);
    await expect(d.getByTestId("info-file")).toHaveText(
      "ファイル名/mock/vrchat1.png",
    );
    // The camera, with its picture and page.
    const card = d.getByTestId("camera-card");
    await expect(card.getByRole("link", { name: "VirtualLens2" })).toHaveAttribute(
      "href",
      "/camera/virtuallens2/",
    );
    await expect(card.locator("img")).toHaveAttribute(
      "src",
      /camera\/virtuallens2\/front\.png$/,
    );
    // The day it was taken, in its month, linking to that day's photos.
    const calendar = d.getByTestId("mini-calendar");
    await expect(calendar).toContainText("2023年12月");
    await expect(
      calendar.getByRole("link", { name: "12月2日の写真" }),
    ).toHaveAttribute("href", "/?date=2023-12-02");
    // A VRChat photo has no place: no map.
    await expect(d.getByTestId("mini-map")).toHaveCount(0);
    // A tag goes to the list filtered by it.
    await expect(d.getByTestId("info-tag")).toHaveAttribute(
      "href",
      "/?tag=VRChat",
    );
    await d.getByTestId("info-tag").click();
    await expect(page).toHaveURL(/\/\?tag=VRChat$/);
    await expect(page.getByTestId("gallery-image")).toHaveCount(3);
  });

  test("hidden fields are absent", async ({ page }) => {
    await page.goto("/photo/vrcxxxxxxb/detail/");
    const d = detail(page);
    await expect(d.getByTestId("info-taken")).toHaveText("2023/12/04");
    // Maker only: no camera page, so no card.
    await expect(d.getByTestId("info-camera")).toHaveText("カメラRICOH");
    await expect(d.getByTestId("camera-card")).toHaveCount(0);
    await expect(d.getByTestId("info-exposure")).toHaveCount(0);
    await expect(d.getByTestId("info-world").getByRole("link")).toHaveCount(0);
    await expect(
      d
        .getByTestId("mini-calendar")
        .getByRole("link", { name: "12月4日の写真" }),
    ).toHaveAttribute("href", "/?date=2023-12-04");

    await page.goto("/photo/reaxxxxxxb/detail/");
    await expect(d.getByTestId("info-camera")).toHaveCount(0);
    await expect(d.getByTestId("camera-card")).toHaveCount(0);
    await expect(d.getByTestId("info-file")).toHaveCount(0);
    await expect(d.getByTestId("info-tag-fields")).toHaveCount(0);
  });

  test("a tag's fields", async ({ page }) => {
    await page.goto("/photo/reaxxxxxxa/detail/");
    const group = detail(page).getByTestId("info-tag-fields");
    await expect(group).toContainText("film");
    await expect(group).toContainText("銘柄Kodak Portra 400");
    await expect(group).toContainText("ISO400");
    await expect(group).not.toContainText("ラボ");
  });

  test("its place on a small map, and an unlisted photo's day", async ({
    page,
  }) => {
    // reaxxxxxxa's exact place: the whole map links to /map/ on it, and
    // the place is not listed a second time.
    await page.goto("/photo/reaxxxxxxa/detail/");
    const map = detail(page).getByTestId("mini-map");
    await expect(map.getByRole("link")).toHaveAttribute(
      "href",
      "/map/?photo=reaxxxxxxa",
    );
    // The title names the place too, linking to the same map.
    await expect(
      detail(page).getByTestId("info-location").getByRole("link"),
    ).toHaveAttribute("href", "/map/?photo=reaxxxxxxa");
    // reaxxxxxxb only to the city.
    await page.goto("/photo/reaxxxxxxb/detail/");
    await expect(
      detail(page).getByTestId("mini-map").getByRole("link"),
    ).toHaveAttribute("aria-label", /市区町村くらい/);

    // The unlisted photo is on no day's list: its day is marked, unlinked.
    await page.goto("/photo/unxxxxxxxx/detail/");
    const calendar = detail(page).getByTestId("mini-calendar");
    await expect(calendar).toContainText("2023年12月");
    await expect(calendar.getByRole("link", { name: /12月6日/ })).toHaveCount(
      0,
    );
  });

  test("is server-rendered in full", async ({ request }) => {
    const html = await (
      await request.get("/photo/vrcxxxxxxb/detail/?tag=VRChat")
    ).text();
    expect(html).toContain('data-testid="photo-detail"');
    expect(html).toContain("2023/12/04");
    expect(html).toContain('href="/photo/vrcxxxxxxc/detail/?tag=VRChat"');
    expect(html).toContain('href="/photo/vrcxxxxxxa/detail/?tag=VRChat"');
    expect(html).toContain('href="/?tag=VRChat"');
    expect(html).toContain("Name Only World");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("swipes step through the list", async ({ page }) => {
    await page.goto("/photo/vrcxxxxxxb/detail/?tag=VRChat");
    await expect(detail(page)).toBeVisible({ timeout: 10000 });
    // The swipe listeners are in place once the photo area takes its
    // touch-action.
    const area = page.getByTestId("photo-area");
    await expect
      .poll(() => area.evaluate((el: HTMLElement) => el.style.touchAction))
      .toBe("pan-y pinch-zoom");
    const box = await page.getByTestId("overlay-box").boundingBox();
    if (!box) throw new Error("no photo");
    const y = box.y + box.height / 2;

    const cdp = await page.context().newCDPSession(page);
    const swipe = async (from: number, dx: number) => {
      const start = Date.now() / 1000;
      const steps = 8;
      const at = (i: number) => start + (i * 16) / 1000;
      const pt = (i: number) => [{ x: from + (dx * i) / steps, y, id: 1 }];
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: pt(0),
        timestamp: at(0),
      });
      for (let i = 1; i <= steps; i++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: pt(i),
          timestamp: at(i),
        });
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
        timestamp: at(steps),
      });
    };

    await swipe(300, -200);
    await expect(page).toHaveURL(/\/photo\/vrcxxxxxxa\/detail\/\?tag=VRChat$/);
  });

  test("a swipe right is the previous photo", async ({ page }) => {
    await page.goto("/photo/vrcxxxxxxb/detail/?tag=VRChat");
    await expect(detail(page)).toBeVisible({ timeout: 10000 });
    const area = page.getByTestId("photo-area");
    await expect
      .poll(() => area.evaluate((el: HTMLElement) => el.style.touchAction))
      .toBe("pan-y pinch-zoom");
    const box = await page.getByTestId("overlay-box").boundingBox();
    if (!box) throw new Error("no photo");
    const y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const start = Date.now() / 1000;
    const pt = (i: number) => [{ x: 80 + 25 * i, y, id: 1 }];
    const at = (i: number) => start + (i * 16) / 1000;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: pt(0),
      timestamp: at(0),
    });
    for (let i = 1; i <= 8; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: pt(i),
        timestamp: at(i),
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
      timestamp: at(8),
    });
    await expect(page).toHaveURL(/\/photo\/vrcxxxxxxc\/detail\/\?tag=VRChat$/);
  });

  test("the photo comes first, then its details", async ({ page }) => {
    await page.goto("/photo/vrcxxxxxxa/detail/");
    await expect(detail(page)).toBeVisible({ timeout: 10000 });
    const photo = await page.getByTestId("overlay-box").boundingBox();
    const info = await page.getByTestId("info-taken").boundingBox();
    if (!photo || !info) throw new Error("missing");
    expect(info.y).toBeGreaterThan(photo.y + photo.height);
  });
});
