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

/**
 * A photo's choices per tag (media.tag_visibility, 0021: tag → "hidden")
 * as a plain object, or null for none / not an object.
 */
export type TagChoiceMap = Record<string, string>;

const has = (o: TagChoiceMap, k: string) => Object.hasOwn(o, k);

const put = (o: TagChoiceMap, k: string, v: string) =>
  Object.defineProperty(o, k, {
    value: v,
    enumerable: true,
    writable: true,
    configurable: true,
  });

/**
 * `choices` after renaming `from` to `to` (the same object when it has
 * no choice for `from`): the choice moves to the new name, in place. On a
 * merge where the photo chose for both, it hides the tag when it hid
 * either (a merge never shows a tag a photo hid).
 */
export const renameInChoices = (
  choices: TagChoiceMap,
  from: string,
  to: string,
): TagChoiceMap => {
  if (!has(choices, from)) return choices;
  const value =
    choices[from] === "hidden" || (has(choices, to) && choices[to] === "hidden")
      ? "hidden"
      : has(choices, to)
        ? choices[to]
        : choices[from];
  const out: TagChoiceMap = {};
  for (const [k, v] of Object.entries(choices)) {
    if (k === from) {
      if (!has(choices, to)) put(out, to, value);
    } else put(out, k, k === to ? value : v);
  }
  return out;
};

const sameChoices = (a: TagChoiceMap, b: TagChoiceMap) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The undo of renameInChoices: `before` when the choices are still what
 * the rename made of them; otherwise only the rename is taken back. The
 * choice for `to` goes back to what it was while it is still what the
 * rename left (an edit since stays); the one for `from` returns, and
 * `from` is hidden when the photo hid `to` since (the tag it hid under
 * the new name must not show again under the old one).
 */
export const unrenameInChoices = (
  current: TagChoiceMap,
  before: TagChoiceMap,
  from: string,
  to: string,
): TagChoiceMap => {
  const after = renameInChoices(before, from, to);
  if (sameChoices(current, after)) return before;
  const out: TagChoiceMap = {};
  for (const [k, v] of Object.entries(current)) put(out, k, v);
  const toEdited = has(after, to)
    ? !has(current, to) || current[to] !== after[to]
    : has(current, to);
  if (!toEdited) {
    if (has(before, to)) put(out, to, before[to]);
    else delete out[to];
  }
  if (!has(out, from)) {
    if (toEdited && has(current, to) && current[to] === "hidden") {
      put(out, from, "hidden");
    }
    else if (has(before, from)) put(out, from, before[from]);
  }
  return sameChoices(out, current) ? current : out;
};

/**
 * A stored JSON object of tag choices; null when none or not one. A value
 * that is not a string is "hidden", as the API Worker reads it (fail
 * closed); a JSON null is no choice.
 */
export const parseChoiceMap = (raw: string | null): TagChoiceMap | null => {
  if (raw == null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    const out: TagChoiceMap = {};
    for (const [k, c] of Object.entries(v)) {
      if (c === null) continue;
      put(out, k, c === "shown" ? "shown" : "hidden");
    }
    return out;
  } catch {
    return null;
  }
};

/** Choices as stored: none is NULL. */
export const storedChoiceMap = (c: TagChoiceMap): string | null =>
  Object.keys(c).length > 0 ? JSON.stringify(c) : null;

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
