import { test, expect, type Page } from "@playwright/test";

/** Every thumbnail has loaded (they are lazy). */
const imagesLoaded = (page: Page) =>
  expect
    .poll(() =>
      page.$$eval("main img", (imgs) =>
        imgs.every((i) => (i as HTMLImageElement).complete),
      ),
    )
    .toBe(true);

const shots = [
  { name: "calendar-month", path: "/calendar/2023/12/", days: "calendar-day" },
  { name: "calendar-year", path: "/calendar/2023/", days: "calendar-heat-day" },
];

for (const { name, path, days } of shots) {
  test(`${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(path);
    await expect(page.getByTestId(days)).toHaveCount(5, { timeout: 10000 });
    await imagesLoaded(page);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });

  test(`${name} (phone)`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await expect(page.getByTestId(days)).toHaveCount(5, { timeout: 10000 });
    await imagesLoaded(page);
    await expect(page).toHaveScreenshot(`${name}-phone.png`, {
      fullPage: true,
    });
  });
}
