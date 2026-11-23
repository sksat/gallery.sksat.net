import {
  $,
  component$,
  useId,
  useSignal,
  useVisibleTask$,
  type QRL,
} from "@builder.io/qwik";

// A name edited where it is shown, as in a file manager: it starts
// focused with the name selected (a file's without its extension), Enter
// or leaving the field commits, Esc keeps the name it had. A name that
// cannot be used is said under the field, which stays open.

type Props = {
  /** The name it starts with. */
  value: string;
  /** The field's accessible name. */
  label: string;
  /** Select the name without its extension (a file), not all of it. */
  stem?: boolean;
  maxLength?: number;
  /** Why `name` cannot be used, or null; checked before onCommit$. */
  check$?: QRL<(name: string) => string | null>;
  /** Save `name` (trimmed, changed); true when it went through. */
  onCommit$: QRL<(name: string) => Promise<boolean>>;
  /** Stop editing, keeping the name (Esc, or the name unchanged). */
  onCancel$: QRL<() => void>;
  class?: string;
};

export const InlineName = component$<Props>(
  ({ value, label, stem, maxLength, check$, onCommit$, onCancel$, ...p }) => {
    const input = useSignal<HTMLInputElement>();
    const error = useSignal<string | null>(null);
    /** Saving, or finished: a blur then (the field going away) does nothing. */
    const state = useSignal<"editing" | "saving" | "done">("editing");
    const errorId = `${useId()}-error`;

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(
      () => {
        const el = input.value;
        if (!el) return;
        el.focus();
        const dot = stem ? value.lastIndexOf(".") : -1;
        el.setSelectionRange(0, dot > 0 ? dot : value.length);
      },
      { strategy: "document-ready" },
    );

    const commit = $(async (el: HTMLInputElement) => {
      if (state.value !== "editing") return;
      const name = el.value.trim();
      if (name === value) {
        state.value = "done";
        await onCancel$();
        return;
      }
      const problem = check$ ? await check$(name) : null;
      error.value = problem;
      if (problem) return;
      state.value = "saving";
      const ok = await onCommit$(name).catch(() => false);
      state.value = ok ? "done" : "editing";
    });

    return (
      <span class={["block min-w-0", p.class]}>
        <input
          ref={input}
          type="text"
          aria-label={label}
          aria-invalid={error.value ? "true" : undefined}
          aria-describedby={error.value ? errorId : undefined}
          value={value}
          maxLength={maxLength}
          readOnly={state.value === "saving"}
          autoCapitalize="off"
          autoCorrect="off"
          spellcheck={false}
          enterKeyHint="done"
          data-inline-name
          onInput$={() => (error.value = null)}
          onKeyDown$={(e, el) => {
            // (Not the Enter that confirms an IME's conversion.)
            if (e.key === "Enter" && !e.isComposing) void commit(el);
            else if (e.key === "Escape" && state.value === "editing") {
              state.value = "done";
              void onCancel$();
            }
          }}
          onBlur$={(_, el) => commit(el)}
          class={[
            "box-border block h-10 w-full min-w-0 cursor-text rounded-md border bg-white px-2 text-base font-medium text-zinc-900 select-text sm:h-8 sm:text-sm dark:bg-zinc-950 dark:text-zinc-100",
            "outline-none focus:ring-2",
            error.value
              ? "border-red-500 focus:ring-red-500/30"
              : "border-sky-500 focus:ring-sky-500/30",
          ]}
        />
        {error.value && (
          <span
            id={errorId}
            role="alert"
            class="mt-1 block text-xs font-normal whitespace-normal text-red-700 dark:text-red-400"
          >
            {error.value}
          </span>
        )}
      </span>
    );
  },
);
