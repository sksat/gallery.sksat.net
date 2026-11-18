import { expect, test, type Page } from "@playwright/test";

// The OS prefers light, so "system" renders light and only an explicit
// "dark" choice turns the page dark.
test.use({ colorScheme: "light" });

const html = (page: Page) => page.locator("html");
const bodyBg = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("theme toggle cycles system → light → dark and persists across reload", async ({
  page,
}) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /^Theme:/ });

  await expect(html(page)).toHaveAttribute("data-theme", "system");
  await expect(toggle).toHaveAccessibleName("Theme: System (switch to Light)");
  await expect(toggle).toHaveAttribute(
    "title",
    "Theme: System (switch to Light)",
  );
  // Icon only: no visible text in the button.
  await expect(toggle).toHaveText("");
  const lightBg = await bodyBg(page);

  await toggle.click();
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await expect(toggle).toHaveAccessibleName("Theme: Light (switch to Dark)");

  await toggle.click();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAccessibleName("Theme: Dark (switch to System)");
  expect(await bodyBg(page)).not.toBe(lightBg);

  // Applied by the inline <head> script before first paint on the next load.
  await page.reload();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAccessibleName("Theme: Dark (switch to System)");
  expect(await bodyBg(page)).not.toBe(lightBg);

  // Back to system: follows the (light) OS preference again. Wait for the
  // click to be applied (Qwik loads the handler lazily and only then stores
  // the choice) before reloading, or the reload can race it and keep "dark".
  await toggle.click();
  await expect(html(page)).toHaveAttribute("data-theme", "system");
  await page.reload();
  await expect(html(page)).toHaveAttribute("data-theme", "system");
  expect(await bodyBg(page)).toBe(lightBg);
});

test.describe("with a dark OS preference", () => {
  test.use({ colorScheme: "dark" });

  test("system follows the OS and light overrides it", async ({ page }) => {
    await page.goto("/");
    const darkBg = await bodyBg(page);
    await page.getByRole("button", { name: /^Theme:/ }).click(); // → light
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    expect(await bodyBg(page)).not.toBe(darkBg);
  });
});
