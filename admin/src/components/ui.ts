// Shared Tailwind class strings. Kept as plain constants (not components) so
// they can be applied to native elements and Qwik City's <Link>/<Form>.

export const card =
  "rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

// Phones (below sm): every tap target is at least 44px tall (h-11), and
// form controls use 16px text so iOS Safari does not zoom in on focus.

export const buttonPrimary =
  "inline-flex items-center justify-center gap-2 h-11 min-w-11 sm:h-10 sm:min-w-0 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60";

export const buttonSecondary =
  "inline-flex items-center justify-center gap-2 h-11 min-w-11 sm:h-10 sm:min-w-0 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";

export const field =
  "box-border block h-11 sm:h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500";

export const textarea =
  "box-border block min-h-24 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500";

export const label =
  "mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300";

export const muted = "text-zinc-500 dark:text-zinc-400";

export const link =
  "rounded font-medium text-sky-700 underline-offset-4 hover:underline dark:text-sky-400";

/** "← Media" style back links: a 44px-tall hit area on phones. */
export const backLink = `${link} inline-flex min-h-11 items-center pr-3 sm:min-h-0`;

export const worldBadge = (world: string): string =>
  [
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
    world === "VRChat"
      ? "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-800"
      : "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800",
  ].join(" ");

/** Labels for a photo's visibility (see Visibility in lib/types.ts). */
export const VISIBILITY_LABELS = {
  private: "Private",
  unlisted: "Unlisted",
  public: "Public",
} as const;

export const visibilityBadge = (visibility: string): string =>
  [
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
    visibility === "public"
      ? "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-800"
      : visibility === "unlisted"
        ? "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800"
        : "bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  ].join(" ");

export const kindBadge =
  "inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 ring-inset dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700";

export const tagChip =
  "inline-flex items-center rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
