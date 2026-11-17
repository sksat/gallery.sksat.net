import { expect, test, type Page } from "@playwright/test";

// Fixture (e2e/fixture.sql): rows 1-3 public, 4 unlisted, 5 private.
// Tests that change visibility restore it in `finally` (see the note in
// media-edit.spec.ts about reused servers).

const rows = (page: Page) => page.locator("table tbody tr");

const bulkSet = async (page: Page, ids: number[], visibility: string) => {
  await page.goto("/media/");
  for (const id of ids) {
    await page.getByRole("checkbox", { name: `Select #${id}`, exact: true }).check();
  }
  await page.locator("#bulk-visibility").selectOption(visibility);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("status").filter({ hasText: "selected" })).toBeVisible();
};

test("visibility: badges and the filter", async ({ page }) => {
  await page.goto("/media/");
  await expect(
    rows(page).filter({ hasText: "/mock/vrchat2.png" }).getByTestId("visibility-badge"),
  ).toHaveText("Unlisted");
  await expect(
    rows(page).filter({ hasText: "/mock/vrchat3.png" }).getByTestId("visibility-badge"),
  ).toHaveText("Private");

  await page.locator('select[name="visibility"]').first().selectOption("public");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/visibility=public/);
  await expect(rows(page)).toHaveCount(3);

  await page.goto("/media/?visibility=private");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("/mock/vrchat3.png");
});

test("visibility: the edit page changes it and shows the public URL", async ({
  page,
}) => {
  try {
    await page.goto("/media/3/");
    await expect(page.getByTestId("public-url")).toHaveText(
      "https://gallery.sksat.net/photo/aaaaaaaaa4/",
    );
    await expect(page.getByRole("radio", { name: /Public/ })).toBeChecked();
    await page.getByRole("radio", { name: /Unlisted/ }).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/^Saved at /)).toBeVisible();
    await expect(page.getByTestId("visibility-badge")).toHaveText("Unlisted");

    await page.goto("/media/?visibility=unlisted");
    await expect(rows(page)).toHaveCount(2);
  } finally {
    await page.goto("/media/3/");
    await page.getByRole("radio", { name: /Public/ }).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/^Saved at /)).toBeVisible();
  }
});

test("visibility: bulk change of the selected photos", async ({ page }) => {
  try {
    await bulkSet(page, [1, 2], "private");
    await expect(page.getByRole("status").filter({ hasText: "selected" })).toHaveText(
      "2 selected, 2 changed to Private.",
    );
    await page.goto("/media/?visibility=private");
    await expect(rows(page)).toHaveCount(3);
  } finally {
    await bulkSet(page, [1, 2], "public");
  }
  await page.goto("/media/?visibility=public");
  await expect(rows(page)).toHaveCount(3);
});

test("visibility: bulk change without a selection fails", async ({ page }) => {
  await page.goto("/media/");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("alert")).toHaveText("select at least one photo");
});

test("visibility: select all ticks every row on the page", async ({ page }) => {
  await page.goto("/media/");
  await page.getByTestId("select-all").check();
  await expect(rows(page).getByRole("checkbox", { checked: true })).toHaveCount(5);
  await page.getByTestId("select-all").uncheck();
  await expect(rows(page).getByRole("checkbox", { checked: true })).toHaveCount(0);
});

test("visibility: a row unticked after select all is left alone", async ({
  page,
}) => {
  try {
    await page.goto("/media/?visibility=public");
    await page.getByTestId("select-all").check();
    // The handler loads lazily; wait for it before unticking a row.
    await expect(rows(page).getByRole("checkbox", { checked: true })).toHaveCount(3);
    await page.getByRole("checkbox", { name: "Select #3", exact: true }).uncheck();
    await page.locator("#bulk-visibility").selectOption("unlisted");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("status").filter({ hasText: "selected" })).toHaveText(
      "2 selected, 2 changed to Unlisted.",
    );
    await page.goto("/media/?visibility=public");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("/mock/real2.png");
  } finally {
    await bulkSet(page, [1, 2], "public");
  }
});
