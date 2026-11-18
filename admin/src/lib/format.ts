// Presentation helpers shared by the admin routes. Pure functions only so
// they stay covered by Vitest (see format.spec.ts).

/** Split a media path into its folder (with trailing slash) and basename. */
export const splitPath = (file: string): { dir: string; base: string } => {
  const i = file.lastIndexOf("/");
  return { dir: file.slice(0, i + 1), base: file.slice(i + 1) };
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Format an ISO timestamp as `YYYY/MM/DD HH:mm` in JST (UTC+9, no DST).
 * Done by hand rather than via `Intl` so the output does not depend on the
 * runtime's ICU data (workerd vs Node vs the browser).
 * Returns null for a missing value and the input unchanged if unparseable.
 */
export const formatJst = (ts: string | null): string | null => {
  if (!ts) return null;
  // Date.parse is lenient (V8 accepts "sometime in 2023") and reads an
  // offset-less date-time as runtime-local time; only trust ISO 8601
  // date-times that carry an explicit offset.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(ts)) {
    return ts;
  }
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return ts;
  const d = new Date(ms + JST_OFFSET_MS);
  return (
    `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
};

export type MediaView = "list" | "files";

/**
 * The platform filter of a /media URL: `platform`, or `world`, its name
 * before the rename (old links and bookmarks keep working).
 */
export const platformParam = (
  params: URLSearchParams,
): "Real" | "VRChat" | null => {
  const v = params.get("platform") ?? params.get("world");
  return v === "Real" || v === "VRChat" ? v : null;
};

/** The `view` query value; anything but "files" is the default list. */
export const parseView = (raw: string | null | undefined): MediaView =>
  raw === "files" ? "files" : "list";

/**
 * URL of a /media page, omitting defaults (list view, root folder, no
 * filter, page 1). `dir` only applies to the files view and `page` only to
 * the list view. Slashes in values are left unescaped (valid in a query)
 * so `dir=/VRChat/2023-12` stays readable.
 */
export const mediaListHref = (opts: {
  view?: MediaView;
  dir?: string | null;
  platform?: string | null;
  visibility?: string | null;
  q?: string | null;
  page?: number;
}): string => {
  const params = new URLSearchParams();
  const files = opts.view === "files";
  if (files) params.set("view", "files");
  if (files && opts.dir && opts.dir !== "/") params.set("dir", opts.dir);
  if (opts.platform) params.set("platform", opts.platform);
  if (opts.visibility) params.set("visibility", opts.visibility);
  if (opts.q) params.set("q", opts.q);
  if (!files && opts.page && opts.page > 1) {
    params.set("page", String(opts.page));
  }
  const s = params.toString().replace(/%2F/gi, "/");
  return s ? `/media/?${s}` : "/media/";
};

/** Public site that serves /photo/<public_id>/. */
export const PUBLIC_SITE_URL = "https://gallery.sksat.net";

/** A photo's page on the public site. */
export const publicPhotoUrl = (publicId: string): string =>
  `${PUBLIC_SITE_URL}/photo/${publicId}/`;

/**
 * "#m-<id>" on a /media list URL marks the photo the user came back from
 * (the edit page's "← Media"), so the list can scroll to it.
 */
export const mediaAnchor = (id: number): string => `#m-${id}`;

export const parseMediaAnchor = (hash: string): number | null => {
  const m = /^#m-([1-9]\d{0,15})$/.exec(hash);
  return m ? Number(m[1]) : null;
};

export type FilterChip = { key: string; label: string; href: string };

/**
 * The active /media filters as chips, each with the list URL that drops
 * just that filter (keeping the view and folder; back to page 1).
 */
export const filterChips = (opts: {
  view: MediaView;
  dir: string;
  platform: string | null;
  visibility: string | null;
  q: string;
  /** Display name of a visibility value. */
  visibilityLabel: (v: string) => string;
}): FilterChip[] => {
  const base = {
    view: opts.view,
    dir: opts.dir,
    platform: opts.platform,
    visibility: opts.visibility,
    q: opts.q,
  };
  const chips: FilterChip[] = [];
  if (opts.platform) {
    chips.push({
      key: "platform",
      label: opts.platform,
      href: mediaListHref({ ...base, platform: null }),
    });
  }
  if (opts.visibility) {
    chips.push({
      key: "visibility",
      label: opts.visibilityLabel(opts.visibility),
      href: mediaListHref({ ...base, visibility: null }),
    });
  }
  if (opts.q) {
    chips.push({
      key: "q",
      label: `“${opts.q}”`,
      href: mediaListHref({ ...base, q: null }),
    });
  }
  return chips;
};

/**
 * Edit page URL that remembers the list it was opened from (`?back=`), so
 * "← Media" returns to the same view, folder, filter and page.
 */
export const mediaEditHref = (id: number, back: string): string =>
  back === "/media/"
    ? `/media/${id}/`
    : `/media/${id}/?back=${encodeURIComponent(back)}`;

/**
 * The list URL to go back to from an edit page: `?back=` when it is a
 * /media list URL on this site, otherwise the list root (never an
 * arbitrary or external URL).
 */
export const safeBackHref = (raw: string | null): string =>
  raw !== null && /^\/media\/(\?[^#]*)?$/.test(raw) ? raw : "/media/";

/** Number of the last page (1-based); 1 when there are no rows. */
export const lastPage = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(total / pageSize));
