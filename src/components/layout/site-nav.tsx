import { component$ } from "@builder.io/qwik";
import { useLocation } from "@builder.io/qwik-city";

import { CALENDAR_HREF } from "~/components/gallery/calendar";
import { CAMERA_LIST_HREF } from "~/components/gallery/cameras";
import { MAP_HREF } from "~/components/map/places";

/** The site's other places, with 24×24 stroke icons. */
const NAV = [
  {
    href: CALENDAR_HREF,
    label: "カレンダー",
    icon: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4",
  },
  {
    href: MAP_HREF,
    label: "地図",
    // A map pin.
    icon: "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  },
  {
    href: CAMERA_LIST_HREF,
    label: "カメラ",
    icon: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  },
];

/**
 * A page's first line: the way back to every photo on the left, the
 * site's other places on the right.
 */
export const TopLine = component$(() => (
  <div class="mb-3 flex flex-wrap items-center gap-x-3 px-1">
    {/* Plain <a>: see the note in components/layout/header.tsx. */}
    <a
      href="/"
      class="inline-flex min-h-11 items-center text-sm opacity-80 hover:opacity-100 sm:min-h-8"
    >
      ← すべての写真
    </a>
    <SiteNav />
  </div>
));

/**
 * Quiet links to the site's other places, for the right end of a page's
 * first line (next to its back link, or the gallery's count and sort).
 * The section the page belongs to is left out (`section`, else the
 * path's), so it is never a tab bar. `compact`: icons only on phones
 * (where the line is shared with more than a short back link).
 */
export const SiteNav = component$<{ section?: string; compact?: boolean }>(
  ({ section, compact }) => {
    const path = useLocation().url.pathname;
    const here = section ?? path;
    return (
      <nav aria-label="サイト" class="ml-auto flex shrink-0 justify-end">
        {/* Plain <a>s: see the note in components/layout/header.tsx. */}
        {NAV.filter(({ href }) => !here.startsWith(href)).map(
          ({ href, label, icon }) => (
            <a
              key={href}
              href={href}
              title={compact ? label : undefined}
              class={[
                "inline-flex min-h-11 items-center gap-1 rounded text-sm whitespace-nowrap opacity-80 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white sm:min-h-8 sm:px-2",
                compact ? "min-w-11 justify-center" : "px-2",
              ]}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d={icon} />
              </svg>
              <span class={compact ? "max-sm:sr-only" : undefined}>
                {label}
              </span>
            </a>
          ),
        )}
      </nav>
    );
  },
);
