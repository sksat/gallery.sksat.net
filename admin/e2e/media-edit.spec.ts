import { expect, test } from "@playwright/test";
import { setTags } from "./tag-editor-helpers";

test("media edit: invalid id renders the bad-request UI, not 'Not found'", async ({
  page,
}) => {
  // /media/abc/ should distinguish "you typed a bad URL" from "row gone".
  const response = await page.goto("/media/abc/");
  expect(response?.status()).toBe(400);
  await expect(page.getByRole("heading", { name: "Invalid id" })).toBeVisible();
});

test("media edit: platform select shows the row's current value as preselected", async ({
  page,
}) => {
  // Regression: relying on `<select value="...">` (a React-ism) left the
  // SSR'd select with no `selected` option, so a "Save" without editing
  // silently flipped the row to the first option (Real).
  await page.goto("/media/2/"); // fixture: row 2 is VRChat
  await expect(page.locator('select[name="platform"]')).toHaveValue("VRChat");
});

test("media edit: tags can be saved and reflected on the list", async ({
  page,
}) => {
  await page.goto("/media/3/");
  await expect(page.getByRole("heading", { name: "Edit #3" })).toBeVisible();

  await setTags(page, "alpha, beta");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();

  await page.goto("/media/?q=real2");
  await expect(page.locator("table tbody tr")).toHaveCount(1);
  await expect(page.locator("table tbody tr").first()).toContainText(
    "alpha, beta",
  );
});

// Local-dev caveat: with `reuseExistingServer: true` and `workers: 1`, an
// interrupted run of this test (e.g. Ctrl-C between the mutation and the
// finally restore) leaves row 1's platform flipped to VRChat in the test D1.
// `start-test-server.sh` re-applies fixture.sql on every fresh server start,
// so a `pnpm run test.e2e` from a fresh shell recovers automatically.
test("media edit: platform can be changed", async ({ page }) => {
  try {
    await page.goto("/media/1/");
    await page.locator('select[name="platform"]').selectOption("VRChat");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/^Saved at /)).toBeVisible();

    await page.goto("/media/?platform=VRChat");
    await expect(page.locator("table tbody")).toContainText("/mock/real1.png");
  } finally {
    // Restore even if the assertions above fail, so subsequent tests in the
    // same server session see the original fixture platform distribution. We
    // wait for the "Saved at" confirmation here too — without it, the next
    // test can race the in-flight UPDATE and observe the stale value.
    await page.goto("/media/1/");
    await page.locator('select[name="platform"]').selectOption("Real");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/^Saved at /)).toBeVisible();
  }
});
