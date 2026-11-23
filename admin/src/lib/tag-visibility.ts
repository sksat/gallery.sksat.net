// Which tags a photo hides (migration 0021; pure, tag-visibility.spec.ts).
// A public tag (`tag.public`, on /tag/) is shown on every photo that does
// not hide it; a private tag is never shown, on any photo, and a photo
// cannot make it public. So a photo stores only the public tags it hides
// (media.tag_visibility: tag → "hidden"), its camera's tags included. The
// API Worker decides with the same tagShown (shared/tag-field).
//
// A "hidden" already stored for a private tag (0021 hid every tag of the
// photos whose tags were hidden) stays: if the tag is made public, that
// photo still hides it.

import {
  ownTagChoice,
  tagShown,
  type TagFieldLevel,
} from "@shared/tag-field/tag-field";

export type TagChoices = Record<string, TagFieldLevel>;

type TagSet = { has(tag: string): boolean };

const setOwn = <T>(o: Record<string, T>, k: string, value: T) =>
  Object.defineProperty(o, k, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });

/**
 * The edit page's tag editor as a patch (media.tag_visibility, null = no
 * choice): only the public tags switched since the page loaded
 * (`hiddenThen`: hidden when it loaded, `hiddenNow`: hidden now). A
 * private tag cannot be switched.
 */
export const chipPatch = (
  hiddenThen: readonly string[],
  hiddenNow: readonly string[],
  publicTags: TagSet,
): Record<string, "hidden" | null> => {
  const out: Record<string, "hidden" | null> = {};
  for (const tag of new Set([...hiddenThen, ...hiddenNow])) {
    if (!publicTags.has(tag)) continue;
    const now = hiddenNow.includes(tag);
    if (now !== hiddenThen.includes(tag))
      setOwn(out, tag, now ? "hidden" : null);
  }
  return out;
};

/**
 * A photo's choices after making each public tag of `targets` shown
 * (true) or hidden (false) on it, for the tags among `tags` (the ones it
 * has). A tag already so, or a private one, is left as it is.
 */
export const withTargets = (
  current: Readonly<TagChoices>,
  tags: readonly string[],
  targets: Readonly<Record<string, boolean>>,
  publicTags: TagSet,
): TagChoices => {
  const out: TagChoices = {};
  for (const [k, v] of Object.entries(current)) setOwn(out, k, v);
  for (const [tag, shown] of Object.entries(targets)) {
    if (!tags.includes(tag) || !publicTags.has(tag)) continue;
    if (tagShown(tag, current, publicTags) === shown) continue;
    if (shown) delete out[tag];
    else setOwn(out, tag, "hidden");
  }
  return out;
};

/** The choices for tags among `tags` only. */
export const keepChoices = (
  current: Readonly<TagChoices>,
  tags: readonly string[],
): TagChoices => {
  const out: TagChoices = {};
  for (const [k, v] of Object.entries(current)) {
    if (tags.includes(k)) setOwn(out, k, v);
  }
  return out;
};

/** How choices are stored: none is NULL. */
export const storedChoices = (c: Readonly<TagChoices>): string | null =>
  Object.keys(c).length > 0 ? JSON.stringify(c) : null;

/**
 * For the edit page's chips: whether the photo shows `tag`, whether that
 * is because the photo hides it (rather than the tag being private), and
 * whether it can be switched at all (only a public tag can).
 */
export const tagState = (
  tag: string,
  choices: Readonly<TagChoices>,
  publicTags: TagSet,
): { shown: boolean; own: boolean; locked: boolean } => ({
  shown: tagShown(tag, choices, publicTags),
  own: publicTags.has(tag) && ownTagChoice(choices, tag) === "hidden",
  locked: !publicTags.has(tag),
});
