import { expect, test } from "@playwright/test";

const shots = [
  { name: "month", path: "/calendar/2023/12/", days: "calendar-day" },
  { name: "year", path: "/calendar/2023/", days: "calendar-heat-day" },
];

for (const [label, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test.describe(label, () => {
    test.use({ viewport });
    for (const { name, path, days } of shots) {
      test(`admin: calendar ${name}`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByTestId(days)).toHaveCount(5);
        await expect(page).toHaveScreenshot(
          `admin-calendar-${name}-${label}.png`,
          { fullPage: true },
        );
      });
    }
  });
}

test.describe("dark", () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  test("admin: calendar month (dark)", async ({ page }) => {
    await page.goto("/calendar/2023/12/");
    await expect(page.getByTestId("calendar-day")).toHaveCount(5);
    await expect(page).toHaveScreenshot("admin-calendar-month-dark.png", {
      fullPage: true,
    });
  });
});
