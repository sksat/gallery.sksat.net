import {
  $,
  component$,
  useSignal,
  useVisibleTask$,
  type QRL,
  type Signal,
} from "@builder.io/qwik";
import { server$ } from "@builder.io/qwik-city";
import {
  TAG_FIELD_LIMITS,
  type TagFieldDef,
} from "@shared/tag-field/tag-field";
import {
  bulkTagChange,
  sharedFields,
  type PhotoTagValues,
  type SharedField,
} from "~/lib/bulk-tag-field";
import { MAX_BULK_IDS } from "~/lib/db";
import { listTagValueInfo } from "~/lib/db-tag-field";
import { getDB } from "~/lib/env";
import { inChunks } from "~/lib/selection";
import { buttonPrimary, buttonSecondary, card, field, muted } from "./ui";

// タグの項目 of the selected photos: the fields of their tags (migration
// 0010), grouped by tag, each starting at the value the photos with that
// tag share, or empty with そのまま（写真ごと） when they differ; × clears
// one for all of them. A value goes only to the photos that have its tag.
// Only what was touched is applied (the server checks every value against
// its field). A sheet along the bottom on phones, a centred dialog from
// sm up.

const loadValues = server$(async function (
  ids: unknown,
): Promise<PhotoTagValues[]> {
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_BULK_IDS ||
    !ids.every((id) => Number.isSafeInteger(id) && id > 0)
  ) {
    throw new Error("invalid ids");
  }
  return listTagValueInfo(getDB(this.platform), ids as number[]);
});

const MIXED = "そのまま（写真ごと）";

type Props = {
  /** The selected photos' ids. */
  ids: number[];
  fields: TagFieldDef[];
  busy: Signal<boolean>;
  onApply$: QRL<(change: Record<string, string | null>) => Promise<void>>;
  onClose$: QRL<() => void>;
};

const changedRing =
  "data-changed:border-sky-500 data-changed:bg-sky-50 data-changed:ring-1 data-changed:ring-sky-500 dark:data-changed:bg-sky-950/40";

export const BulkTagFieldDialog = component$<Props>(
  ({ ids, fields, busy, onApply$, onClose$ }) => {
    const ref = useSignal<HTMLDialogElement>();
    const shared = useSignal<SharedField[] | null>(null);
    const error = useSignal<string | null>(null);
    /** Fields cleared with ×, by id. */
    const cleared = useSignal<number[]>([]);
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(async () => {
      ref.value?.showModal();
      try {
        const photos: PhotoTagValues[] = [];
        for (const chunk of inChunks(ids, MAX_BULK_IDS)) {
          photos.push(...(await loadValues(chunk)));
        }
        shared.value = sharedFields(photos, fields);
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
      }
    });

    const submit = $(async (form: HTMLFormElement) => {
      if (!shared.value) return;
      const data = new FormData(form);
      const typed: Record<string, string> = {};
      for (const s of shared.value) {
        typed[String(s.field.id)] = String(data.get(`tf-${s.field.id}`) ?? "");
      }
      const change = bulkTagChange(shared.value, typed, cleared.value);
      if (Object.keys(change).length === 0) ref.value?.close();
      else await onApply$(change);
    });

    const groups = (shared.value ?? []).reduce<
      { tag: string; count: number; items: SharedField[] }[]
    >((acc, s) => {
      const g = acc.find((x) => x.tag === s.field.tag);
      if (g) g.items.push(s);
      else acc.push({ tag: s.field.tag, count: s.count, items: [s] });
      return acc;
    }, []);

    return (
      <dialog
        ref={ref}
        aria-labelledby="bulk-tag-field-title"
        onClose$={onClose$}
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
          data-testid="bulk-tag-fields"
          aria-busy={shared.value === null && !error.value}
          class={[
            card,
            "space-y-4 p-4 max-sm:rounded-b-none max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]",
          ]}
        >
          <h2
            id="bulk-tag-field-title"
            tabIndex={-1}
            autofocus
            class="text-base font-semibold outline-none"
          >
            タグの項目 ({ids.length} 枚)
          </h2>
          {error.value ? (
            <p role="alert" class="text-sm text-red-700 dark:text-red-400">
              読み込めませんでした: {error.value}
            </p>
          ) : shared.value === null ? (
            <p class={["text-sm", muted]}>読み込み中…</p>
          ) : (
            groups.map((g) => (
              <fieldset key={g.tag} class="space-y-2">
                <legend class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  {g.tag}{" "}
                  <span class={["font-normal tabular-nums", muted]}>
                    {g.count === ids.length
                      ? `${g.count} 枚`
                      : `${g.count} / ${ids.length} 枚`}
                  </span>
                </legend>
                <div class="grid gap-3 sm:grid-cols-2">
                  {g.items.map((s) => {
                    const f = s.field;
                    const id = `bulk-tf-${f.id}`;
                    const isCleared = cleared.value.includes(f.id);
                    const initial = s.value ?? "";
                    const markChanged = $(
                      (el: HTMLInputElement | HTMLSelectElement) => {
                        if (el.value !== initial) el.dataset.changed = "";
                        else delete el.dataset.changed;
                      },
                    );
                    return (
                      <div key={f.id}>
                        <label
                          for={id}
                          class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                        >
                          {f.label}
                        </label>
                        <div class="flex gap-1">
                          {f.type === "select" ? (
                            <select
                              id={id}
                              name={`tf-${f.id}`}
                              onChange$={(_, el) => markChanged(el)}
                              data-changed={isCleared ? "" : undefined}
                              class={[field, changedRing]}
                            >
                              <option value="" selected={initial === ""}>
                                {s.value === null && !isCleared ? MIXED : "—"}
                              </option>
                              {initial !== "" &&
                                !(f.options ?? []).includes(initial) && (
                                  <option value={initial} selected>
                                    {initial}
                                  </option>
                                )}
                              {(f.options ?? []).map((o) => (
                                <option
                                  key={o}
                                  value={o}
                                  selected={initial === o}
                                >
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={id}
                              name={`tf-${f.id}`}
                              type={f.type === "date" ? "date" : "text"}
                              value={initial}
                              placeholder={
                                s.value === null && !isCleared
                                  ? MIXED
                                  : undefined
                              }
                              inputMode={
                                f.type === "number" ? "decimal" : undefined
                              }
                              maxLength={TAG_FIELD_LIMITS.text}
                              autoCapitalize="off"
                              autoCorrect="off"
                              spellcheck={false}
                              onInput$={(_, el) => markChanged(el)}
                              data-changed={isCleared ? "" : undefined}
                              class={[field, changedRing]}
                            />
                          )}
                          {s.value !== "" && (
                            <button
                              type="button"
                              aria-label={`${f.label}を消す`}
                              title="消す"
                              onClick$={(_, el) => {
                                const input =
                                  el.parentElement?.querySelector<HTMLInputElement>(
                                    `[name="tf-${f.id}"]`,
                                  );
                                if (input) input.value = "";
                                if (!cleared.value.includes(f.id)) {
                                  cleared.value = [...cleared.value, f.id];
                                }
                              }}
                              class="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 sm:size-10 dark:hover:bg-zinc-800"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))
          )}
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
              disabled={busy.value || shared.value === null}
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
