import { expect, test } from "@playwright/test";

// Files view of /media (?view=files&dir=...). Fixture: 5 rows, all under
// /mock/ (2 Real, 3 VRChat).

test("media files: switch view, choose a folder, open a photo", async ({
  page,
}) => {
  await page.goto("/media/");
  const views = page.getByRole("navigation", { name: "View" });
  await expect(views.getByRole("link", { name: "List" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await views.getByRole("link", { name: "Files" }).click();
  await expect(page).toHaveURL(/\/media\/\?view=files$/);
  await expect(page.locator("table")).toHaveCount(0);

  const tree = page.getByRole("navigation", { name: "Folders" });
  await expect(tree.getByRole("link", { name: /All files/ })).toHaveAttribute(
    "aria-current",
    "location",
  );
  // The root has no files of its own, just the "mock" folder.
  await expect(page.getByTestId("file-tile")).toHaveCount(0);
  await expect(page.getByTestId("folder-tile")).toHaveText(/mock\s*5/);

  await tree.getByRole("link", { name: /^mock/ }).click();
  await expect(page).toHaveURL(/\/media\/\?view=files&dir=\/mock$/);
  await expect(tree.getByRole("link", { name: /^mock/ })).toHaveAttribute(
    "aria-current",
    "location",
  );
  const tiles = page.getByTestId("file-tile");
  await expect(tiles).toHaveCount(5);
  // Sorted by file name, names under the tiles.
  await expect(tiles.first()).toContainText("real1.png");
  await expect(tiles.last()).toContainText("vrchat3.png");

  // The view and folder survive a reload.
  await page.reload();
  await expect(page.getByTestId("file-tile")).toHaveCount(5);

  await tiles.filter({ hasText: "vrchat1.png" }).click();
  await expect(page).toHaveURL(/\/media\/2\/$/);
  await expect(page.getByRole("heading", { name: "Edit #2" })).toBeVisible();

  // ...and back.
  await page.goBack();
  await expect(page).toHaveURL(/dir=\/mock$/);
  await expect(page.getByTestId("file-tile")).toHaveCount(5);
});

test("media files: the tree is keyboard navigable", async ({ page }) => {
  await page.goto("/media/?view=files");
  const tree = page.getByRole("navigation", { name: "Folders" });
  await tree.getByRole("link", { name: /All files/ }).focus();
  await page.keyboard.press("Tab");
  await expect(tree.getByRole("link", { name: /^mock/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/dir=\/mock$/);
  await expect(page.getByTestId("file-tile")).toHaveCount(5);
});

test("media files: the filter applies and keeps the view and folder", async ({
  page,
}) => {
  await page.goto("/media/?view=files&dir=/mock");
  await page.locator('select[name="world"]').selectOption("VRChat");
  await page.getByRole("button", { name: "Filter" }).click();
  // (A GET form escapes the slash; both spellings are the same query.)
  await expect(page).toHaveURL(/view=files&dir=(\/|%2F)mock&world=VRChat/);
  await expect(page.getByTestId("file-tile")).toHaveCount(3);
  const tree = page.getByRole("navigation", { name: "Folders" });
  await expect(tree.getByRole("link", { name: /^mock/ })).toContainText("3");

  // Switching to the list keeps the filter, not the folder.
  await page
    .getByRole("navigation", { name: "View" })
    .getByRole("link", { name: "List" })
    .click();
  await expect(page).toHaveURL(/\/media\/\?world=VRChat$/);
  await expect(page.locator("table tbody tr")).toHaveCount(3);
});

test("media files: an unknown folder says so", async ({ page }) => {
  await page.goto("/media/?view=files&dir=/nope");
  await expect(
    page.getByRole("heading", { name: "No such folder" }),
  ).toBeVisible();
});

test.describe("media files on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the tree is collapsed behind a disclosure", async ({ page }) => {
    await page.goto("/media/?view=files");
    const tree = page.getByRole("navigation", { name: "Folders" });
    const disclosure = page.locator("details", { hasText: "Folders" });
    await expect(disclosure).not.toHaveAttribute("open");
    await expect(tree).toBeHidden();

    await page.locator("summary", { hasText: "Folders" }).click();
    await tree.getByRole("link", { name: /^mock/ }).click();
    await expect(page).toHaveURL(/dir=\/mock$/);
    await expect(page.getByTestId("file-tile")).toHaveCount(5);
    // Closed again, so the grid is not pushed down by the tree.
    await expect(disclosure).not.toHaveAttribute("open");

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
