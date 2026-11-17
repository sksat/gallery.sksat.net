import { $, component$ } from "@builder.io/qwik";
import { THEME_STORAGE_KEY, nextTheme, parseTheme } from "~/lib/theme";

// Cycles system → light → dark. The current choice lives only on
// <html data-theme> (set before paint by the inline script in root.tsx), so
// SSR does not need to know it: each state's label is rendered and CSS shows
// the one matching the attribute. Hidden labels are display:none and drop
// out of the accessible name, so the button is announced as e.g.
// "Theme: Dark". The `title` names what the next click does.

const stateClass = {
  // "system" also covers a missing attribute (no JS / script blocked).
  system:
    "hidden [:root:not([data-theme=light]):not([data-theme=dark])_&]:inline-flex",
  light: "hidden [:root[data-theme=light]_&]:inline-flex",
  dark: "hidden [:root[data-theme=dark]_&]:inline-flex",
} as const;

const iconProps = {
  "aria-hidden": "true" as const,
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 2,
  "stroke-linecap": "round" as const,
  "stroke-linejoin": "round" as const,
};

export const ThemeToggle = component$(() => {
  const cycle = $((_: Event, el: HTMLButtonElement) => {
    const root = document.documentElement;
    const next = nextTheme(parseTheme(root.getAttribute("data-theme")));
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice still applies to this page view.
    }
    el.title = `Switch theme (next: ${nextTheme(next)})`;
  });

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      title="Switch theme (system → light → dark)"
      onClick$={cycle}
      class="ml-auto inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-zinc-200 px-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      <span class="sr-only">Theme: </span>
      <span class={[stateClass.system, "items-center gap-2"]}>
        <svg {...iconProps}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
        <span class="max-sm:sr-only">System</span>
      </span>
      <span class={[stateClass.light, "items-center gap-2"]}>
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        <span class="max-sm:sr-only">Light</span>
      </span>
      <span class={[stateClass.dark, "items-center gap-2"]}>
        <svg {...iconProps}>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
        <span class="max-sm:sr-only">Dark</span>
      </span>
    </button>
  );
});
