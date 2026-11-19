import { expect, test, type Page } from "@playwright/test";

// /platform/ (migration 0014): add a platform, put a photo on it from its
// edit page, rename it, and delete it once no photo uses it, with undo.
// Puts the fixture back (photo 2 on VRChat, no extra platform).

const row = (page: Page, name: string) =>
  page.getByTestId("platform-row").filter({
    has: page.getByRole("textbox", { name: `${name} の名前`, exact: true }),
  });

const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();
};

test("add a platform, use it on a photo, rename, delete and undo", async ({
  page,
}) => {
  await page.goto("/platform/");
  await expect(page.getByTestId("platform-row")).toHaveCount(2);
  // The built-in ones cannot be deleted.
  await expect(
    row(page, "VRChat").getByRole("button", { name: "削除" }),
  ).toBeDisabled();

  await page.getByLabel("名前", { exact: true }).fill("Neos VR");
  await page.getByLabel("種類", { exact: true }).selectOption("virtual");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByText("『Neos VR』を追加しました。")).toBeVisible();
  await expect(page.getByTestId("platform-row")).toHaveCount(3);
  // Names are unique, case aside.
  await page.getByLabel("名前", { exact: true }).fill("neos vr");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(
    page.getByText("その名前のプラットフォームはもうあります"),
  ).toBeVisible();

  try {
    await page.goto("/media/2/");
    await page.getByLabel("Platform").selectOption({ label: "Neos VR" });
    await save(page);
    await page.reload();
    await expect(page.getByLabel("Platform")).toHaveValue("Neos-VR");
    await expect(page.locator("h1 + span")).toHaveText("Neos VR");

    // In use: counted, and not deleted.
    await page.goto("/platform/");
    const neos = row(page, "Neos VR");
    await expect(neos).toContainText("1 枚");
    await expect(neos.getByRole("button", { name: "削除" })).toBeDisabled();

    // Renamed: the photo follows (it keeps the key).
    await neos.getByRole("textbox").fill("Neos");
    await neos.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("『Neos』を保存しました。")).toBeVisible();
    await page.goto("/media/?platform=Neos-VR");
    // The filter offers it, and the photo's badge has the new name.
    await expect(
      page.getByRole("heading", { name: "Media (1)" }),
    ).toBeVisible();
    await expect(page.locator("#filter-platform")).toHaveValue("Neos-VR");
    await expect(page.getByRole("cell", { name: "Neos Public" })).toBeVisible();
  } finally {
    await page.goto("/media/2/");
    await page.getByLabel("Platform").selectOption("VRChat");
    await save(page);
  }

  // Unused again: deleted, put back with undo, deleted again.
  await page.goto("/platform/");
  await row(page, "Neos").getByRole("button", { name: "削除" }).click();
  await expect(page.getByText("『Neos』を削除しました。")).toBeVisible();
  await expect(page.getByTestId("platform-row")).toHaveCount(2);
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByTestId("platform-row")).toHaveCount(3);
  await row(page, "Neos").getByRole("button", { name: "削除" }).click();
  await expect(page.getByTestId("platform-row")).toHaveCount(2);
});

test("reorder with undo", async ({ page }) => {
  await page.goto("/platform/");
  const names = () =>
    page
      .getByTestId("platform-row")
      .getByRole("textbox")
      .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  await expect.poll(names).toEqual(["Real", "VRChat"]);
  await page.getByRole("button", { name: "VRChat を上へ" }).click();
  await expect.poll(names).toEqual(["VRChat", "Real"]);
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect.poll(names).toEqual(["Real", "VRChat"]);
  await page.reload();
  await expect.poll(names).toEqual(["Real", "VRChat"]);
});
