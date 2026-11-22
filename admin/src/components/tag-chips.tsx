import { component$, useComputed$, useSignal } from "@builder.io/qwik";
import { CameraGlyph } from "./camera-label";
import { VisibilityIcon } from "./visibility-style";

// The edit page's tags, each a switch for whether the public site shows
// it on this photo (migration 0021): a globe when it does, a lock when it
// does not, like the photo's own visibility. It starts as the photo has
// it: its own choice, else the tag's setting (/tag/). A dot marks a tag
// this photo chooses for itself. Part of the page's form (TagChipsLoaded
// before the list, TagChipItems in it): the checked
// ones are `tag_shown[]`, and `tag_chips_loaded` says how each started,
// so only the switched ones are saved (lib/tag-visibility.ts chipPatch).

export type ChipTag = {
  tag: string;
  /** From the camera (0011), not the photo's own. */
  inherited: boolean;
  /** The tag's own setting (`tag.public`). */
  byDefault: boolean;
  /** Shown on this photo as saved. */
  shown: boolean;
  /** As saved, by the photo's own choice. */
  own: boolean;
};

const Chip = component$<{ chip: ChipTag }>(({ chip }) => {
  const shown = useSignal(chip.shown);
  // Switched since loaded: its own choice unless back at the default.
  const own = useComputed$(() =>
    shown.value === chip.shown ? chip.own : shown.value !== chip.byDefault,
  );
  return (
    <li
      data-testid="tag-chip"
      data-public={shown.value ? "true" : "false"}
      data-own={own.value ? "true" : undefined}
      data-inherited={chip.inherited ? "true" : undefined}
    >
      <label
        title={`デフォルト: ${chip.byDefault ? "公開" : "非公開"}`}
        class={[
          "relative inline-flex h-11 cursor-pointer items-center gap-1 rounded-full px-3 text-sm ring-1 select-none ring-inset sm:h-7 sm:px-2.5 sm:text-xs",
          "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-sky-500",
          shown.value
            ? "bg-sky-50 text-sky-800 ring-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-700"
            : "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700",
        ]}
      >
        <input
          type="checkbox"
          name="tag_shown[]"
          value={chip.tag}
          checked={chip.shown}
          aria-label={`${chip.tag}を公開`}
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
        {own.value && (
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
