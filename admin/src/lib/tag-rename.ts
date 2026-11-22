// Renaming a tag (on /tag/), pure part: the new name's checks and what a
// rename does to one list of tag names (a photo's media.tags, an upload
// rule's tags) and back. db-tag-rename.ts applies them to D1; covered by
// tag-rename.spec.ts.
//
// Renaming to a name that is already a tag merges the two: every list
// that had the old name has the new one instead, once, where it had it
// first.

const MAX_TAG_LEN = 200;

/** A tag name as typed: the same checks as adding one to a camera. */
export const validateTagName = (
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } => {
  const name = raw.trim();
  if (name.length === 0 || name.length > MAX_TAG_LEN) {
    return { ok: false, error: `タグは 1〜${MAX_TAG_LEN} 文字です` };
  }
  // A photo's tags are typed comma-separated.
  if (name.includes(",")) return { ok: false, error: "タグに , は使えません" };
  return { ok: true, value: name };
};

/** `tags` after renaming `from` to `to` (the same array when it lacks it). */
export const renameInList = (
  tags: readonly string[],
  from: string,
  to: string,
): readonly string[] => {
  if (!tags.includes(from)) return tags;
  if (tags.includes(to)) return tags.filter((t) => t !== from);
  return tags.map((t) => (t === from ? to : t));
};

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((t, i) => t === b[i]);

/**
 * The undo of renameInList: `before` when the list is still what the
 * rename made of it; otherwise (it was edited since) only the rename is
 * taken back, the edit kept: `from` returns where it was, and `to` goes
 * when the list did not have it before.
 */
export const unrenameInList = (
  current: readonly string[],
  before: readonly string[],
  from: string,
  to: string,
): readonly string[] => {
  if (same(current, renameInList(before, from, to))) return before;
  if (current.includes(from)) return current;
  if (!before.includes(to)) {
    return current.includes(to)
      ? current.map((t) => (t === to ? from : t))
      : current;
  }
  const at = Math.min(Math.max(before.indexOf(from), 0), current.length);
  return [...current.slice(0, at), from, ...current.slice(at)];
};

/** A stored JSON array of tag names, or null when it is not one. */
export const parseTagList = (raw: string | null): string[] | null => {
  if (raw == null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.every((t) => typeof t === "string") ? v : null;
  } catch {
    return null;
  }
};
