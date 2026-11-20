import { expect, test, type Page } from "@playwright/test";

// A camera's pictures on its page: uploaded into the fake bucket
// (e2e/fake-b2.mjs on PORT+2) under /camera/<slug>/, made the default,
// reordered, taken off (undo) and deleted with their object. Each test
// makes its own camera; camera pictures add no photos, so no counts of
// other specs change.

const port = Number(process.env.ADMIN_E2E_PORT) || 5175;
const fakeB2 = `http://127.0.0.1:${port + 2}`;

const png = (name: string, seed: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(4096, seed),
  ]),
});
const jpeg = (name: string, seed: string) => ({
  name,
  mimeType: "image/jpeg",
  buffer: Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(4096, seed)]),
});

const uploadedKeys = async (page: Page): Promise<string[]> => {
  const res = await page.request.get(`${fakeB2}/__uploads`);
  return ((await res.json()) as { key: string }[]).map((u) => u.key);
};

/** A new camera, its page open; returns its slug. */
const newCamera = async (page: Page, name: string) => {
  const slug = `e2e-pic-${Date.now().toString(36)}`;
  await page.goto("/camera/new/");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Slug").fill(slug);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Camera created.")).toBeVisible();
  return slug;
};

const images = (page: Page) => page.getByTestId("camera-image");

test("upload pictures, make one the default, reorder, take off and delete", async ({
  page,
}) => {
  const slug = await newCamera(page, "E2E Pictures");
  const dir = `/camera/${slug}`;
  await expect(
    page.getByRole("heading", { name: "画像 (0)", exact: true }),
  ).toBeVisible();

  await page
    .getByTestId("upload-input")
    .setInputFiles([png("Front view.png", "a"), jpeg("back.jpg", "b")]);
  const rows = page.getByTestId("upload-row");
  await expect(rows).toHaveCount(2);
  for (const r of await rows.all()) {
    await expect(r).toHaveAttribute("data-status", "done");
  }
  await expect(images(page)).toHaveCount(2);
  await expect(images(page).nth(0)).toContainText(`${dir}/Front_view.png`);
  await expect(images(page).nth(1)).toContainText(`${dir}/back.jpg`);
  expect(await uploadedKeys(page)).toEqual(
    expect.arrayContaining([`${dir}/Front_view.png`, `${dir}/back.jpg`]),
  );
  // The first one is the default.
  await expect(images(page).nth(0)).toHaveAttribute("data-default", "");
  await expect(images(page).nth(0).getByTestId("default-mark")).toHaveText(
    "既定",
  );
  await expect(
    images(page)
      .nth(0)
      .getByRole("button", { name: /既定にする/ }),
  ).toHaveCount(0);

  // The same name again: numbered, not overwritten.
  await page.getByRole("button", { name: "閉じる" }).click();
  await expect(rows).toHaveCount(0);
  await page.getByTestId("upload-input").setInputFiles([jpeg("back.jpg", "c")]);
  await expect(rows).toHaveAttribute("data-status", "done");
  await expect(rows).toContainText(`${dir}/back-1.jpg として登録します`);
  await expect(images(page)).toHaveCount(3);
  await expect(images(page).nth(2)).toContainText(`${dir}/back-1.jpg`);

  // 既定にする, then undo.
  await page.getByRole("button", { name: "画像 3 を既定にする" }).click();
  await expect(page.getByRole("status")).toContainText("既定にしました。");
  await expect(images(page).nth(0)).toContainText("back-1.jpg");
  await expect(images(page).nth(0)).toHaveAttribute("data-default", "");
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByRole("status")).toContainText("元に戻しました。");
  await expect(images(page).nth(0)).toContainText("Front_view.png");
  await expect(images(page).nth(2)).toContainText("back-1.jpg");

  // ↓, and the order is kept.
  await page.getByRole("button", { name: "画像 1 を下へ" }).click();
  await expect(images(page).nth(0)).toContainText("back.jpg");
  await expect(images(page).nth(1)).toContainText("Front_view.png");
  await page.reload();
  await expect(images(page).nth(0)).toContainText("back.jpg");
  await expect(images(page).nth(0)).toHaveAttribute("data-default", "");

  // A drag by the handle: the last one onto the top half of the first.
  // (In the middle of the screen, clear of the sticky header.)
  await images(page)
    .nth(1)
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  await images(page)
    .nth(2)
    .locator("[draggable=true]")
    .dragTo(images(page).nth(0).getByTestId("default-mark"));
  await expect(images(page).nth(0)).toContainText("back-1.jpg");
  await expect(page.getByRole("status")).toContainText("並べ替えました。");

  // 外す keeps the object, and can be undone.
  await page.getByRole("button", { name: "画像 2 を外す" }).click();
  await expect(images(page)).toHaveCount(2);
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByRole("status")).toContainText("元に戻しました。");
  await expect(images(page)).toHaveCount(3);
  await expect(images(page).nth(1)).toContainText("back.jpg");

  // 削除 asks, then deletes the picture and every version of its object.
  page.once("dialog", (d) => {
    expect(d.message()).toContain("back.jpg を削除します");
    void d.accept();
  });
  await page.getByRole("button", { name: "画像 2 を削除" }).click();
  await expect(page.getByRole("status")).toContainText("削除しました。");
  await expect(images(page)).toHaveCount(2);
  await expect(images(page)).not.toContainText([`${dir}/back.jpg`]);
  expect(await uploadedKeys(page)).not.toContain(`${dir}/back.jpg`);
  expect(await uploadedKeys(page)).toContain(`${dir}/back-1.jpg`);

  // Dismissed: nothing happens.
  page.once("dialog", (d) => void d.dismiss());
  await page.getByRole("button", { name: "画像 1 を削除" }).click();
  await expect(images(page)).toHaveCount(2);
});

test("drop files on the pictures to upload them", async ({ page }) => {
  const slug = await newCamera(page, "E2E Drop");
  const zone = page.getByTestId("drop-zone");
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    const bytes = new Uint8Array(2048).fill(42);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    d.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    return d;
  });
  await zone.dispatchEvent("dragenter", { dataTransfer: dt });
  await expect(zone).toContainText("ここにドロップしてアップロード");
  await zone.dispatchEvent("dragover", { dataTransfer: dt });
  await zone.dispatchEvent("drop", { dataTransfer: dt });
  await expect(page.getByTestId("upload-row")).toHaveAttribute(
    "data-status",
    "done",
  );
  await expect(images(page)).toHaveCount(1);
  await expect(images(page)).toContainText(`/camera/${slug}/dropped.png`);
  // Not a PNG / JPEG: refused before anything is sent.
  await page
    .getByTestId("upload-input")
    .setInputFiles([
      { name: "x.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") },
    ]);
  await expect(
    page.getByTestId("upload-row").filter({ hasText: "x.gif" }),
  ).toHaveAttribute("data-status", "skipped");
  await expect(images(page)).toHaveCount(1);
});
