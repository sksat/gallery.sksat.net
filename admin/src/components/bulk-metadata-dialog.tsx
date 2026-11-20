import {
  $,
  component$,
  useSignal,
  useVisibleTask$,
  type QRL,
  type Signal,
} from "@builder.io/qwik";
import { commonLevels, type LevelChange } from "~/lib/bulk-metadata";
import {
  FIELD_LABELS,
  LEVEL_LABELS,
  METADATA_FIELDS,
  METADATA_LEVELS,
  type MetadataLevels,
} from "~/lib/metadata";
import type { FileTile } from "./file-browser";
import { buttonPrimary, buttonSecondary, card, field, label } from "./ui";

// The public metadata levels of the selected photos, every field at once:
// each select starts at what the photos share (デフォルト when they follow the
// site), or そのまま when they differ, which leaves each photo's own level.
// Only the fields changed here are applied. A sheet along the bottom on
// phones, a centred dialog from sm up.

/** The select value for "leave each photo as it is" (levels differ). */
const KEEP = "keep";

type Props = {
  photos: FileTile[];
  siteDefaults: MetadataLevels;
  busy: Signal<boolean>;
  onApply$: QRL<(levels: LevelChange) => Promise<void>>;
  onClose$: QRL<() => void>;
};

export const BulkMetadataDialog = component$<Props>(
  ({ photos, siteDefaults, busy, onApply$, onClose$ }) => {
    const ref = useSignal<HTMLDialogElement>();
    // Rendered only while open: open it as a modal once it is in the DOM.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(() => {
      ref.value?.showModal();
    });
    const common = commonLevels(photos.map((p) => p.metadata));

    const submit = $(async (form: HTMLFormElement) => {
      const data = new FormData(form);
      const change: LevelChange = {};
      for (const f of METADATA_FIELDS) {
        const v = String(data.get(f) ?? KEEP);
        if (v !== KEEP && v !== (common[f] ?? KEEP)) change[f] = v;
      }
      if (Object.keys(change).length === 0) ref.value?.close();
      else await onApply$(change);
    });

    return (
      <dialog
        ref={ref}
        aria-labelledby="bulk-metadata-title"
        onClose$={onClose$}
        // A tap on the backdrop (the dialog itself, outside the form).
        onClick$={(ev, el) => {
          if (ev.target === el) el.close();
        }}
        class={[
          "m-auto w-[min(36rem,calc(100vw-2rem))] max-w-none bg-transparent p-0 text-inherit backdrop:bg-black/40",
          "max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:m-0 max-sm:max-h-[85dvh] max-sm:w-full max-sm:overflow-y-auto",
        ]}
      >
        <form
          preventdefault:submit
          onSubmit$={(_, form) => submit(form)}
          data-testid="bulk-metadata"
          class={[
            card,
            "space-y-4 p-4 max-sm:rounded-b-none max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]",
          ]}
        >
          {/* Focus starts here, not on the first select (whose focus
              ring would look like a change). */}
          <h2
            id="bulk-metadata-title"
            tabIndex={-1}
            autofocus
            class="text-base font-semibold outline-none"
          >
            公開する情報 ({photos.length} 枚)
          </h2>
          <div class="grid gap-3 sm:grid-cols-2">
            {METADATA_FIELDS.map((f) => {
              const labels = LEVEL_LABELS[f] as Record<string, string>;
              const shared = common[f];
              return (
                <div key={f}>
                  <label for={`bulk-mv-${f}`} class={label}>
                    {FIELD_LABELS[f]}
                  </label>
                  <select
                    id={`bulk-mv-${f}`}
                    name={f}
                    data-testid={`bulk-metadata-${f}`}
                    onChange$={(_, el) => {
                      // Fields that will change stand out.
                      if (el.value !== (shared ?? KEEP)) {
                        el.dataset.changed = "";
                      } else delete el.dataset.changed;
                    }}
                    class={[
                      field,
                      "data-changed:border-sky-500 data-changed:bg-sky-50 data-changed:ring-1 data-changed:ring-sky-500 dark:data-changed:bg-sky-950/40",
                    ]}
                  >
                    {shared === null && (
                      <option value={KEEP} selected>
                        そのまま（写真ごと）
                      </option>
                    )}
                    <option value="" selected={shared === ""}>
                      {`デフォルト（${labels[siteDefaults[f]]}）`}
                    </option>
                    {(METADATA_LEVELS[f] as readonly string[]).map((level) => (
                      <option
                        key={level}
                        value={level}
                        selected={shared === level}
                      >
                        {labels[level]}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              onClick$={() => ref.value?.close()}
              class={[buttonSecondary, "max-sm:flex-1"]}
            >
              やめる
            </button>
            <button
              type="submit"
              disabled={busy.value}
              class={[buttonPrimary, "max-sm:flex-1"]}
            >
              {busy.value ? "適用中…" : "適用"}
            </button>
          </div>
        </form>
      </dialog>
    );
  },
);
