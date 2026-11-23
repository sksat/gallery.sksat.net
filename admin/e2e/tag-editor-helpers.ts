import { expect, type Page } from "@playwright/test";

// The edit page's tag editor (components/tag-editor.tsx): chips with ×,
// and a box to add tags. Its own tags also go into a hidden
// `input[name="tags"]` (comma-separated), which tests read with
// toHaveValue.

/** The hidden field with the photo's own tags, as the form sends them. */
export const tagsField = (page: Page) => page.locator('input[name="tags"]');

/** A chip of the editor. */
export const tagChip = (page: Page, name: string) =>
  page
    .getByTestId("tag-editor")
    .locator(`[data-testid="tag-chip"][data-tag="${name}"]`);

/** Add tags ("a, b" here, for short) with the box, one at a time. */
export const addTags = async (page: Page, tags: string) => {
  const box = page.getByTestId("tag-editor").getByPlaceholder("タグを追加");
  for (const tag of tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)) {
    await box.fill(tag);
    await box.press("Enter");
    await expect(box).toHaveValue("");
  }
};

/** Make the photo's own tags exactly `tags` ("a, b"; "" for none). */
export const setTags = async (page: Page, tags: string) => {
  const remove = page
    .getByTestId("tag-editor")
    .getByRole("button", { name: /を外す$/ });
  // One at a time, each once the one before has gone.
  for (let n = await remove.count(); n > 0; n--) {
    await remove.first().click();
    await expect(remove).toHaveCount(n - 1);
  }
  if (tags.trim() !== "") await addTags(page, tags);
  await expect(tagsField(page)).toHaveValue(
    tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .join(", "),
  );
};
