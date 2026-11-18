import {
  $,
  component$,
  sync$,
  useSignal,
  useVisibleTask$,
  type QRL,
} from "@builder.io/qwik";
import type { Visibility } from "~/lib/types";
import { VISIBILITY_STYLE, VisibilityIcon } from "./visibility-style";

// A context menu (right-click, Shift+F10 or the menu key on a tile): a
// role="menu" at the pointer, kept inside the viewport. Arrow keys / Home /
// End move between its items, Enter or Space picks one, Escape, Tab or a
// click outside closes it, and the focus goes back where it was.

export type MenuItem =
  | {
      kind: "item";
      id: string;
      label: string;
      /** Shortcut shown on the right (F2, Delete…). */
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      visibility?: Visibility;
    }
  | { kind: "separator"; id: string };

type Props = {
  x: number;
  y: number;
  items: MenuItem[];
  label: string;
  onPick$: QRL<(id: string) => void>;
  onClose$: QRL<() => void>;
};

export const ContextMenu = component$<Props>(
  ({ x, y, items, label, onPick$, onClose$ }) => {
    const ref = useSignal<HTMLDivElement>();
    const pos = useSignal({ left: x, top: y });

    // Inside the viewport, then focus on the first item.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup }) => {
      const el = ref.value;
      if (!el) return;
      const back = document.activeElement as HTMLElement | null;
      const r = el.getBoundingClientRect();
      pos.value = {
        left: Math.max(8, Math.min(x, innerWidth - r.width - 8)),
        top: Math.max(8, Math.min(y, innerHeight - r.height - 8)),
      };
      el.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus();
      const outside = (e: Event) => {
        if (!el.contains(e.target as Node)) void onClose$();
      };
      const away = () => void onClose$();
      document.addEventListener("pointerdown", outside, true);
      addEventListener("blur", away);
      addEventListener("resize", away);
      cleanup(() => {
        document.removeEventListener("pointerdown", outside, true);
        removeEventListener("blur", away);
        removeEventListener("resize", away);
        // Back to where the menu was opened from, if focus was not moved.
        if (!document.activeElement || document.activeElement === document.body)
          back?.focus();
      });
    });

    const keydown = $((e: KeyboardEvent, el: HTMLDivElement) => {
      const all = Array.from(
        el.querySelectorAll<HTMLButtonElement>(
          "[role=menuitem]:not([disabled])",
        ),
      );
      const i = all.indexOf(document.activeElement as HTMLButtonElement);
      const go = (n: number) => all[(n + all.length) % all.length]?.focus();
      if (e.key === "ArrowDown") go(i + 1);
      else if (e.key === "ArrowUp") go(i - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(all.length - 1);
      else if (e.key === "Escape" || e.key === "Tab") void onClose$();
    });

    return (
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        data-testid="context-menu"
        onKeyDown$={[
          // No page scroll for the keys the menu uses (Enter and Space
          // still press the focused item).
          sync$((e: KeyboardEvent) => {
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
              e.preventDefault();
            }
          }),
          keydown,
        ]}
        preventdefault:contextmenu
        style={{ left: `${pos.value.left}px`, top: `${pos.value.top}px` }}
        class="fixed z-50 min-w-52 rounded-xl border border-zinc-200 bg-white p-1 text-sm text-zinc-800 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      >
        {items.map((item) =>
          item.kind === "separator" ? (
            <div
              key={item.id}
              role="separator"
              class="my-1 h-px bg-zinc-200 dark:bg-zinc-700"
            />
          ) : (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick$={async () => {
                await onClose$();
                await onPick$(item.id);
              }}
              class={[
                "flex h-11 w-full items-center gap-2 rounded-lg px-3 text-left outline-none focus:bg-sky-50 disabled:opacity-40 sm:h-8 dark:focus:bg-sky-950/50",
                item.danger
                  ? "text-red-700 dark:text-red-400"
                  : item.visibility
                    ? VISIBILITY_STYLE[item.visibility].accent
                    : undefined,
              ]}
            >
              {item.visibility ? (
                <VisibilityIcon visibility={item.visibility} />
              ) : (
                <span class="size-4" aria-hidden="true" />
              )}
              <span class="flex-1">{item.label}</span>
              {item.hint && (
                <kbd class="text-xs font-normal text-zinc-400">{item.hint}</kbd>
              )}
            </button>
          ),
        )}
      </div>
    );
  },
);
