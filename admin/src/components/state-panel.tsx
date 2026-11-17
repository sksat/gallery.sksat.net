import { component$, Slot } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { buttonSecondary } from "./ui";

// Shared panel for error pages and empty results: a heading, an explanation
// (the slot), and one next action. `level` lets a page-level error own the
// <h1> while an in-page empty state stays an <h2>.
type Props = {
  tone: "error" | "empty";
  title: string;
  level?: 1 | 2;
  action?: { href: string; label: string };
};

export const StatePanel = component$<Props>(
  ({ tone, title, level = 1, action }) => {
    const Heading = level === 1 ? "h1" : "h2";
    return (
      <section
        class={[
          "mx-auto max-w-xl rounded-xl border px-6 py-10 text-center",
          tone === "error"
            ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
            : "border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900",
        ]}
      >
        <div
          aria-hidden="true"
          class={[
            "mx-auto mb-4 grid size-10 place-items-center rounded-full text-lg font-bold",
            tone === "error"
              ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
          ]}
        >
          {tone === "error" ? "!" : "∅"}
        </div>
        <Heading
          class={[
            "text-lg font-semibold",
            tone === "error" ? "text-red-900 dark:text-red-100" : "",
          ]}
        >
          {title}
        </Heading>
        <div class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          <Slot />
        </div>
        {action && (
          <div class="mt-6">
            <Link
              // Keyed by href: Qwik City's Link keeps the href it was first
              // rendered with while the route stays the same (e.g. /media
              // filters applied in place).
              key={action.href}
              href={action.href}
              class={buttonSecondary}
            >
              {action.label}
            </Link>
          </div>
        )}
      </section>
    );
  },
);
