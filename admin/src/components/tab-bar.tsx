import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";

export type TabItem = { href: string; label: string; active: boolean };

const icon = {
  "/": "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  "/media/": "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5",
  "/camera/": "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
} as Record<string, string>;

/**
 * Phones: the main sections as a tab bar fixed to the bottom, in thumb
 * reach. Hidden while a page shows its own bottom bar (global.css).
 * Upload will get a fourth tab.
 */
export const TabBar = component$<{ items: TabItem[] }>(({ items }) => (
  <nav
    aria-label="Main"
    data-tab-bar
    class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-zinc-200 bg-white/95 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur sm:hidden dark:border-zinc-800 dark:bg-zinc-900/95"
  >
    {items.map((item) => {
      const { active } = item;
      return (
        <Link
          key={item.href}
          href={item.href}
          aria-current={active ? "page" : undefined}
          class={[
            "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
            active
              ? "text-sky-700 dark:text-sky-400"
              : "text-zinc-500 dark:text-zinc-400",
          ]}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width={active ? 2.25 : 1.75}
            stroke-linecap="round"
            stroke-linejoin="round"
            class="size-6"
          >
            <path d={icon[item.href]} />
          </svg>
          {item.label}
        </Link>
      );
    })}
  </nav>
));
