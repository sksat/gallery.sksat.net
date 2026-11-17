import { expect, test } from "@playwright/test";

// Numbers from e2e/fixture.sql (sizes set at its end). Runs before the
// specs that change visibility or upload.
test("dashboard: storage card adds up the fixture", async ({ page }) => {
  await page.goto("/");
  const storage = page.getByRole("region", { name: "容量" });
  await expect(storage).toBeVisible();
  await expect(storage.getByTestId("storage-cost")).toHaveText(
    "保存容量 30.0 MB · 月額の目安 約 $0.00（10 GB まで無料）",
  );
  await expect(storage.getByText("5 枚", { exact: true })).toBeVisible();

  const row = (label: string) =>
    storage.getByRole("listitem").filter({ hasText: label });
  await expect(row("限定公開")).toContainText("12.0 MB · 1 枚");
  await expect(row("非公開")).toContainText("6.00 MB · 1 枚");
  await expect(
    storage.getByRole("listitem").filter({ hasText: /^公開/ }),
  ).toContainText("12.0 MB · 3 枚");
  await expect(row("/mock")).toContainText("30.0 MB · 5 枚");
  await expect(storage).toContainText("アップロード中 なし");
});

test("dashboard: D1 card without the analytics token", async ({ page }) => {
  await page.goto("/");
  const d1 = page.getByRole("region", { name: "D1" });
  await expect(d1).toContainText("データベースのサイズ");
  await expect(d1).toContainText("/ 500 MB");
  await expect(d1).toContainText("読み書きの回数は API トークン設定後に表示");
});
