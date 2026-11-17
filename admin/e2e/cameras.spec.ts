import { expect, test } from "@playwright/test";

// Fixture (e2e/fixture.sql): camera 1 = VirtualLens2 (on media 2),
// camera 2 = PENTAX SP (no photos).

const row = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("listitem").filter({ hasText: name });

test("cameras: the list shows each camera with its photo count", async ({
  page,
}) => {
  await page.goto("/cameras/");
  await expect(
    page.getByRole("heading", { name: /^Cameras/, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Cameras", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(row(page, "VirtualLens2")).toContainText("virtuallens2");
  await expect(row(page, "VirtualLens2")).toContainText("1 photo");
  await expect(row(page, "PENTAX SP")).toContainText("0 photos");
});

test("cameras: create, then edit the new camera", async ({ page }) => {
  // Unique per run so a reused local server (reuseExistingServer) does not
  // hit the slug's UNIQUE constraint on a second run.
  const slug = `e2e-${Date.now().toString(36)}`;

  await page.goto("/cameras/");
  await page.getByRole("link", { name: "New camera" }).click();
  await expect(page.getByRole("heading", { name: "New camera" })).toBeVisible();

  await page.getByLabel("Name").fill("E2E Phone");
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Kind").selectOption("phone");
  await page.getByLabel("Make").fill("Google");
  await page.getByLabel("Model").fill("Pixel 9");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page).toHaveURL(/\/cameras\/\d+\/\?created=1$/);
  await expect(page.getByText("Camera created.")).toBeVisible();
  await expect(page.getByLabel("Slug")).toHaveValue(slug);
  await expect(page.getByLabel("Kind")).toHaveValue("phone");

  await page.getByLabel("Description").fill("Edited by E2E");
  await page.getByLabel("URL").fill("https://example.com/pixel");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Description")).toHaveValue("Edited by E2E");
  await expect(page.getByLabel("URL")).toHaveValue(
    "https://example.com/pixel",
  );

  await page.goto("/cameras/");
  await expect(row(page, "E2E Phone")).toContainText(slug);
  await expect(row(page, "E2E Phone")).toContainText("Phone");
});

test("cameras: a taken slug is rejected with a message", async ({ page }) => {
  await page.goto("/cameras/new/");
  await page.getByLabel("Name").fill("Duplicate");
  await page.getByLabel("Slug").fill("virtuallens2");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "slug “virtuallens2” is taken",
  );
  await expect(page).toHaveURL(/\/cameras\/new\/$/);
});

test("cameras: an invalid slug is rejected by the server", async ({
  page,
}) => {
  // The input's `pattern` stops a browser submit; drop it to prove
  // validateCamera runs server-side too.
  await page.goto("/cameras/new/");
  await page.getByLabel("Slug").evaluate((el) => el.removeAttribute("pattern"));
  await page.getByLabel("Name").fill("Bad slug");
  await page.getByLabel("Slug").fill("Bad Slug");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("alert")).toContainText("slug must be");
});

test("media edit: a photo can be linked to a camera and back to none", async ({
  page,
}) => {
  try {
    await page.goto("/media/3/");
    const select = page.getByLabel("Camera", { exact: true });
    await expect(select).toHaveValue("");
    await select.selectOption({ label: "PENTAX SP" });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/^Saved at /)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Camera", { exact: true })).toHaveValue("2");

    await page.goto("/cameras/");
    await expect(row(page, "PENTAX SP")).toContainText("1 photo");
  } finally {
    // Restore so other specs on the same server see the fixture as-is.
    await page.goto("/media/3/");
    await page.getByLabel("Camera", { exact: true }).selectOption("");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/^Saved at /)).toBeVisible();
  }
});

test("PATCH /api/media/[id]: an unknown camera_id is a 400, not a 500", async ({
  request,
  baseURL,
}) => {
  const res = await request.fetch(`${baseURL}/api/media/3/`, {
    method: "PATCH",
    headers: { origin: baseURL!, "content-type": "application/json" },
    data: { camera_id: 999 },
  });
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({ error: "unknown camera_id" });
});

test("media edit: the camera select preselects the row's camera", async ({
  page,
}) => {
  await page.goto("/media/2/");
  await expect(page.getByLabel("Camera", { exact: true })).toHaveValue("1");
});
