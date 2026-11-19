import {
  component$,
  useSignal,
  useVisibleTask$,
  type QRL,
  type Signal,
} from "@builder.io/qwik";
import type { PlatformKind } from "~/lib/platform";
import { Thumb } from "./thumb";
import { buttonSecondary, card, muted, platformBadge } from "./ui";

// One value for every selected photo (the camera, the platform): a list
// of choices, the one they all share pressed, and そのまま while they
// differ. A pick applies at once (undo from the toast). A sheet along the
// bottom on phones, a centred dialog from sm up.

export type Choice = {
  /** What the pick reports. */
  key: string;
  label: string;
  /** A picture (a bucket path), "none" for a crossed-out icon, "badge"
   *  for the label in a platform badge, or nothing for a blank square. */
  image?: string | "none" | "badge" | null;
  /** The badge's colour (a platform's kind). */
  kind?: PlatformKind;
};

type Props = {
  /** The dialog's name ("カメラ"); the title adds the count. */
  title: string;
  testId: string;
  choices: Choice[];
  /** The key every photo has, or undefined if they differ. */
  shared: string | undefined;
  count: number;
  imageBase: string | null;
  busy: Signal<boolean>;
  onPick$: QRL<(key: string) => void>;
  onClose$: QRL<() => void>;
};

const NoneIcon = () => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    class="size-5"
  >
    <path
      fill-rule="evenodd"
      d="M3.28 2.22a.75.75 0 0 0-1.06 1.06l14.5 14.5a.75.75 0 1 0 1.06-1.06l-1.4-1.4A1.5 1.5 0 0 0 18 14V7.5A1.5 1.5 0 0 0 16.5 6h-2.1l-1-1.5A1.5 1.5 0 0 0 12.15 4h-4.3a1.5 1.5 0 0 0-1.25.67l-.38.57-2.94-3.02ZM8.4 7.04l4.56 4.56A3 3 0 0 0 8.4 7.04ZM2 7.5c0-.4.16-.77.42-1.04l9.58 9.54H3.5A1.5 1.5 0 0 1 2 14.5v-7Z"
      clip-rule="evenodd"
    />
  </svg>
);

export const ChoicePicker = component$<Props>(
  ({
    title,
    testId,
    choices,
    shared,
    count,
    imageBase,
    busy,
    onPick$,
    onClose$,
  }) => {
    const ref = useSignal<HTMLDialogElement>();
    // Rendered only while open: open it as a modal once it is in the DOM.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(() => {
      ref.value?.showModal();
    });
    const choice = (pressed: boolean) => [
      "flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm disabled:opacity-50",
      pressed
        ? "bg-sky-50 font-semibold text-sky-900 ring-2 ring-sky-500 ring-inset dark:bg-sky-950/50 dark:text-sky-100"
        : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
    ];
    const titleId = `${testId}-title`;

    return (
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClose$={onClose$}
        onClick$={(ev, el) => {
          if (ev.target === el) el.close();
        }}
        class={[
          "m-auto w-[min(28rem,calc(100vw-2rem))] max-w-none bg-transparent p-0 text-inherit backdrop:bg-black/40",
          "max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:m-0 max-sm:max-h-[85dvh] max-sm:w-full max-sm:overflow-y-auto",
        ]}
      >
        <div
          data-testid={testId}
          class={[
            card,
            "space-y-3 p-4 max-sm:rounded-b-none max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]",
          ]}
        >
          <h2
            id={titleId}
            tabIndex={-1}
            autofocus
            class="text-base font-semibold outline-none"
          >
            {title} ({count} 枚)
          </h2>
          <ul class="space-y-1 sm:max-h-80 sm:overflow-y-auto">
            {shared === undefined && (
              // Not pressed: nothing is shared; this one leaves each as is.
              <li>
                <button
                  type="button"
                  onClick$={() => ref.value?.close()}
                  class={choice(true)}
                >
                  <span class="size-10 shrink-0" />
                  そのまま（写真ごと）
                </button>
              </li>
            )}
            {choices.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  aria-pressed={shared === c.key}
                  disabled={busy.value}
                  onClick$={() => onPick$(c.key)}
                  class={choice(shared === c.key)}
                >
                  {c.image === "none" ? (
                    <span
                      class={[
                        "flex size-10 shrink-0 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800",
                        muted,
                      ]}
                    >
                      <NoneIcon />
                    </span>
                  ) : c.image === "badge" ? null : c.image ? (
                    <Thumb
                      file={c.image}
                      platform={null}
                      imageBase={imageBase}
                      variant="list"
                      exact
                      class="size-10 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <span class="size-10 shrink-0 rounded-md bg-zinc-100 dark:bg-zinc-800" />
                  )}
                  {c.image === "badge" ? (
                    <span class={platformBadge(c.kind ?? "real")}>
                      {c.label}
                    </span>
                  ) : (
                    <span class="truncate">{c.label}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div class="flex justify-end">
            <button
              type="button"
              onClick$={() => ref.value?.close()}
              class={[buttonSecondary, "max-sm:w-full"]}
            >
              やめる
            </button>
          </div>
        </div>
      </dialog>
    );
  },
);
