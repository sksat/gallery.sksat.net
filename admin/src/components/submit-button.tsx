import { component$, Slot, type ClassList } from "@builder.io/qwik";

// Submit button for a routeAction$ form. While the action runs it is
// disabled (no double submit from a second tap) and shows a spinner, plus
// `pendingLabel` in place of its text when given. The page passes
// `running` (usually `action.isRunning`) and sets aria-busy on the form.

type Props = {
  running: boolean;
  class?: ClassList;
  /** Replaces the label while running, e.g. 「保存中…」. */
  pendingLabel?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "data-testid"?: string;
};

export const Spinner = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    class="size-4 shrink-0 animate-spin"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
      stroke="currentColor"
      stroke-width="3"
      class="opacity-25"
    />
    <path
      d="M21 12a9 9 0 0 0-9-9"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
    />
  </svg>
);

export const SubmitButton = component$<Props>(
  ({ running, pendingLabel, disabled, class: cls, ...rest }) => (
    <button
      type="submit"
      class={cls}
      disabled={Boolean(disabled) || running}
      aria-label={rest["aria-label"]}
      data-testid={rest["data-testid"]}
    >
      {/* A fixed structure, only toggled by class: re-rendering siblings
          of <Slot /> conditionally loses the projected label in Qwik. */}
      <span class={running ? "contents" : "hidden"}>
        <Spinner />
      </span>
      <span class={running && pendingLabel ? "hidden" : "contents"}>
        <Slot />
      </span>
      <span class={running && pendingLabel ? "contents" : "hidden"}>
        {pendingLabel}
      </span>
    </button>
  ),
);
