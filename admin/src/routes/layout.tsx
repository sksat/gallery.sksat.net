import { component$, Slot } from "@builder.io/qwik";
import { Link, useLocation } from "@builder.io/qwik-city";
import { ThemeToggle } from "~/components/theme-toggle";

const NAV = [
  { href: "/", label: "Dashboard", match: (p: string) => p === "/" },
  {
    href: "/media/",
    label: "Media",
    match: (p: string) => p.startsWith("/media"),
  },
  {
    href: "/cameras/",
    label: "Cameras",
    match: (p: string) => p.startsWith("/cameras"),
  },
];

export default component$(() => {
  const loc = useLocation();
  const path = loc.url.pathname;

  return (
    <>
      <header class="sticky top-0 z-20 border-b border-zinc-200 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/85">
        <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Link
            href="/"
            class="flex shrink-0 items-center gap-2 rounded font-semibold tracking-tight"
          >
            <span
              aria-hidden="true"
              class="grid size-7 place-items-center rounded-md bg-sky-600 text-xs font-bold text-white"
            >
              GA
            </span>
            {/* Phones: badge only, so three nav links still fit. */}
            <span class="sr-only sm:not-sr-only">Gallery Admin</span>
          </Link>
          <nav aria-label="Main" class="flex items-center gap-1 text-sm">
            {NAV.map((item) => {
              const active = item.match(path);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  class={[
                    "rounded-md px-3 py-1.5 font-medium transition-colors",
                    active
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
                  ]}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <main class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Slot />
      </main>
    </>
  );
});
