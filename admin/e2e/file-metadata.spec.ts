import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// The edit page's ファイルのメタデータ: everything in the original, read
// from the fake bucket (e2e/fake-b2.mjs) when the section is opened.

const port = Number(process.env.ADMIN_E2E_PORT) || 5175;
const seed = `http://127.0.0.1:${port + 2}/__seed?key=${encodeURIComponent("/mock/vrchat1.png")}`;

// Fixture photo 2 (/mock/vrchat1.png) gets a VRChat PNG with XMP while
// these tests run, and loses it after (other specs see no original).
test.beforeEach(async ({ request }) => {
  const res = await request.put(seed, {
    data: readFileSync(
      new URL("../src/lib/fixtures/vrchat-2026.png", import.meta.url),
    ),
  });
  expect(res.ok()).toBe(true);
});
test.afterEach(async ({ request }) => {
  await request.delete(seed);
});

test("open the file's metadata and copy it as JSON", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/media/2/");
  const section = page.getByRole("region", { name: "ファイルのメタデータ" });
  // Nothing is read until it is opened.
  await expect(section.getByText("vrc:WorldDisplayName")).toBeHidden();
  await section.getByText("ファイルのメタデータ").click();
  await expect(section.getByText("vrc:WorldDisplayName")).toBeVisible();
  await expect(section.getByText("桜の川 （Sakura）")).toBeVisible();
  await expect(section.locator("[data-source=XMP]")).toBeVisible();
  await expect(section.locator("[data-source=PNG]")).toBeVisible();

  await section.getByRole("button", { name: "JSON としてコピー" }).click();
  await expect(
    section.getByRole("button", { name: "コピーしました" }),
  ).toBeVisible();
  const copied = JSON.parse(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  expect(copied).toMatchObject({ format: "png", file: "/mock/vrchat1.png" });
  expect(JSON.stringify(copied.sections)).toContain("wrld_00000000-aaaa");
});

test("the answer is private, and only for the photo's own file", async ({
  page,
}) => {
  const res = await page.request.get("/api/media/2/file-meta/");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("private, no-store");
  const other = await page.request.get(
    `/api/media/2/file-meta/?file=${encodeURIComponent("/mock/real1.png")}`,
  );
  expect(other.status()).toBe(404);
});

test("a photo whose file is not in the bucket", async ({ page }) => {
  await page.goto("/media/3/");
  const section = page.getByRole("region", { name: "ファイルのメタデータ" });
  await section.getByText("ファイルのメタデータ").click();
  await expect(section.getByRole("alert")).toContainText(
    "ファイルが見つかりません",
  );
});
