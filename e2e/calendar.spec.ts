import { test, expect, type Page } from "@playwright/test";

// Test data: e2e/fixture.sql. Public photos on 2023-12-01 … 2023-12-05
// (vrcxxxxxxb on its own +09:00 date, shown to the day only); the unlisted
// (12-06) and private (12-07) photos must not be counted.

const dayDates = (page: Page) =>
  page
    .getByTestId("calendar-day")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-date")));

const calendarToFilteredGallery = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("link", { name: "カレンダー", exact: true }).click();

  // The newest month with photos.
  await expect(page).toHaveURL(/\/calendar\/$/);
  await expect(page.getByTestId("calendar-title")).toHaveText("2023年12月");
  await expect(page.getByTestId("calendar-day")).toHaveCount(5);
  expect(await dayDates(page)).toEqual([
    "2023-12-01",
    "2023-12-02",
    "2023-12-03",
    "2023-12-04",
    "2023-12-05",
  ]);
  // Nothing before or after this month.
  await expect(page.getByTestId("calendar-prev")).toHaveCount(0);
  await expect(page.getByTestId("calendar-next")).toHaveCount(0);

  // A day → the gallery of that day.
  await page.getByRole("link", { name: "12月4日 1枚" }).click();
  await expect(page).toHaveURL(/\/\?date=2023-12-04$/);
  await expect(page.getByTestId("date-heading")).toHaveText("2023年12月4日");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(1);
  await expect(page.getByTestId("result-count")).toHaveText("1 枚");

  // Opening and closing the photo keeps the date.
  await images.first().dispatchEvent("click");
  const overlay = page.getByTestId("overlay");
  await expect(overlay).toBeVisible();
  await expect(page).toHaveURL(/\/photo\/vrcxxxxxxb\?date=2023-12-04$/);
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(overlay).not.toBeVisible();
  await expect(page).toHaveURL(/\/\?date=2023-12-04$/);

  // Back to the month, then up to the year.
  await page.getByRole("link", { name: "← カレンダー" }).click();
  await expect(page).toHaveURL(/\/calendar\/2023\/12\/$/);
  await page.getByRole("link", { name: "2023年", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar\/2023\/$/);
  await expect(page.getByTestId("calendar-title")).toHaveText("2023年");
  await expect(page.getByTestId("calendar-month")).toHaveCount(12);
  await expect(page.getByTestId("calendar-heat-day")).toHaveCount(5);
  await page.getByRole("link", { name: "2023年の写真 5 枚" }).click();
  await expect(page).toHaveURL(/\/\?date=2023$/);
  await expect(images).toHaveCount(5);
};

test("calendar: month → day → filtered gallery → photo", async ({ page }) => {
  await calendarToFilteredGallery(page);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("calendar: the same flow on a phone", async ({ page }) => {
    await calendarToFilteredGallery(page);
  });
});

test("calendar: arrows and Back in a date's gallery", async ({ page }) => {
  await page.goto("/?date=2023-12");
  const images = page.getByTestId("gallery-image");
  await expect(images).toHaveCount(5, { timeout: 10000 });
  await images.first().dispatchEvent("click");
  await expect(page).toHaveURL(/\/photo\/vrcxxxxxxc\?date=2023-12$/);
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/photo\/vrcxxxxxxb\?date=2023-12$/);
  // Back closes the photo and keeps the date.
  await page.goBack();
  await expect(page.getByTestId("overlay")).not.toBeVisible();
  await expect(page).toHaveURL(/\/\?date=2023-12$/);
  await expect(images).toHaveCount(5);

  // A photo that is not on the date (an edited link): the arrows walk
  // the whole gallery instead of doing nothing.
  await page.goto("/photo/reaxxxxxxa?date=2023-12-04");
  await expect(page.getByTestId("overlay")).toBeVisible({ timeout: 10000 });
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/\/photo\/vrcxxxxxxa\?date=2023-12-04$/);
});

test("calendar: an empty month leads to the nearest ones", async ({ page }) => {
  await page.goto("/calendar/2023/11/");
  await expect(page.getByTestId("calendar-title")).toHaveText("2023年11月");
  await expect(page.getByTestId("calendar-day")).toHaveCount(0);
  await expect(page.getByText("この月の写真はありません。")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex",
  );
  await page.getByTestId("calendar-next").click();
  await expect(page).toHaveURL(/\/calendar\/2023\/12\/$/);
});

test("calendar: a day with no photos in the gallery is empty", async ({
  page,
}) => {
  // The unlisted and private photos' days.
  await page.goto("/?date=2023-12-06");
  await expect(page.getByTestId("date-heading")).toHaveText("2023年12月6日");
  await expect(page.getByTestId("result-count")).toHaveText("0 枚");
});

test("calendar: impossible dates are 404", async ({ request }) => {
  for (const path of ["/calendar/2023/13/", "/calendar/23/", "/calendar/2023/1/"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});
