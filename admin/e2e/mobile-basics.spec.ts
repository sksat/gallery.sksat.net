import { expect, test, type Locator, type Page } from "@playwright/test";

// Phone basics: no zoom-on-focus, 44px tap targets, busy submit buttons and
// a toast that stays in view.
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

const height = async (l: Locator) => (await l.boundingBox())?.height ?? 0;

/** Hold every action POST until `release` is called. */
const holdActions = async (page: Page) => {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  await page.route(/qaction=/, async (route) => {
    if (route.request().method() === "POST") await released;
    await route.continue();
  });
  return release;
};

test("form controls use 16px text on phones", async ({ page }) => {
  await page.goto("/media/2/");
  const sizes = await page
    .locator("main input:not([type=radio]):not([type=hidden]), main select")
    .evaluateAll((els) =>
      els.map((el) => parseFloat(getComputedStyle(el).fontSize)),
    );
  expect(sizes.length).toBeGreaterThan(0);
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
});

test("tap targets are at least 44px tall", async ({ page }) => {
  await page.goto("/media/2/");
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const name of ["Dashboard", "Media", "Cameras"]) {
    expect(
      await height(nav.getByRole("link", { name })),
    ).toBeGreaterThanOrEqual(44);
  }
  expect(
    await height(page.getByRole("button", { name: /^Theme:/ })),
  ).toBeGreaterThanOrEqual(44);
  expect(
    await height(page.getByRole("link", { name: "← Media" })),
  ).toBeGreaterThanOrEqual(44);
  expect(
    await height(page.getByRole("button", { name: "Save" })),
  ).toBeGreaterThanOrEqual(44);

  await page.goto("/media/");
  expect(
    await height(page.getByRole("link", { name: "Files" })),
  ).toBeGreaterThanOrEqual(44);
});

test("save: busy button, then a toast in view", async ({ page }) => {
  await page.goto("/media/2/");
  const release = await holdActions(page);
  await page.getByRole("button", { name: "Save" }).tap();

  const busy = page.getByRole("button", { name: "保存中…" });
  await expect(busy).toBeDisabled();
  await expect(page.locator("form[aria-busy=true]")).toHaveCount(1);
  release();

  const toast = page.getByRole("status").filter({ hasText: /^Saved at / });
  await expect(toast).toBeInViewport();
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  await expect(page.locator("form[aria-busy=true]")).toHaveCount(0);
  // Success toasts go away by themselves.
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
});

test("an error toast stays until dismissed", async ({ page }) => {
  await page.goto("/camera/1/");
  // Already one of this camera's images: the action refuses.
  await page.getByLabel("Image path").fill("/camera/virtuallens2/front.png");
  await page.getByRole("button", { name: "Add image" }).tap();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("already added");
  await expect(alert).toBeInViewport();
  await page.getByRole("button", { name: "Dismiss" }).tap();
  await expect(alert).toHaveCount(0);
});
