// Going through the photos whose resized copies are to be made, in the
// browser (pure, with injected deps; resize-job.spec.ts): first the
// photos this tab just uploaded (it has their files, so nothing is
// downloaded), then any waiting, a claim of a few at a time, one photo
// after another, until the server has none left. Used by
// src/components/resize-maker.tsx; the server side is src/lib/resized.ts.

import type { ClaimedPhoto } from "./resized";
import type { CardCaption } from "@shared/resized/resized";
import type { WantedCard } from "./resized";
import { ResizeError, type MadeCopy } from "./resize-make";

export type ResizeDeps = {
  /** Claim the photos `ids` (the uploads), or any waiting. */
  claim(ids?: number[]): Promise<{ photos: ClaimedPhoto[]; more: boolean }>;
  /** The claimed photo's file; ResizeError when there is none. */
  fetchFile(p: ClaimedPhoto): Promise<Blob>;
  /** Make the copies; ResizeError when this browser cannot. */
  make(file: Blob, caption: CardCaption | null): Promise<MadeCopy[]>;
  /** Store them; false when the claim was lost (nothing stored). */
  store(p: ClaimedPhoto, copies: MadeCopy[]): Promise<boolean>;
  /** The copies cannot be made here: try again in a day. */
  fail(p: ClaimedPhoto): Promise<void>;
  /** Wait before each photo (the tab visible, the browser idle). */
  pace(): Promise<void>;
  /** After each photo made. */
  onMade?(): void;
};

/** Uploaded files waiting for their copies, by photo id. */
export type PendingFiles = Map<number, Blob>;

/** Uploads claimed at once. */
const UPLOAD_CLAIM = 10;

export type ResizeRun = { made: number; failed: number };

/**
 * Make copies until nothing is left: the uploads in `pending` (taken out
 * as they are claimed; ones another tab claimed are left to it), then, if
 * `waiting`, whatever the server has waiting. Throws on a network or
 * server error (the claims then expire and a later run takes them).
 */
export const runResize = async (
  deps: ResizeDeps,
  pending: PendingFiles,
  { waiting = true }: { waiting?: boolean } = {},
): Promise<ResizeRun> => {
  const run: ResizeRun = { made: 0, failed: 0 };
  const makeOne = async (p: ClaimedPhoto, local: Blob | null) => {
    await deps.pace();
    try {
      // The uploaded file is the original; a photo resized from another
      // file (a display copy) has its file fetched.
      const file =
        local && p.source.role === "original" ? local : await deps.fetchFile(p);
      const copies = await deps.make(file, p.caption);
      if (await deps.store(p, copies)) {
        run.made++;
        deps.onMade?.();
      }
    } catch (err) {
      if (!(err instanceof ResizeError)) throw err;
      console.warn(`resized copies of ${p.id}: ${err.message}`);
      await deps.fail(p);
      run.failed++;
    }
  };
  for (;;) {
    if (pending.size > 0) {
      const ids = [...pending.keys()].slice(0, UPLOAD_CLAIM);
      const files = new Map(ids.map((id) => [id, pending.get(id)!]));
      for (const id of ids) pending.delete(id);
      const { photos } = await deps.claim(ids);
      for (const p of photos) await makeOne(p, files.get(p.id) ?? null);
      continue;
    }
    if (!waiting) return run;
    const { photos, more } = await deps.claim();
    for (const p of photos) await makeOne(p, null);
    if (!more && pending.size === 0) return run;
  }
};

export type CardDeps = {
  /** A page of the cards the image Worker asked for, and the next's. */
  wanted(
    cursor: string | null,
  ): Promise<{ cards: WantedCard[]; cursor: string | null }>;
  /** The photo's largest stored copy (decoded by `draw`); null if none. */
  fetchCopy(card: WantedCard): Promise<Blob | null>;
  /** Draw the `og` card with its caption. */
  draw(copy: Blob, card: WantedCard): Promise<Blob>;
  /** Store it; false when the photo shows another file now. */
  store(card: WantedCard, og: Blob): Promise<boolean>;
  pace(): Promise<void>;
};

/**
 * Make the `og` cards the image Worker asked for (their caption changed),
 * page by page, until a pass over every page makes none (the ones left
 * wait for their copies, or failed here: a later run tries again). A pass
 * that made some starts again from the first page, as their requests are
 * gone and new ones may have come. Throws on a network or server error.
 */
export const runCards = async (deps: CardDeps): Promise<number> => {
  let made = 0;
  let cursor: string | null = null;
  let pass = 0;
  for (;;) {
    const page = await deps.wanted(cursor);
    const { cards } = page;
    let batch = 0;
    for (const card of cards) {
      await deps.pace();
      const copy = await deps.fetchCopy(card);
      if (!copy) continue;
      let og: Blob;
      try {
        og = await deps.draw(copy, card);
      } catch (err) {
        console.warn(`og card of ${card.id}:`, err);
        continue;
      }
      if (await deps.store(card, og)) batch++;
    }
    made += batch;
    pass += batch;
    cursor = page.cursor;
    if (cursor === null) {
      if (pass === 0) return made;
      pass = 0;
    }
  }
};
