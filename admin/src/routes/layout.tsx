import { component$, Slot } from "@builder.io/qwik";
import { Link, useLocation } from "@builder.io/qwik-city";
import { TabBar } from "~/components/tab-bar";
import { ThemeToggle } from "~/components/theme-toggle";

const NAV = [
  { href: "/", label: "Dashboard", match: (p: string) => p === "/" },
  {
    href: "/media/",
    label: "Media",
    match: (p: string) => p.startsWith("/media"),
  },
  {
    href: "/camera/",
    label: "Cameras",
    match: (p: string) => p === "/camera" || p.startsWith("/camera/"),
  },
  {
    href: "/calendar/",
    label: "Calendar",
    match: (p: string) => p.startsWith("/calendar"),
  },
  {
    href: "/map/",
    label: "Map",
    match: (p: string) => p.startsWith("/map"),
  },
  { href: "/tag/", label: "Tags", match: (p: string) => p.startsWith("/tag") },
  {
    href: "/setting/",
    label: "Settings",
    match: (p: string) => p.startsWith("/setting"),
  },
];

/** The sections in the phone tab bar; the others are in its menu. */
const TABS = 3;

// sm and up: one header with the nav and the theme toggle. Phones: a slim
// top bar (badge, section name, a menu holding the theme toggle) and the
// sections as a tab bar at the bottom, in thumb reach.
export default component$(() => {
  const loc = useLocation();
  const path = loc.url.pathname;
  const items = NAV.map(({ href, label, match }) => ({
    href,
    label,
    active: match(path),
  }));
  const section = items.find((i) => i.active && i.href !== "/");

  return (
    <>
      <header class="sticky top-0 z-20 border-b border-zinc-200 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/85">
        <div class="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4 sm:h-14 sm:gap-6 sm:px-6">
          <Link
            prefetch="js"
            href="/"
            class="flex shrink-0 items-center gap-2 rounded font-semibold tracking-tight"
          >
            <span
              aria-hidden="true"
              class="grid size-7 place-items-center rounded-md bg-sky-600 text-xs font-bold text-white"
            >
              GA
            </span>
            <span class={section ? "sr-only sm:not-sr-only" : undefined}>
              Gallery Admin
            </span>
          </Link>
          {section && (
            <span
              aria-hidden="true"
              class="truncate text-base font-semibold sm:hidden"
            >
              {section.label}
            </span>
          )}
          <nav
            aria-label="Main"
            class="hidden items-center gap-1 text-sm sm:flex"
          >
            {items.map((item) => (
              <Link
                prefetch="js"
                key={item.href}
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                class={[
                  "inline-flex items-center rounded-md px-3 py-1.5 font-medium transition-colors",
                  item.active
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
                ]}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div class="ml-auto hidden sm:block">
            <ThemeToggle />
          </div>
          {/* Phones: settings behind a small menu. */}
          {/* Keyed by path: closed again after moving to another page. */}
          <details key={path} class="relative ml-auto sm:hidden">
            <summary
              aria-label="Menu"
              class="grid size-11 cursor-pointer list-none place-items-center rounded-md text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 [&::-webkit-details-marker]:hidden"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="size-5"
              >
                <circle cx="5" cy="12" r="1.75" />
                <circle cx="12" cy="12" r="1.75" />
                <circle cx="19" cy="12" r="1.75" />
              </svg>
            </summary>
            <div class="absolute top-full right-0 z-30 mt-1 w-56 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
              {items.slice(TABS).map((item) => (
                <Link
                  prefetch="js"
                  key={item.href}
                  href={item.href}
                  aria-current={item.active ? "page" : undefined}
                  class="flex h-11 items-center rounded-lg px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {item.label}
                </Link>
              ))}
              <ThemeToggle menu />
            </div>
          </details>
        </div>
      </header>
      <main class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Slot />
      </main>
      <TabBar items={items.slice(0, TABS)} />
    </>
  );
});
