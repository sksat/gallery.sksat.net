// Which photos look like a retouched version of another photo: the same
// name in the same folder with a suffix that retouching programs (or the
// owner) add ("_DxO", "_lightroom", "-Edit", "_ON1", "-2"), any extension.
// Pure, shared by the merge page, the edit page and the upload panel.
// Covered by retouch-match.spec.ts on names from the library.

import type { Visibility } from "./types";

/**
 * A word a camera or VRChat puts after a name of its own output, not a
 * retouch: VRChat's multi-layer camera writes "<name>_Environment.png" and
 * "<name>_Player.png" beside "<name>.png"; phones add "_HDR".
 */
const NOT_RETOUCH = new Set(["environment", "player", "hdr"]);

/**
 * One suffix at the end of a stem: a separator and a word, a number of one
 * or two digits ("-2": a Lightroom export, "a-1": a taken name numbered on
 * upload), or "(1)" / " (1)" (a copy).
 */
const SUFFIX_RE =
  /(?:[-_ ]([A-Za-z][A-Za-z0-9]*)|[-_ ](\d{1,2})| ?\((\d{1,2})\))$/;

/** Suffixes stripped at most (e.g. "-ON1-Edit-2"). */
const MAX_SUFFIXES = 3;

/** "/a/b/IMG_1.JPG" → { dir: "/a/b", stem: "IMG_1", ext: ".JPG" }. */
export const splitName = (
  path: string,
): { dir: string; stem: string; ext: string } => {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? { dir, stem: name.slice(0, dot), ext: name.slice(dot) }
    : { dir, stem: name, ext: "" };
};

/**
 * The stems `stem` may be a retouch of, nearest first: each one with one
 * more suffix taken off ("a_ON1-Edit" → "a_ON1", "a"). Stops at a word
 * that is not a retouch's.
 */
export const baseStems = (stem: string): string[] => {
  const out: string[] = [];
  let s = stem;
  for (let i = 0; i < MAX_SUFFIXES; i++) {
    const m = SUFFIX_RE.exec(s);
    if (!m || m.index === 0) break;
    if (m[1] && NOT_RETOUCH.has(m[1].toLowerCase())) break;
    s = s.slice(0, m.index);
    out.push(s);
  }
  return out;
};

/** Folder + stem, compared without case (the extension is not compared). */
const keyOf = (dir: string, stem: string) => `${dir}/${stem}`.toLowerCase();

export type NamedPhoto = { id: number; path: string };

export type RetouchPair = {
  /** The photo with the plain name. */
  original: number;
  /** The one with the suffix. */
  retouch: number;
};

/**
 * Every pair of photos (in `photos`) where one's name is the other's with
 * retouch suffixes. A retouch pairs with its plainest original: of
 * "a.png", "a_ON1.png" and "a_ON1-Edit.jpg", both of the others pair with
 * "a.png". With two photos of the same stem (a.png and a.jpg), neither is
 * taken for the other's retouch. Ordered by the retouch's path.
 */
export const findRetouchPairs = (
  photos: readonly NamedPhoto[],
): RetouchPair[] => {
  const byKey = new Map<string, NamedPhoto[]>();
  for (const p of photos) {
    const { dir, stem } = splitName(p.path);
    const k = keyOf(dir, stem);
    const list = byKey.get(k);
    if (list) list.push(p);
    else byKey.set(k, [p]);
  }
  const pairs: { pair: RetouchPair; path: string }[] = [];
  for (const p of photos) {
    const { dir, stem } = splitName(p.path);
    let original: NamedPhoto | null = null;
    for (const base of baseStems(stem)) {
      const found = byKey.get(keyOf(dir, base));
      // One photo of that name: a pair; several: ambiguous, left alone.
      if (found?.length === 1 && found[0].id !== p.id) original = found[0];
    }
    if (original) {
      pairs.push({
        pair: { original: original.id, retouch: p.id },
        path: p.path,
      });
    }
  }
  return pairs
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((x) => x.pair);
};

/**
 * The plain stems an upload of `file` may be a retouch of, plainest last:
 * its own (a photo of the same name whose bytes differ) and each with
 * suffixes taken off.
 */
export const uploadBaseStems = (file: string): string[] => {
  const { stem } = splitName(file);
  return [stem, ...baseStems(stem)];
};

/** Programs that retouch photos, by their CreatorTool / Software. */
const RETOUCH_TOOL_RE =
  /lightroom|photoshop|camera raw|\bon1\b|dxo|capture one|luminar|darktable|rawtherapee|affinity|gimp|snapseed|pixelmator|acdsee|silkypix|photo ?lab|topaz|picture ?(?:manager|style)/i;

/** Whether a creator tool names a retouching program. */
export const isRetouchTool = (tool: string | null | undefined): boolean =>
  !!tool && RETOUCH_TOOL_RE.test(tool);

/** An ISO date-time to the second ("2026-06-04T03:20:34"), offset kept off. */
const toSecond = (iso: string | null): string | null =>
  iso ? iso.slice(0, 19) : null;

/** What else the two photos share, besides the name. */
export type RetouchSignals = {
  /** Taken at the same second (in their own offsets). */
  sameTime: boolean;
  sameCamera: boolean;
  /** The retouch's program, when it is a retouching one. */
  tool: string | null;
};

export const retouchSignals = (
  original: { timestamp: string | null; camera_id: number | null },
  retouch: {
    timestamp: string | null;
    camera_id: number | null;
    creator_tool: string | null;
  },
): RetouchSignals => {
  const a = toSecond(original.timestamp);
  return {
    sameTime: a !== null && a === toSecond(retouch.timestamp),
    sameCamera:
      original.camera_id !== null && original.camera_id === retouch.camera_id,
    tool: isRetouchTool(retouch.creator_tool) ? retouch.creator_tool : null,
  };
};

const RANK: Record<Visibility, number> = { private: 0, unlisted: 1, public: 2 };

/**
 * What a merge does unless chosen otherwise: the merged photo keeps the
 * original's visibility when the two agree, and there is no default when
 * they differ (the owner chooses: a more visible one would publish the
 * original's metadata, a less visible one takes a photo off the site). It
 * shows the retouch when the retouch was the more visible one (it was the
 * one on the site); otherwise it keeps showing what it shows.
 */
export const defaultMerge = (
  original: Visibility,
  retouch: Visibility,
): { visibility: Visibility | null; show: boolean } => ({
  visibility: original === retouch ? original : null,
  show: RANK[retouch] > RANK[original],
});
