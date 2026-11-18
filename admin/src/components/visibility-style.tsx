import type { Visibility } from "~/lib/types";

// Who can see a photo, in one visual language used everywhere (badges, the
// edit page's choices, the /media selection bar, the full-screen viewer):
// an icon and a label, never colour alone. Public stands out (filled sky,
// globe); unlisted is amber (link); private is the quietest (zinc, lock).

/** Icon paths (20×20, filled, evenodd). */
export const VISIBILITY_ICON: Record<Visibility, string> = {
  // Globe.
  public:
    "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm5.9 7h-2.95a12.6 12.6 0 0 0-1.1-4.66A6.01 6.01 0 0 1 15.9 9ZM10 4.04c.66.8 1.63 2.56 1.94 4.96H8.06C8.37 6.6 9.34 4.84 10 4.04ZM8.15 4.34A12.6 12.6 0 0 0 7.05 9H4.1a6.01 6.01 0 0 1 4.05-4.66ZM4.1 11h2.95a12.6 12.6 0 0 0 1.1 4.66A6.01 6.01 0 0 1 4.1 11Zm5.9 4.96c-.66-.8-1.63-2.56-1.94-4.96h3.88c-.31 2.4-1.28 4.16-1.94 4.96Zm1.85-.3A12.6 12.6 0 0 0 12.95 11h2.95a6.01 6.01 0 0 1-4.05 4.66Z",
  // Link.
  unlisted:
    "M8.46 11.54a.75.75 0 0 1 0-1.06l2.02-2.02a.75.75 0 1 1 1.06 1.06l-2.02 2.02a.75.75 0 0 1-1.06 0ZM7.4 9.4a.75.75 0 0 1 0 1.06l-1.6 1.6a1.75 1.75 0 0 0 2.47 2.48l1.6-1.6a.75.75 0 1 1 1.06 1.06l-1.6 1.6a3.25 3.25 0 0 1-4.6-4.6l1.6-1.6a.75.75 0 0 1 1.07 0Zm5.2 1.2a.75.75 0 0 1 0-1.06l1.6-1.6a1.75 1.75 0 0 0-2.47-2.48l-1.6 1.6a.75.75 0 0 1-1.06-1.06l1.6-1.6a3.25 3.25 0 0 1 4.6 4.6l-1.6 1.6a.75.75 0 0 1-1.07 0Z",
  // Lock.
  private:
    "M10 2.5a3.5 3.5 0 0 0-3.5 3.5v2H6a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 6 17h8a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 14 8h-.5V6A3.5 3.5 0 0 0 10 2.5ZM12 8V6a2 2 0 1 0-4 0v2h4Z",
};

/**
 * Class strings per visibility:
 * - `badge`: the level's own look (badges, and a choice that is selected);
 * - `selected`: the same look for a selected choice (with `ring-2`-able
 *   ring colour);
 * - `accent`: an unselected choice's icon/text colour on a neutral
 *   surface, so each level keeps its colour cue;
 * - `card`: a radio card (the edit page) once its radio is checked, a
 *   lighter tint of the level so its help text stays readable;
 * - `onDark`: the accent on the full-screen viewer's dark backdrop.
 */
export const VISIBILITY_STYLE: Record<
  Visibility,
  {
    badge: string;
    selected: string;
    accent: string;
    card: string;
    onDark: string;
  }
> = {
  public: {
    onDark: "text-sky-300",
    card: "has-checked:border-sky-500 has-checked:bg-sky-50 has-checked:ring-1 has-checked:ring-sky-500 dark:has-checked:border-sky-500 dark:has-checked:bg-sky-950/50 dark:has-checked:ring-sky-500",
    badge:
      "bg-sky-600 text-white ring-sky-600 dark:bg-sky-500 dark:text-zinc-950 dark:ring-sky-500",
    selected:
      "bg-sky-600 text-white ring-sky-600 dark:bg-sky-500 dark:text-zinc-950 dark:ring-sky-500",
    accent: "text-sky-700 dark:text-sky-400",
  },
  unlisted: {
    onDark: "text-amber-300",
    card: "has-checked:border-amber-400 has-checked:bg-amber-50 has-checked:ring-1 has-checked:ring-amber-400 dark:has-checked:border-amber-600 dark:has-checked:bg-amber-950/50 dark:has-checked:ring-amber-600",
    badge:
      "bg-amber-50 text-amber-800 ring-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800",
    selected:
      "bg-amber-50 text-amber-800 ring-amber-400 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-600",
    accent: "text-amber-700 dark:text-amber-400",
  },
  private: {
    onDark: "text-zinc-300",
    card: "has-checked:border-zinc-500 has-checked:bg-zinc-100 has-checked:ring-1 has-checked:ring-zinc-500 dark:has-checked:border-zinc-400 dark:has-checked:bg-zinc-800 dark:has-checked:ring-zinc-400",
    badge:
      "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700",
    selected:
      "bg-zinc-200 text-zinc-900 ring-zinc-500 dark:bg-zinc-700 dark:text-zinc-100 dark:ring-zinc-400",
    accent: "text-zinc-600 dark:text-zinc-400",
  },
};

/** Short Japanese labels (the bar and the viewer's buttons). */
export const VISIBILITY_LABELS_JA: Record<Visibility, string> = {
  private: "非公開",
  unlisted: "限定公開",
  public: "公開",
};

// A plain function component (not component$): it renders as part of its
// parent.
export const VisibilityIcon = ({
  visibility,
  class: cls = "size-4",
}: {
  visibility: Visibility;
  class?: string;
}) => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    class={["shrink-0", cls]}
  >
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d={VISIBILITY_ICON[visibility]}
    />
  </svg>
);
