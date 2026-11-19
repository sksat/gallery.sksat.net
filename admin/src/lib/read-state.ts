// Whether this tab has found nothing left for the background metadata
// reader (src/components/metadata-reader.tsx) to read, per parser date,
// in sessionStorage: it asks the server again only in a new tab, after
// the parser changes, or after markUnread (an upload, ファイルの値に戻す).
// markUnread also bumps a generation and tells a reader on this page to
// run, so a run that started earlier cannot mark the tab done over it.

import { PHOTO_META_PARSER_DATE } from "./photo-meta";

const KEY = "admin-metadata-read";
const GEN_KEY = "admin-metadata-unread-gen";

/** Window event: something may need reading now. */
export const UNREAD_EVENT = "admin-metadata-unread";

const get = (k: string): string | null => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};

const set = (k: string, v: string | null) => {
  try {
    if (v === null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, v);
  } catch {
    // Storage blocked: it just asks again next time.
  }
};

export const isReadDone = (): boolean => get(KEY) === PHOTO_META_PARSER_DATE;

/** The generation a run starts at (pass it to setReadDone). */
export const readGeneration = (): string => get(GEN_KEY) ?? "0";

/** Nothing left, unless markUnread happened since `generation`. */
export const setReadDone = (generation: string): void => {
  if (readGeneration() === generation) set(KEY, PHOTO_META_PARSER_DATE);
};

/**
 * Something may need reading again: look on later pages, and with `now`
 * on this one too (ファイルの値に戻す; an upload only clears the flag, not
 * to post on every finished file).
 */
export const markUnread = ({ now = false } = {}): void => {
  set(KEY, null);
  set(GEN_KEY, String(Number(readGeneration()) + 1));
  if (now && typeof window !== "undefined") {
    window.dispatchEvent(new Event(UNREAD_EVENT));
  }
};
