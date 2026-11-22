import { component$, useSignal } from "@builder.io/qwik";
import { CameraGlyph } from "./camera-label";
import { VisibilityIcon } from "./visibility-style";

// The edit page's tags, each a switch for whether the public site shows
// it on this photo (migration 0021): a globe when it does, a lock when it
// does not, like the photo's own visibility. A public tag (/tag/) can be
// hidden on the photo, and a dot marks one it hides; a private tag is
// never shown and cannot be switched here (its title says why). Part of
// the page's form (TagChipsLoaded before the list, TagChipItems in it):
// the checked ones are `tag_shown[]`, and `tag_chips_loaded` says how
// each started, so only the switched ones are saved (lib/tag-visibility.ts
// chipPatch).

export type ChipTag = {
  tag: string;
  /** From the camera (0011), not the photo's own. */
  inherited: boolean;
  /** Shown on this photo as saved. */
  shown: boolean;
  /** The tag itself is private: never shown, not switchable. */
  locked: boolean;
};

const Chip = component$<{ chip: ChipTag }>(({ chip }) => {
  const shown = useSignal(chip.shown);
  // A public tag this photo hides.
  const hidden = !chip.locked && !shown.value;
  return (
    <li
      data-testid="tag-chip"
      data-public={shown.value ? "true" : "false"}
      data-own={hidden ? "true" : undefined}
      data-locked={chip.locked ? "true" : undefined}
      data-inherited={chip.inherited ? "true" : undefined}
    >
      <label
        title={chip.locked ? "タグが非公開" : undefined}
        class={[
          "relative inline-flex h-11 items-center gap-1 rounded-full px-3 text-sm select-none sm:h-7 sm:px-2.5 sm:text-xs",
          "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-sky-500",
          chip.locked
            ? "cursor-not-allowed border border-dashed border-zinc-300 text-zinc-500 dark:border-zinc-600 dark:text-zinc-500"
            : shown.value
              ? "cursor-pointer bg-sky-50 text-sky-800 ring-1 ring-sky-300 ring-inset dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-700"
              : "cursor-pointer bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200 ring-inset dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700",
        ]}
      >
        <input
          type="checkbox"
          name="tag_shown[]"
          value={chip.tag}
          checked={chip.shown}
          disabled={chip.locked}
          aria-label={`${chip.tag}を公開`}
          aria-description={chip.locked ? "タグが非公開" : undefined}
          onChange$={(_, el) => {
            shown.value = el.checked;
          }}
          class="sr-only"
        />
        <VisibilityIcon
          visibility={shown.value ? "public" : "private"}
          class="size-3.5"
        />
        {chip.inherited && <CameraGlyph class="size-3.5 opacity-80" />}
        <span>{chip.tag}</span>
        {hidden && (
          <span
            aria-hidden="true"
            data-testid="tag-chip-own"
            class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-zinc-900"
          />
        )}
      </label>
    </li>
  );
});

/** The chips (`li`s, for a list) and, before the list, how they started. */
export const TagChipsLoaded = ({ chips }: { chips: ChipTag[] }) => (
  <input
    type="hidden"
    name="tag_chips_loaded"
    value={JSON.stringify(
      Object.fromEntries(chips.map((c) => [c.tag, c.shown])),
    )}
  />
);

export const TagChipItems = ({ chips }: { chips: ChipTag[] }) => (
  <>
    {chips.map((c) => (
      <Chip key={`${c.inherited}:${c.tag}`} chip={c} />
    ))}
  </>
);
