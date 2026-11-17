import { expect, test } from "@playwright/test";

// The /media filter form: a modal sheet on phones (with a no-JS fallback),
// and on larger screens selects that wait for the Filter button.

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("the sheet is a modal: focus in, Escape out, focus back", async ({
    page,
  }) => {
    await page.goto("/media/");
    const trigger = page.getByRole("button", { name: "絞り込み" });
    const dialog = page.getByRole("dialog", { name: "絞り込み" });
    await expect(dialog).toBeHidden();

    await trigger.tap();
    await expect(dialog).toBeVisible();
    // Focus moved into the sheet...
    await expect
      .poll(() =>
        page.evaluate(
          () => !!document.activeElement?.closest("#media-filter-sheet"),
        ),
      )
      .toBe(true);
    // ...and stays there (the page behind is inert).
    for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest("#media-filter-sheet"),
      ),
    ).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // The ✕ closes it too.
    await trigger.tap();
    await dialog.getByRole("button", { name: "閉じる" }).tap();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("the filters are shown inline and still work", async ({ page }) => {
      await page.goto("/media/");
      const form = page.getByRole("search", { name: "Filter" });
      await expect(form).toBeVisible();
      await expect(page.getByRole("button", { name: "絞り込み" })).toBeHidden();
      // In the flow of the page, not on top of the list.
      const formBox = await form.boundingBox();
      const firstCard = await page
        .getByTestId("media-card")
        .first()
        .boundingBox();
      expect(formBox!.y + formBox!.height).toBeLessThanOrEqual(firstCard!.y);
      await form.getByLabel("World").selectOption("VRChat");
      await form.getByRole("button", { name: "Filter" }).tap();
      await expect(page).toHaveURL(/world=VRChat/);
      await expect(page.getByTestId("media-card")).toHaveCount(3);
    });
  });
});

test.describe("on a larger screen", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("stepping through a select with the keyboard does not reload the list", async ({
    page,
  }) => {
    await page.goto("/media/");
    await expect(page.locator("table tbody tr")).toHaveCount(5);
    const world = page.getByLabel("World");
    await world.focus();
    // Arrow keys on a closed select change its value (and fire `change`)
    // one step at a time.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(world).toHaveValue("VRChat");
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/media\/$/);
    await expect(page.locator("table tbody tr")).toHaveCount(5);

    // Filter applies the choice.
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/\?world=VRChat$/);
    await expect(page.locator("table tbody tr")).toHaveCount(3);
  });

  test("the empty state's Clear filters follows the current filter", async ({
    page,
  }) => {
    await page.goto("/media/?view=files&dir=/mock");
    await page.getByLabel("File contains").fill("nothing-matches");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(
      page.getByRole("heading", { name: "No media match these filters" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\?view=files&dir=\/mock$/);

    // Filtered again in place from the list: the link now clears to the
    // list, not the folder it was first rendered for.
    await page
      .getByRole("navigation", { name: "View" })
      .getByRole("link", { name: "List" })
      .click();
    await page.getByLabel("File contains").fill("nothing-matches");
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/media\/$/);
  });
});
