// Whether each tag of a photo is public on it (migration 0021; pure,
// tag-visibility.spec.ts). The tag's own setting (`tag.public`, on /tag/)
// is the default; a photo may choose otherwise for any of its tags, its
// camera's included (media.tag_visibility: tag → shown / hidden). The API
// Worker decides with the same tagShown (shared/tag-field).
//
// A choice is stored only where it differs from the tag's setting: making
// a tag public on a photo where the tag is public anyway removes the
// photo's choice, so it follows the tag again. A choice that is already
// stored stays while the tag's state on the photo is not changed (0021
// hid every tag of the photos whose tags were hidden, private ones too).

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

/** The choice to store for `tag` shown or not: null when it is the default. */
export const choiceFor = (
  tag: string,
  shown: boolean,
  publicTags: TagSet,
): TagFieldLevel | null =>
  shown === publicTags.has(tag) ? null : shown ? "shown" : "hidden";

/**
 * The edit page's tag chips as a patch (media.tag_visibility, null = the
 * tag's setting): only the chips switched since the page loaded
 * (`loaded`: tag → shown then), so a tag whose setting changed meanwhile
 * keeps following it.
 */
export const chipPatch = (
  loaded: Readonly<Record<string, boolean>>,
  shownNow: readonly string[],
  publicTags: TagSet,
): Record<string, TagFieldLevel | null> => {
  const out: Record<string, TagFieldLevel | null> = {};
  for (const [tag, was] of Object.entries(loaded)) {
    const now = shownNow.includes(tag);
    if (now !== was) setOwn(out, tag, choiceFor(tag, now, publicTags));
  }
  return out;
};

/**
 * A photo's choices after making each tag of `targets` shown (true) or
 * hidden (false) on it, for the tags among `tags` (the ones it has). A
 * tag already so is left as it is.
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
    if (!tags.includes(tag)) continue;
    if (tagShown(tag, current, publicTags) === shown) continue;
    const choice = choiceFor(tag, shown, publicTags);
    if (choice === null) delete out[tag];
    else setOwn(out, tag, choice);
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
 * For the edit page's chips: whether the photo shows `tag`, and whether
 * that is its own choice rather than the tag's setting.
 */
export const tagState = (
  tag: string,
  choices: Readonly<TagChoices>,
  publicTags: TagSet,
): { shown: boolean; own: boolean } => ({
  shown: tagShown(tag, choices, publicTags),
  own: ownTagChoice(choices, tag) !== undefined,
});
