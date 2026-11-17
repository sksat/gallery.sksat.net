import { component$, useVisibleTask$, type Signal } from "@builder.io/qwik";

// One toast per page, pinned to the bottom of the viewport so the result of
// an action stays visible however far the page is scrolled (on a phone the
// inline message under a form is usually off screen). The page owns the
// signal and sets it from its actions' results.
//
// Success goes into a polite status region that is always in the DOM (a
// live region inserted together with its text is often not announced) and
// clears itself after a few seconds. An error is a role="alert", inserted
// when shown, and stays until it is dismissed or replaced by the next toast.

export type ToastState = {
  tone: "success" | "error";
  message: string;
};

const SUCCESS_MS = 4000;

export const Toast = component$<{ toast: Signal<ToastState | null> }>(
  ({ toast }) => {
    // A visible task (not useTask$) so a toast that was set during SSR, e.g.
    // "Camera created." after a full page load, also times out.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(
      ({ track, cleanup }) => {
        const current = track(() => toast.value);
        if (current?.tone !== "success") return;
        const timer = setTimeout(() => {
          // Only if no newer toast replaced it meanwhile.
          if (toast.value === current) toast.value = null;
        }, SUCCESS_MS);
        cleanup(() => clearTimeout(timer));
      },
      { strategy: "document-ready" },
    );

    const t = toast.value;
    return (
      <div
        data-testid="toast"
        class="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottom-ui,0px)+1rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4"
      >
        <div
          class={[
            "flex max-w-md min-w-0 items-center gap-3 rounded-xl text-sm",
            t &&
              "pointer-events-auto px-4 py-1 shadow-lg ring-1 [&>p:not(:empty)]:py-2",
            t?.tone === "error" &&
              "bg-red-50 text-red-900 ring-red-200 dark:bg-red-950 dark:text-red-100 dark:ring-red-900",
            t?.tone === "success" &&
              "bg-zinc-900 text-white ring-zinc-900/10 dark:bg-zinc-100 dark:text-zinc-900",
          ]}
        >
          {/* Empty: out of the flex flow, but still a live region. */}
          <p role="status" class="min-w-0 empty:absolute">
            {t?.tone === "success" ? t.message : ""}
          </p>
          {t?.tone === "error" && (
            <p role="alert" class="min-w-0">
              {t.message}
            </p>
          )}
          {t && (
            <button
              type="button"
              aria-label="Dismiss"
              onClick$={() => (toast.value = null)}
              class="-mr-3 grid size-11 shrink-0 place-items-center rounded-lg opacity-70 hover:opacity-100"
            >
              <span aria-hidden="true">✕</span>
            </button>
          )}
        </div>
      </div>
    );
  },
);
