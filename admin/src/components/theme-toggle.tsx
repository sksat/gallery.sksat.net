import { $, component$ } from "@builder.io/qwik";
import {
  THEME_STORAGE_KEY,
  nextTheme,
  parseTheme,
  themeToggleLabel,
  themeToggleLabelScript,
} from "~/lib/theme";

// Icon-only toggle cycling system → light → dark. The current choice lives
// only on <html data-theme> (set before paint by the inline script in
// root.tsx), so SSR does not know it:
// - all three icons are rendered and CSS shows the one matching the
//   attribute;
// - aria-label/title ("Theme: Dark (switch to System)") are synced by a tiny
//   inline script right after the button, and by the click handler.
// Without JS the attribute is absent, which means "system" — matching the
// SSR'd label.

const stateClass = {
  // "system" also covers a missing attribute (no JS / script blocked).
  system:
    "hidden [:root:not([data-theme=light]):not([data-theme=dark])_&]:block",
  light: "hidden [:root[data-theme=light]_&]:block",
  dark: "hidden [:root[data-theme=dark]_&]:block",
} as const;

const iconProps = {
  "aria-hidden": "true" as const,
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 2,
  "stroke-linecap": "round" as const,
  "stroke-linejoin": "round" as const,
};

/**
 * `menu`: a full-width row with a visible label, for the phone header's
 * menu (the accessible name stays "Theme: …").
 */
export const ThemeToggle = component$<{ menu?: boolean }>(({ menu }) => {
  const cycle = $((_: Event, el: HTMLButtonElement) => {
    const root = document.documentElement;
    const next = nextTheme(parseTheme(root.getAttribute("data-theme")));
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice still applies to this page view.
    }
    const label = themeToggleLabel(next);
    // Every toggle (header and phone menu), not only this one.
    for (const b of document.querySelectorAll<HTMLElement>(
      "[data-theme-toggle]",
    )) {
      b.setAttribute("aria-label", label);
      b.title = label;
    }
    el.setAttribute("aria-label", label);
    el.title = label;
  });

  return (
    <>
      <button
        type="button"
        aria-label={themeToggleLabel("system")}
        title={themeToggleLabel("system")}
        onClick$={cycle}
        data-theme-toggle
        class={
          menu
            ? "flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            : "ml-auto grid size-11 shrink-0 place-items-center rounded-md border border-zinc-200 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 sm:size-9 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        }
      >
        {/* System: monitor */}
        <svg {...iconProps} class={stateClass.system}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
        {/* Light: sun */}
        <svg {...iconProps} class={stateClass.light}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        {/* Dark: moon */}
        <svg {...iconProps} class={stateClass.dark}>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
        {/* "Theme" is the start of the accessible name (label in name). */}
        {menu && <span aria-hidden="true">Theme</span>}
      </button>
      <script dangerouslySetInnerHTML={themeToggleLabelScript} />
    </>
  );
});
