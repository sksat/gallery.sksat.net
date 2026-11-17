import { expect, test } from "@playwright/test";

// Fixture (e2e/fixture.sql): camera 1 = VirtualLens2 (on media 2),
// camera 2 = PENTAX SP (no photos).

const row = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("listitem").filter({ hasText: name });

test("cameras: the list shows each camera with its photo count", async ({
  page,
}) => {
  await page.goto("/camera/");
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

  await page.goto("/camera/");
  await page.getByRole("link", { name: "New camera" }).click();
  await expect(page.getByRole("heading", { name: "New camera" })).toBeVisible();

  await page.getByLabel("Name").fill("E2E Phone");
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Kind").selectOption("phone");
  await page.getByLabel("メーカー", { exact: true }).fill("Google");
  await page
    .getByLabel("メーカーの Web サイト")
    .fill("https://store.google.com/");
  await page.getByLabel("Model").fill("Pixel 9");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page).toHaveURL(/\/camera\/\d+\/\?created=1$/);
  await expect(page.getByText("Camera created.")).toBeVisible();
  await expect(page.getByLabel("Slug")).toHaveValue(slug);
  await expect(page.getByLabel("Kind")).toHaveValue("phone");
  await expect(page.getByLabel("メーカーの Web サイト")).toHaveValue(
    "https://store.google.com/",
  );

  await page.getByLabel("Description").fill("Edited by E2E");
  await page.getByLabel("製品ページ").fill("https://example.com/pixel");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Description")).toHaveValue("Edited by E2E");
  await expect(page.getByLabel("製品ページ")).toHaveValue(
    "https://example.com/pixel",
  );

  await page.goto("/camera/");
  await expect(row(page, "E2E Phone")).toContainText(slug);
  await expect(row(page, "E2E Phone")).toContainText("Phone");
});

const caption = (page: import("@playwright/test").Page, n: number) =>
  page.getByRole("textbox", { name: `Caption of image ${n}`, exact: true });

test("cameras: the fixture camera lists its images in order", async ({
  page,
}) => {
  await page.goto("/camera/1/");
  const images = page.getByTestId("camera-image");
  await expect(images).toHaveCount(2);
  await expect(images.nth(0)).toContainText("/camera/virtuallens2/front.png");
  await expect(caption(page, 1)).toHaveValue("Front");
  await expect(images.nth(1)).toContainText("/camera/virtuallens2/ui.png");
  // Thumbnails are off in E2E: placeholders, never the originals.
  await expect(images.getByTestId("thumb-placeholder")).toHaveCount(2);
});

test("cameras: add, reorder, caption and remove images", async ({ page }) => {
  const slug = `e2e-img-${Date.now().toString(36)}`;
  await page.goto("/camera/new/");
  await page.getByLabel("Name").fill("E2E Images");
  await page.getByLabel("Slug").fill(slug);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Camera created.")).toBeVisible();

  const images = page.getByTestId("camera-image");
  const add = async (file: string, caption = "") => {
    await page.getByLabel("Image path").fill(file);
    await page.getByLabel("Caption", { exact: true }).fill(caption);
    await page.getByRole("button", { name: "Add image" }).click();
  };

  await add("/camera/e2e/a.png", "A");
  await expect(images).toHaveCount(1);
  // Cleared after a successful add.
  await expect(page.getByLabel("Image path")).toHaveValue("");
  await add("/camera/e2e/b.jpg");
  await expect(images).toHaveCount(2);
  await expect(images.nth(1)).toContainText("/camera/e2e/b.jpg");

  await page.getByRole("button", { name: "Move image 2 up" }).click();
  await expect(images.nth(0)).toContainText("/camera/e2e/b.jpg");
  await expect(
    page.getByRole("button", { name: "Move image 1 up" }),
  ).toBeDisabled();

  await caption(page, 1).fill("B side");
  // Saved on leaving the field; wait for it before reloading.
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST"),
    caption(page, 1).blur(),
  ]);

  await page.reload();
  await expect(images.nth(0)).toContainText("/camera/e2e/b.jpg");
  await expect(caption(page, 1)).toHaveValue("B side");
  await expect(caption(page, 2)).toHaveValue("A");

  // Duplicate and unsafe paths are refused.
  await add("/camera/e2e/b.jpg");
  await expect(page.getByRole("alert")).toContainText("already added");
  await add("/camera/../secret.png");
  await expect(page.getByRole("alert")).toContainText("file must be a path");
  await expect(images).toHaveCount(2);
  // A rejected path stays in the field to be fixed.
  await expect(page.getByLabel("Image path")).toHaveValue(
    "/camera/../secret.png",
  );

  await page.getByRole("button", { name: "Remove image 2" }).click();
  await expect(images).toHaveCount(1);
  await expect(images.nth(0)).toContainText("/camera/e2e/b.jpg");
  // The earlier add error does not linger after a later action.
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("cameras: a taken slug is rejected with a message", async ({ page }) => {
  await page.goto("/camera/new/");
  await page.getByLabel("Name").fill("Duplicate");
  await page.getByLabel("Slug").fill("virtuallens2");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "slug “virtuallens2” is taken",
  );
  await expect(page).toHaveURL(/\/camera\/new\/$/);
});

test("cameras: an invalid slug is rejected by the server", async ({ page }) => {
  // The input's `pattern` stops a browser submit; drop it to prove
  // validateCamera runs server-side too.
  await page.goto("/camera/new/");
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

    await page.goto("/camera/");
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
