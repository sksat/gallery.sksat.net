import { expect, test } from "@playwright/test";

// Hover cards (components/hover-card.tsx): the camera list's camera card
// and the edit page's 前へ / 次へ photo card. Test data: e2e/fixture.sql
// (VirtualLens2 has two pictures and photo #2).

test.use({ viewport: { width: 1280, height: 800 } });

test("a camera row's card shows its pictures and photos", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await page.goto("/camera/");
  // One card per camera (other specs on the shared D1 may add some).
  const card = page.getByTestId("camera-preview");
  await expect(card.first()).toBeAttached();
  await expect(card.filter({ visible: true })).toHaveCount(0);
  // Nothing is asked for before a card is wanted.
  expect(urls.filter((u) => u.includes("/preview/"))).toEqual([]);

  const row = page.getByRole("link", { name: /VirtualLens2/ });
  await row.hover();
  const shown = page.getByTestId("camera-preview").filter({ visible: true });
  await expect(shown).toHaveCount(1);
  await expect(shown).toContainText("VirtualLens2");
  await expect(shown).toContainText(/Virtual \(in-game\) · \d+ photos?/);
  await expect(shown.getByTestId("camera-preview-photos")).toBeVisible();
  await expect(
    shown.getByTestId("camera-preview-photos").locator("li").first(),
  ).toBeVisible();
  await expect(row).toHaveAttribute("aria-describedby", /^preview-/);

  // Esc hides it; the focus shows it again.
  await page.keyboard.press("Escape");
  await expect(shown).toHaveCount(0);
  await page.mouse.move(5, 790);
  await row.focus();
  await expect(
    page.getByTestId("camera-preview").filter({ visible: true }),
  ).toHaveCount(1);

  for (const u of urls) {
    expect(["localhost", "127.0.0.1"], u).toContain(new URL(u).hostname);
  }
});

test("前へ / 次へ show the photo they go to", async ({ page }) => {
  await page.goto("/media/?platform=VRChat");
  await page.getByRole("link", { name: "/mock/vrchat2.png" }).click();
  await expect(page.getByRole("heading", { name: "Edit #4" })).toBeVisible();
  const next = page.getByTestId("next-preview");
  await expect(next).toBeHidden();
  await page.getByRole("link", { name: "次へ ›" }).hover();
  await expect(next).toBeVisible();
  // The thumbnail's box (a placeholder without the image Worker).
  await expect(next).toContainText("PNG");
  await page.getByRole("link", { name: "‹ 前へ" }).hover();
  await expect(next).toBeHidden();
  await expect(page.getByTestId("prev-preview")).toBeVisible();
});
