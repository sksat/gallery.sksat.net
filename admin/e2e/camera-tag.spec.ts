import { expect, test, type Page } from "@playwright/test";

// Tags of a camera (migration 0011): added on the camera's page, passed
// on to its photos (「写真にも付ける」) or not, with undo. Fixture photo 2
// was taken with camera 1 (VirtualLens2). Puts the fixture back.

const TAG = "e2e-cam";

const tagRow = (page: Page) =>
  page.getByTestId("camera-tag").filter({ hasText: TAG });
const inheritedChip = (page: Page) =>
  page.locator('[data-testid="tag-chip"][data-inherited="true"]', {
    hasText: TAG,
  });

test("a camera's tag goes to its photos, or stays on the camera", async ({
  page,
}) => {
  await page.goto("/camera/1/");
  try {
    await page.getByLabel("タグを付ける").fill(TAG);
    await page.getByRole("button", { name: "付ける" }).click();
    await expect(
      page.getByText(`『${TAG}』を付けました。新しいタグは非公開です。`),
    ).toBeVisible();
    const toggle = tagRow(page).getByRole("switch", { name: "写真にも付ける" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // The photo has it, from its camera, apart from its own tags.
    await page.goto("/media/2/");
    await expect(inheritedChip(page)).toBeVisible();
    // New, so private by default; public or not on the photo like its own.
    await expect(inheritedChip(page)).toHaveAttribute("data-public", "false");
    await expect(page.locator('input[name="tags"]')).toHaveValue("VRChat");

    // Kept to the camera: the photo no longer has it; and back.
    await page.goto("/camera/1/");
    await toggle.click();
    await expect(
      page.getByText(`『${TAG}』をこのカメラの写真には付けません。`),
    ).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.goto("/media/2/");
    await expect(inheritedChip(page)).toHaveCount(0);
    await page.goto("/camera/1/");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // Taken off, and put back with 元に戻す.
    await tagRow(page)
      .getByRole("button", { name: `${TAG}を外す` })
      .click();
    await expect(page.getByText(`『${TAG}』を外しました。`)).toBeVisible();
    await expect(tagRow(page)).toHaveCount(0);
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByText("元に戻しました。")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // Counted on /tag/ for the photos that have it.
    await page.goto("/tag/");
    await expect(
      page.getByTestId("tag-row").filter({ hasText: TAG }),
    ).toContainText("1 枚");
  } finally {
    await page.goto("/camera/1/");
    if ((await tagRow(page).count()) > 0) {
      await tagRow(page)
        .getByRole("button", { name: `${TAG}を外す` })
        .click();
      await expect(tagRow(page)).toHaveCount(0);
    }
  }
});
