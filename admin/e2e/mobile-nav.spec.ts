import { expect, test, type Page } from "@playwright/test";

// Phone navigation: the tab bar and menu, the filter sheet, coming back to
// the same place in the list, and the camera pictures.
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

const cards = (page: Page) => page.getByTestId("media-card");

test("tab bar and the header menu", async ({ page }) => {
  await page.goto("/camera/");
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link", { name: "Cameras" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // In thumb reach: along the bottom of the screen.
  const box = await tabs.boundingBox();
  expect(box!.y + box!.height).toBeGreaterThan(800);

  await tabs.getByRole("link", { name: "Media" }).tap();
  await expect(page.getByRole("heading", { name: /^Media/ })).toBeVisible();

  // The theme toggle lives in the menu.
  await expect(page.getByRole("button", { name: /^Theme:/ })).toBeHidden();
  await page.getByLabel("Menu", { exact: true }).tap();
  await page.getByRole("button", { name: /^Theme:/ }).tap();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("filter sheet: selects apply at once, chips remove a filter", async ({
  page,
}) => {
  await page.goto("/media/");
  const sheet = page.getByRole("search", { name: "Filter" });
  await expect(sheet).toBeHidden();

  await page.getByRole("button", { name: "絞り込み" }).tap();
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Platform").selectOption("VRChat");
  await expect(page).toHaveURL(/\?platform=VRChat$/);
  await expect(cards(page)).toHaveCount(3);
  // Still open for the next filter.
  await sheet.getByLabel("Visibility").selectOption("public");
  await expect(page).toHaveURL(/\?platform=VRChat&visibility=public$/);
  await sheet.getByRole("button", { name: "閉じる" }).tap();
  await expect(sheet).toBeHidden();

  await expect(
    page.getByRole("button", { name: "絞り込み (2)" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Public の絞り込みを外す" }).tap();
  await expect(page).toHaveURL(/\?platform=VRChat$/);
  await page.getByRole("link", { name: "VRChat の絞り込みを外す" }).tap();
  await expect(cards(page)).toHaveCount(5);

  // The search box applies with Enter and closes the sheet.
  await page.getByRole("button", { name: "絞り込み" }).tap();
  await sheet.getByLabel("File contains").fill("real");
  await sheet.getByLabel("File contains").press("Enter");
  await expect(page).toHaveURL(/\?q=real$/);
  await expect(sheet).toBeHidden();
  await expect(cards(page)).toHaveCount(2);
});

test("back from a photo returns to it in the list", async ({ page }) => {
  await page.goto("/media/");
  // The last card is below the fold.
  const last = cards(page).last();
  await last.scrollIntoViewIfNeeded();
  await last.getByText("real1.png").tap();
  await expect(page.getByRole("heading", { name: "Edit #1" })).toBeVisible();

  await page.getByRole("link", { name: "← Media" }).tap();
  await expect(page).toHaveURL(/\/media\/#m-1$/);
  await expect(cards(page).filter({ hasText: "real1.png" })).toBeInViewport();
});

test("camera pictures: short paths, auto-saved captions, reorder, undo remove", async ({
  page,
}) => {
  const slug = `e2e-m-${Date.now().toString(36)}`;
  await page.goto("/camera/new/");
  await page.getByLabel("Name").fill("E2E Mobile");
  await page.getByLabel("Slug").fill(slug);
  await page.getByRole("button", { name: "Create" }).tap();
  await expect(page.getByText("Camera created.")).toBeVisible();

  const images = page.getByTestId("camera-image");
  const add = async (file: string) => {
    await page.getByLabel("Image path").fill(file);
    await page.getByRole("button", { name: "Add image" }).tap();
  };
  // A bare file name goes in the camera's folder.
  await add("a.png");
  await expect(images).toHaveCount(1);
  await expect(images.nth(0)).toContainText(`/camera/${slug}/a.png`);
  await add("b.png");
  await expect(images).toHaveCount(2);
  await add("c.png");
  await expect(images).toHaveCount(3);

  // Captions save when the field is left.
  const caption = page.getByRole("textbox", { name: "Caption of image 2" });
  await caption.fill("Bee");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && !r.url().includes("/api/metadata/"),
    ),
    caption.blur(),
  ]);
  await expect(page.getByRole("status")).toHaveText("Caption saved.");
  // Enter saves too, once.
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && !r.url().includes("/api/metadata/")) posts++;
  });
  await caption.fill("Bee 2");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && !r.url().includes("/api/metadata/"),
    ),
    caption.press("Enter"),
  ]);
  await page.waitForTimeout(500);
  expect(posts).toBe(1);
  await caption.fill("Bee");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && !r.url().includes("/api/metadata/"),
    ),
    caption.blur(),
  ]);

  // ↑ / ↓ only in the reorder mode.
  const up = page.getByRole("button", { name: "Move image 3 up" });
  await expect(up).toBeHidden();
  await page.getByRole("button", { name: "並べ替え" }).tap();
  await up.tap();
  await expect(images.nth(1)).toContainText("c.png");
  await page.getByRole("button", { name: "完了" }).tap();
  await expect(up).toBeHidden();

  // Remove the middle one (c.png), then undo: back in the middle.
  await page.getByRole("button", { name: "Remove image 2" }).tap();
  await expect(images).toHaveCount(2);
  await page.getByRole("button", { name: "元に戻す" }).tap();
  await expect(page.getByRole("status")).toHaveText("元に戻しました。");
  await expect(images).toHaveCount(3);
  await expect(images.nth(1)).toContainText("c.png");
  await expect(images.nth(2)).toContainText("b.png");
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Caption of image 3" }),
  ).toHaveValue("Bee");
});
