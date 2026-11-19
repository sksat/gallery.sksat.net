import { test, expect, type Page } from "@playwright/test";

// Swiping between photos in the overlay on a phone. Test data:
// e2e/fixture.sql; newest first the photos are vrcxxxxxxc, vrcxxxxxxb,
// reaxxxxxxb, vrcxxxxxxa, reaxxxxxxa.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

/** A one-finger drag from (x, y) by (dx, dy) in `steps` moves, as touches. */
const drag = async (
  page: Page,
  { x, y, dx, dy, steps = 8, stepMs = 16 }: {
    x: number;
    y: number;
    dx: number;
    dy: number;
    steps?: number;
    stepMs?: number;
  },
) => {
  const cdp = await page.context().newCDPSession(page);
  const point = (i: number) => [
    { x: x + (dx * i) / steps, y: y + (dy * i) / steps, id: 1 },
  ];
  // Event times are given, so the speed does not depend on how busy the
  // machine is (seconds, as CDP takes them).
  const start = Date.now() / 1000;
  const at = (i: number) => start + (i * stepMs) / 1000;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: point(0),
    timestamp: at(0),
  });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(i),
      timestamp: at(i),
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
    timestamp: at(steps),
  });
  await cdp.detach();
};

/**
 * The overlay for the photo stepped to is on screen (its summary line),
 * so the next drag lands on it rather than on the one it replaces.
 */
const shown = (page: Page, summary: string) =>
  expect(page.getByTestId("info-summary")).toHaveText(summary);

const open = async (page: Page, id: string) => {
  await page.goto(`/?photo=${id}`);
  await expect(page.getByTestId("overlay")).toBeVisible({ timeout: 10000 });
  // Resumed: the info panel's visible task has run.
  await expect(page.getByTestId("info-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  // The swipe listeners are added by a visible task; wait for them (the
  // overlay takes its touch-action then), and make a vertical drag (never
  // a step) first.
  await expect
    .poll(() =>
      page
        .getByTestId("overlay")
        .evaluate((el: HTMLElement) => el.style.touchAction),
    )
    .toBe("pan-y pinch-zoom");
  await drag(page, { x: 200, y: 500, dx: 0, dy: -100 });
  await page.waitForTimeout(300);
};

test("swipe left is the next photo, right the previous", async ({ page }) => {
  await open(page, "reaxxxxxxb");
  await drag(page, { x: 300, y: 400, dx: -200, dy: 10 });
  await expect(page).toHaveURL(/\?photo=vrcxxxxxxa$/);
  await shown(page, "2023/12/02 00:00 · VirtualLens2 · Fixture World");

  await drag(page, { x: 100, y: 400, dx: 200, dy: -10 });
  await expect(page).toHaveURL(/\?photo=reaxxxxxxb$/);
  await shown(page, "2023/12/03 00:00");
  await drag(page, { x: 100, y: 400, dx: 200, dy: 0 });
  await expect(page).toHaveURL(/\?photo=vrcxxxxxxb$/);
  // Still open: a swipe is not a tap outside.
  await expect(page.getByTestId("overlay")).toBeVisible();
});

test("a quick short flick also steps", async ({ page }) => {
  await open(page, "reaxxxxxxb");
  await drag(page, { x: 250, y: 400, dx: -40, dy: 0, steps: 2, stepMs: 10 });
  await expect(page).toHaveURL(/\?photo=vrcxxxxxxa$/);
});

test("vertical moves and short drags do not step", async ({ page }) => {
  await open(page, "reaxxxxxxb");
  await drag(page, { x: 200, y: 600, dx: 20, dy: -300 });
  await drag(page, { x: 200, y: 300, dx: -30, dy: 250 });
  // Slow and short: snaps back.
  await drag(page, { x: 200, y: 400, dx: -35, dy: 0, steps: 10, stepMs: 40 });
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(/\?photo=reaxxxxxxb$/);
  await expect(page.getByTestId("overlay")).toBeVisible();
  // The photo is back in place.
  await expect(page.getByTestId("overlay-box")).not.toHaveAttribute(
    "style",
    /translateX/,
  );
});

test("a tap outside still closes after a drag", async ({ page }) => {
  await open(page, "reaxxxxxxb");
  // Horizontal but too short and slow: snaps back.
  await drag(page, { x: 200, y: 400, dx: -35, dy: 0, steps: 10, stepMs: 40 });
  await page.waitForTimeout(700);
  await page.getByTestId("overlay").tap({ position: { x: 300, y: 650 } });
  await expect(page.getByTestId("overlay")).toHaveCount(0);
});

test("no step past the last photo, and the photo springs back", async ({
  page,
}) => {
  await open(page, "reaxxxxxxa");
  await drag(page, { x: 300, y: 400, dx: -200, dy: 0 });
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(/\?photo=reaxxxxxxa$/);
  await expect(page.getByTestId("overlay")).toBeVisible();
  await expect(page.getByTestId("overlay-box")).not.toHaveAttribute(
    "style",
    /translateX/,
  );
});

test("swipes in the open info sheet do not step", async ({ page }) => {
  await open(page, "vrcxxxxxxa");
  await page.getByTestId("info-summary").click();
  await expect(page.getByTestId("info-panel")).toBeInViewport();
  const box = await page.getByTestId("info-panel").boundingBox();
  if (!box) throw new Error("no info panel");
  await drag(page, { x: 300, y: box.y + 120, dx: -200, dy: 0 });
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(/\?photo=vrcxxxxxxa$/);
});
