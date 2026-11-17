import { expect, test } from "@playwright/test";

test("media list: renders fixture rows and filters by world", async ({ page }) => {
  const response = await page.goto("/media/");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { name: /Media \(5\)/ })).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(5);

  await page.locator('select[name="world"]').selectOption("VRChat");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/world=VRChat/);
  await expect(page.locator("table tbody tr")).toHaveCount(3);

  await page.getByRole("link", { name: "Reset" }).click();
  await expect(page.locator("table tbody tr")).toHaveCount(5);
});

test("media list: search by file substring", async ({ page }) => {
  await page.goto("/media/");
  await page.locator('input[name="q"]').fill("vrchat1");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.locator("table tbody tr")).toHaveCount(1);
  await expect(page.locator("table tbody")).toContainText("/mock/vrchat1.png");
});

test("media list: an out-of-range page redirects to the last page", async ({
  page,
}) => {
  await page.goto("/media/?world=VRChat&page=3");
  await expect(page).toHaveURL(/\/media\/\?world=VRChat$/);
  await expect(page.locator("table tbody tr")).toHaveCount(3);
  await expect(page.getByText("Page 1 / 1")).toBeVisible();
});

test("media list: the whole row opens the edit page", async ({ page }) => {
  await page.goto("/media/?q=vrchat1");
  // Click over the World cell, not the filename text. The stretched link
  // overlays the whole row, so Playwright's actionability check would
  // (correctly) report the cell as covered; click by coordinates instead.
  // Columns: checkbox, ID, thumbnail, File, Status, ...
  const cell = page.locator("table tbody tr").first().locator("td").nth(4);
  const box = await cell.boundingBox();
  if (!box) throw new Error("Status cell not rendered");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/media\/2\/$/);
  await expect(page.getByRole("heading", { name: "Edit #2" })).toBeVisible();
});

test.describe("media list on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("renders cards without horizontal overflow", async ({ page }) => {
    await page.goto("/media/");
    await expect(page.locator("table")).toBeHidden();
    const cards = page.getByRole("listitem");
    await expect(cards).toHaveCount(5);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    await cards.filter({ hasText: "vrchat1.png" }).click();
    await expect(page.getByRole("heading", { name: "Edit #2" })).toBeVisible();
  });
});

test("thumbnails: when off, placeholders and no image requests", async ({
  page,
}) => {
  // start-test-server.sh blanks THUMBNAILS. The list and the edit page
  // must then show placeholder tiles and never fetch any image (in
  // particular not the multi-MB originals).
  const imageRequests: string[] = [];
  page.on("request", (req) => {
    if (req.resourceType() === "image") imageRequests.push(req.url());
  });

  await page.goto("/media/");
  // Table + phone cards each render one tile per row.
  await expect(page.getByTestId("thumb-placeholder")).toHaveCount(10);
  await expect(page.locator("main img")).toHaveCount(0);

  await page.goto("/media/2/");
  await expect(page.getByTestId("thumb-placeholder")).toHaveCount(1);
  await expect(page.getByText("Preview off")).toBeVisible();
  expect(imageRequests).toEqual([]);
});

test("thumbnails: /thumb is a 404 when thumbnails are off", async ({
  request,
}) => {
  // The route exists (behind Access like every other); without the image
  // Worker it serves nothing, and never an original.
  const res = await request.get("/thumb/h240/mock/real1.png");
  expect(res.status()).toBe(404);
});
