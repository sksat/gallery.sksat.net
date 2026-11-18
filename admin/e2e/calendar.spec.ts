import { expect, test, type Page } from "@playwright/test";

// Fixture (e2e/fixture.sql): one photo a day on 2023-12-01 … 05; 1-3
// public, 4 unlisted, 5 private. The admin's calendar counts them all.

const toDay = async (page: Page) => {
  await expect(page.getByTestId("calendar-title")).toHaveText("2023年12月");
  const days = page.getByTestId("calendar-day");
  await expect(days).toHaveCount(5);
  // Each day says who can see its photos.
  await expect(
    page.getByRole("link", { name: "12月5日 1枚（非公開 1）" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "12月4日 1枚（限定公開 1）" }).click();
  await expect(page).toHaveURL(/\/media\/\?date=2023-12-04$/);
};

test("calendar: a day opens /media filtered to it", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .first()
    .getByRole("link", { name: "Calendar" })
    .click();
  await expect(page).toHaveURL(/\/calendar\/$/);
  await toDay(page);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toHaveAttribute("data-media-id", "4");
  await expect(page.getByRole("heading", { name: "Media (1)" })).toBeVisible();

  // The Files view keeps the date; its chip drops it.
  await page.getByRole("link", { name: "Files" }).click();
  await expect(page).toHaveURL(/view=files&date=2023-12-04/);
  await page
    .getByRole("link", { name: "2023年12月4日 の絞り込みを外す" })
    .click();
  await expect(page).toHaveURL(/\/media\/\?view=files$/);
});

test("calendar: the year, and a month's photos", async ({ page }) => {
  await page.goto("/calendar/2023/");
  await expect(page.getByTestId("calendar-title")).toHaveText("2023年");
  await expect(page.getByTestId("calendar-heat-day")).toHaveCount(5);
  await page.getByRole("link", { name: "2023年の写真 5 枚" }).click();
  await expect(page).toHaveURL(/\/media\/\?date=2023$/);
  await expect(page.locator("tbody tr")).toHaveCount(5);

  await page.goto("/calendar/2023/12/");
  await page.getByTestId("calendar-month-all").click();
  await expect(page).toHaveURL(/\/media\/\?date=2023-12$/);
  await expect(page.locator("tbody tr")).toHaveCount(5);
});

test("calendar: prev/next through the edit page stay on the date", async ({
  page,
}) => {
  // Opened from the list of that month: 2 of the 5.
  await page.goto(
    `/media/4/?back=${encodeURIComponent("/media/?date=2023-12")}`,
  );
  await expect(page.getByTestId("position")).toHaveText("2 / 5");
  await page.goto(
    `/media/4/?back=${encodeURIComponent("/media/?date=2023-12-04")}`,
  );
  await expect(page.getByTestId("position")).toHaveText("1 / 1");
});

test("calendar: impossible dates are 404", async ({ request }) => {
  for (const path of [
    "/calendar/2023/13/",
    "/calendar/abc/",
    "/calendar/2023/12/01/",
  ]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("calendar from the menu, a day to /media", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Menu" })
      .or(page.locator("summary[aria-label=Menu]"))
      .first()
      .tap();
    await page.getByRole("link", { name: "Calendar" }).tap();
    await expect(page).toHaveURL(/\/calendar\/$/);
    await toDay(page);
    await expect(page.getByTestId("media-card")).toHaveCount(1);
  });
});
