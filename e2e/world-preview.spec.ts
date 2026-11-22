import { test, expect, type Page } from "@playwright/test";

import { openInOverlay } from "./open-photo";

// The card previewing a photo's VRChat world on its link. Test data:
// e2e/fixture.sql (vrcxxxxxxa links Fixture World; vrcxxxxxxb shows its
// world by name only) and the world page in public/test-media/vrchat/,
// which the local API Worker reads instead of vrchat.com.

/** Every request the page makes, to check none leaves 127.0.0.1. */
const watchRequests = (page: Page) => {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  return urls;
};

const worldLink = (page: Page) =>
  page.getByTestId("info-world").getByRole("link");
const card = (page: Page) => page.getByTestId("world-preview");

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("hovering the world link shows the card; Esc hides it first", async ({
    page,
  }) => {
    const urls = watchRequests(page);
    await openInOverlay(page, "vrcxxxxxxa");
    // Nothing is fetched until the card is wanted.
    expect(urls.filter((u) => /\/api\/media\/\w+\/world/.test(u))).toEqual(
      [],
    );
    await expect(card(page)).toBeHidden();

    await worldLink(page).hover();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText("Fixture World");
    await expect(card(page)).toContainText("by Fixture Author");
    await expect(card(page)).toContainText("A quiet room for tests.");
    await expect(worldLink(page)).toHaveAttribute(
      "aria-describedby",
      "world-preview-vrcxxxxxxa",
    );

    // Away from the link it goes.
    await page.mouse.move(5, 400);
    await expect(card(page)).toBeHidden();

    // The focus shows it too; Esc hides it and leaves the photo open,
    // and a second Esc closes the photo.
    await worldLink(page).focus();
    await expect(card(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card(page)).toBeHidden();
    await expect(page.getByTestId("overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("overlay")).toHaveCount(0);

    // Fetched once, from the site's own origin; nothing left 127.0.0.1.
    expect(
      urls.filter((u) => u.includes("/api/media/vrcxxxxxxa/world")),
    ).toHaveLength(1);
    for (const u of urls) {
      // blob: URLs (the full-size photo) are the page's own.
      if (u.startsWith("blob:")) continue;
      expect(new URL(u).hostname, u).toBe("127.0.0.1");
    }
  });

  test("a card that failed is asked for again", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/media/vrcxxxxxxa/world", (route) =>
      ++calls === 1
        ? route.fulfill({ status: 503, body: "{}" })
        : route.continue(),
    );
    await page.goto("/photo/vrcxxxxxxa/detail/");
    await worldLink(page).hover();
    await expect.poll(() => calls).toBe(1);
    await expect(card(page)).toBeHidden();
    await page.mouse.move(5, 5);
    await worldLink(page).hover();
    await expect(card(page)).toContainText("by Fixture Author");
    expect(calls).toBe(2);
  });

  test("on the photo page too", async ({ page }) => {
    await page.goto("/photo/vrcxxxxxxa/detail/");
    await worldLink(page).hover();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText("by Fixture Author");
  });

  test("no card for a world shown by name only", async ({ page }) => {
    await page.goto("/photo/vrcxxxxxxb/detail/");
    await expect(page.getByTestId("info-world")).toContainText(
      "Name Only World",
    );
    await expect(worldLink(page)).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
    // And the API gives none for it.
    expect(
      (await page.request.get("/api/media/vrcxxxxxxb/world")).status(),
    ).toBe(404);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a button beside the link shows and hides the card", async ({
    page,
  }) => {
    await page.goto("/photo/vrcxxxxxxa/detail/");
    const toggle = page.getByTestId("world-preview-toggle");
    await expect(toggle).toBeVisible();
    await toggle.tap();
    await expect(card(page)).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(card(page)).toContainText("Fixture World");
    // A tap elsewhere hides it.
    await page.getByRole("heading", { level: 1 }).tap();
    await expect(card(page)).toBeHidden();
  });
});
