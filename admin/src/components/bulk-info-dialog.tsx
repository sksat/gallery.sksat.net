import {
  $,
  component$,
  sync$,
  useSignal,
  useStore,
  useVisibleTask$,
  type QRL,
  type Signal,
} from "@builder.io/qwik";
import { server$ } from "@builder.io/qwik-city";
import {
  KEEP,
  nextTagState,
  nextVisState,
  shared,
  tagChanges,
  tagCounts,
  tagVisState,
  timeParts,
  validateInfoEdit,
  visChanges,
  type InfoEdit,
  type InfoValues,
  type TagState,
  type TagVisState,
} from "~/lib/bulk-info";
import { listInfo } from "~/lib/db-photo-bulk";
import { MAX_BULK_IDS } from "~/lib/db";
import { getDB } from "~/lib/env";
import { EXIF_EDIT_KEYS, EXIF_LABELS } from "~/lib/photo-data";
import { inChunks } from "~/lib/selection";
import { hasRealPlace, platformOf, VRCHAT } from "~/lib/platform";
import type { MediaPlatform } from "~/lib/types";
import { usePlatformList } from "~/routes/layout";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  field,
  label,
  muted,
} from "./ui";
import { LocationPicker } from "./location-picker";
import { VisibilityIcon } from "./visibility-style";

// タグと撮影データ of the selected photos, every value at once. Tags: each
// tag the photos have, checked when all have it and mixed when some do; a
// click puts it on all, then off all (then back as it was), and a new one
// can be typed (picked from the site's tags; a new tag starts private).
// Its globe or lock says whether it is public on the photos that have it
// (both when they differ); a click makes it public on all of them,
// then not, then back as it was. A private tag stays locked (0021). Values (the time taken, the world, the position, the shooting settings)
// start at what the photos share, or empty with そのまま（写真ごと） when
// they differ; × clears one. Only what was touched is applied, through the
// same checks as the edit page. A sheet along the bottom on phones, a
// centred dialog from sm up.

type Loaded = {
  photos: InfoValues[];
  tags: { name: string; public: boolean }[];
};

const loadInfo = server$(async function (ids: unknown): Promise<Loaded> {
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_BULK_IDS ||
    !ids.every((id) => Number.isSafeInteger(id) && id > 0)
  ) {
    throw new Error("invalid ids");
  }
  return listInfo(getDB(this.platform), ids as number[]);
});

/** Offsets to pick from (with their usual half/quarter hours). */
const OFFSETS = [
  ...Array.from({ length: 27 }, (_, i) => i - 12).map(
    (h) => `${h < 0 ? "-" : "+"}${String(Math.abs(h)).padStart(2, "0")}:00`,
  ),
  "-09:30",
  "-03:30",
  "+03:30",
  "+04:30",
  "+05:30",
  "+05:45",
  "+06:30",
  "+08:45",
  "+09:30",
  "+10:30",
  "+12:45",
].sort((a, b) => toMinutes(a) - toMinutes(b));

function toMinutes(o: string) {
  const sign = o.startsWith("-") ? -1 : 1;
  return sign * (Number(o.slice(1, 3)) * 60 + Number(o.slice(4, 6)));
}

const MIXED = "そのまま（写真ごと）";

const changedRing =
  "data-changed:border-sky-500 data-changed:bg-sky-50 data-changed:ring-1 data-changed:ring-sky-500 dark:data-changed:bg-sky-950/40";

/** Marks a field whose value will be applied. */
const markChanged = (el: HTMLInputElement | HTMLSelectElement) => {
  const cleared = el.dataset.cleared !== undefined && el.value === "";
  if (el.value !== "") delete el.dataset.cleared;
  if (el.value !== (el.dataset.initial ?? "") || cleared) {
    el.dataset.changed = "";
  } else delete el.dataset.changed;
};

/** A value to apply: undefined when untouched, null when cleared. */
const touched = (form: HTMLFormElement, name: string) => {
  const el = form.elements.namedItem(name) as HTMLInputElement | null;
  if (!el || el.dataset.changed === undefined) return undefined;
  return el.value.trim() === "" ? null : el.value.trim();
};

const sectionTitle = "text-sm font-semibold text-zinc-800 dark:text-zinc-100";

type ValueProps = {
  name: string;
  text: string;
  /** What the photos share, or undefined when it differs. */
  value: string | undefined;
  type?: "text" | "date" | "time";
  inputMode?: "decimal" | "text";
  /** No × (a value that cannot be cleared, e.g. the date). */
  fixed?: boolean;
};

const ValueField = component$<ValueProps>(
  ({ name, text, value, type = "text", inputMode, fixed }) => {
    const id = `bulk-info-${name}`;
    const clearable = !fixed && (value === undefined || value !== "");
    // A date or time input has no placeholder: while the photos differ it
    // is a text box saying so, and becomes the picker once focused.
    const asText = value === undefined && type !== "text";
    return (
      <div>
        <label for={id} class={label}>
          {text}
        </label>
        <div class="flex gap-1">
          <input
            id={id}
            name={name}
            type={asText ? "text" : type}
            onFocus$={
              asText
                ? (_, el) => {
                    el.type = type;
                  }
                : undefined
            }
            onBlur$={
              asText
                ? (_, el) => {
                    if (el.value === "" && el.dataset.cleared === undefined) {
                      el.type = "text";
                    }
                  }
                : undefined
            }
            step={type === "time" ? 1 : undefined}
            inputMode={inputMode}
            value={value ?? ""}
            placeholder={value === undefined ? MIXED : undefined}
            data-initial={value ?? ""}
            data-mixed={value === undefined ? "" : undefined}
            autoComplete="off"
            spellcheck={false}
            onInput$={(_, el) => markChanged(el)}
            class={[field, changedRing, "min-w-0"]}
          />
          {clearable && (
            <button
              type="button"
              aria-label={`${text}を消す`}
              title="消す"
              onClick$={(_, btn) => {
                const el = btn.previousElementSibling as HTMLInputElement;
                el.value = "";
                el.placeholder = "";
                el.dataset.cleared = "";
                markChanged(el);
                // The map follows the inputs on change.
                el.dispatchEvent(new Event("change", { bubbles: true }));
              }}
              class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 sm:h-10 sm:w-10 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              ×
            </button>
          )}
        </div>
      </div>
    );
  },
);

type Props = {
  ids: number[];
  platforms: MediaPlatform[];
  busy: Signal<boolean>;
  onApply$: QRL<(edit: InfoEdit) => Promise<void>>;
  onClose$: QRL<() => void>;
};

type TagRow = {
  tag: string;
  count: number;
  initial: TagState;
  now: TagState;
  /** The tag itself is public: only then can it be shown (0021). */
  public: boolean;
  /** Public on the photos that have it (0021): as loaded, and now. */
  visInitial: TagVisState;
  visNow: TagVisState;
};

export const BulkInfoDialog = component$<Props>(
  ({ ids, platforms, busy, onApply$, onClose$ }) => {
    const ref = useSignal<HTMLDialogElement>();
    const platformList = usePlatformList().value;
    const loaded = useSignal<Loaded | "error" | null>(null);
    const tags = useStore<{ rows: TagRow[] }>({ rows: [] });
    const error = useSignal("");
    const draft = useSignal("");

    // Rendered only while open: open it as a modal, then read the photos'
    // values (MAX_BULK_IDS per request).
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(async () => {
      ref.value?.showModal();
      try {
        const photos: InfoValues[] = [];
        let siteTags: Loaded["tags"] = [];
        for (const chunk of inChunks(ids, MAX_BULK_IDS)) {
          const r = await loadInfo(chunk);
          photos.push(...r.photos);
          siteTags = r.tags;
        }
        const pub = new Set(
          siteTags.filter((t) => t.public).map((t) => t.name),
        );
        tags.rows = tagCounts(photos).map((t) => {
          const vis = tagVisState(t.tag, photos, pub);
          return {
            tag: t.tag,
            count: t.count,
            initial: t.state,
            now: t.state,
            public: pub.has(t.tag),
            visInitial: vis,
            visNow: vis,
          };
        });
        loaded.value = { photos, tags: siteTags };
      } catch {
        loaded.value = "error";
      }
    });

    const addTag = $(() => {
      const name = draft.value.trim();
      if (!name) return;
      draft.value = "";
      const row = tags.rows.find((r) => r.tag === name);
      if (row) {
        row.now = "all";
        tags.rows = [...tags.rows];
        return;
      }
      const site =
        loaded.value && loaded.value !== "error"
          ? loaded.value.tags.find((t) => t.name === name)
          : undefined;
      const vis = site?.public ? "shown" : "hidden";
      tags.rows = [
        ...tags.rows,
        {
          tag: name,
          count: 0,
          initial: "none",
          now: "all",
          public: site?.public ?? false,
          visInitial: vis,
          visNow: vis,
        },
      ];
    });

    const submit = $(async (form: HTMLFormElement) => {
      error.value = "";
      const edit: Record<string, unknown> = {};
      const t = tagChanges(tags.rows);
      if (t.tagsAdd.length > 0) edit.tagsAdd = t.tagsAdd;
      if (t.tagsRemove.length > 0) edit.tagsRemove = t.tagsRemove;
      const vis = visChanges(tags.rows);
      if (Object.keys(vis).length > 0) edit.tagVisibility = vis;

      const date = touched(form, "date");
      const time = touched(form, "time");
      const offset = touched(form, "offset");
      if (date || time !== undefined || offset) {
        edit.takenAt = {
          date: date ?? KEEP,
          time: time === undefined ? KEEP : time,
          offset: offset ?? KEEP,
        };
      }
      const world: Record<string, string | null> = {};
      for (const [k, n] of [
        ["id", "world_id"],
        ["name", "world_name"],
      ] as const) {
        const v = touched(form, n);
        if (v !== undefined) world[k] = v;
      }
      if (Object.keys(world).length > 0) edit.world = world;
      const lat = touched(form, "latitude");
      const lon = touched(form, "longitude");
      if (lat !== undefined || lon !== undefined) {
        // A position is both numbers: the other one as shown, unless the
        // photos differ there (then it has to be given, or cleared, too).
        const other = (n: string) => {
          const el = form.elements.namedItem(n) as HTMLInputElement;
          return el.dataset.mixed !== undefined ? undefined : el.value || null;
        };
        const la = lat !== undefined ? lat : other("latitude");
        const lo = lon !== undefined ? lon : other("longitude");
        if (la === undefined || lo === undefined) {
          error.value = "緯度と経度を両方入れてください";
          return;
        }
        edit.location =
          la === null && lo === null ? null : { latitude: la, longitude: lo };
      }
      const exif: Record<string, string | null> = {};
      for (const k of EXIF_EDIT_KEYS) {
        const v = touched(form, `exif_${k}`);
        if (v !== undefined) exif[k] = v;
      }
      if (Object.keys(exif).length > 0) edit.exif = exif;

      if (Object.keys(edit).length === 0) {
        ref.value?.close();
        return;
      }
      // The same checks as the server (and the edit page), before sending.
      const v = validateInfoEdit(edit);
      if (!v.ok) {
        error.value = v.error;
        return;
      }
      await onApply$(edit as InfoEdit);
    });

    const data = loaded.value && loaded.value !== "error" ? loaded.value : null;
    const photos = data?.photos ?? [];
    const n = photos.length;
    const str = (v: string | number | null | undefined) =>
      v === null || v === undefined ? "" : String(v);
    const sharedOf = (
      f: (p: InfoValues) => string | number | null | undefined,
    ) => shared(photos.map((p) => str(f(p))));
    const parts = photos.map((p) => timeParts(p.timestamp));
    const sharedDate = shared(parts.map((p) => p?.date ?? ""));
    const sharedTime = shared(parts.map((p) => p?.time ?? ""));
    const sharedOffset = shared(parts.map((p) => p?.offset ?? ""));
    // The world is VRChat's own; the map is for real places.
    const vrchat = platforms.includes(VRCHAT);
    const realPlace = platforms.some((p) =>
      hasRealPlace(platformOf(platformList, p).kind),
    );

    return (
      <dialog
        ref={ref}
        aria-labelledby="bulk-info-title"
        onClose$={onClose$}
        onClick$={(ev, el) => {
          if (ev.target === el) el.close();
        }}
        class={[
          "m-auto w-[min(40rem,calc(100vw-2rem))] max-w-none bg-transparent p-0 text-inherit backdrop:bg-black/40",
          "max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:m-0 max-sm:w-full",
        ]}
      >
        <form
          preventdefault:submit
          onSubmit$={(_, form) => submit(form)}
          data-testid="bulk-info"
          class={[
            card,
            "flex max-h-[min(85dvh,48rem)] flex-col max-sm:rounded-b-none",
          ]}
        >
          <h2
            id="bulk-info-title"
            tabIndex={-1}
            autofocus
            class="border-b border-zinc-200 p-4 text-base font-semibold outline-none dark:border-zinc-800"
          >
            タグと撮影データ ({ids.length} 枚)
          </h2>
          <div class="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            {loaded.value === null && (
              <p class={["text-sm", muted]} aria-live="polite">
                読み込み中…
              </p>
            )}
            {loaded.value === "error" && (
              <p role="alert" class="text-sm text-red-700 dark:text-red-400">
                読み込めませんでした
              </p>
            )}
            {data && (
              <>
                <section aria-labelledby="bulk-info-tags" class="space-y-2">
                  <h3 id="bulk-info-tags" class={sectionTitle}>
                    タグ
                  </h3>
                  {tags.rows.length > 0 && (
                    <ul class="flex flex-wrap gap-1.5" data-testid="bulk-tags">
                      {tags.rows.map((row) => {
                        const shown =
                          row.now === "all"
                            ? n
                            : row.now === "none"
                              ? 0
                              : row.count;
                        const off = row.now === "none";
                        return (
                          <li
                            key={row.tag}
                            data-testid="bulk-tag"
                            data-public={row.visNow}
                            class={[
                              "inline-flex items-stretch rounded-full ring-1 ring-inset",
                              off
                                ? "text-zinc-500 ring-zinc-300 dark:text-zinc-400 dark:ring-zinc-700"
                                : row.visNow === "shown"
                                  ? "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800"
                                  : "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
                            ]}
                          >
                            {/* Public on these photos or not (0021). */}
                            <button
                              type="button"
                              role="checkbox"
                              aria-label={`${row.tag}を公開`}
                              aria-checked={
                                row.visNow === "shown"
                                  ? "true"
                                  : row.visNow === "hidden"
                                    ? "false"
                                    : "mixed"
                              }
                              disabled={off || !row.public}
                              title={row.public ? undefined : "タグが非公開"}
                              data-testid="bulk-tag-public"
                              data-changed={
                                row.visNow !== row.visInitial ? "" : undefined
                              }
                              onClick$={() => {
                                row.visNow = nextVisState(
                                  row.visNow,
                                  row.visInitial,
                                );
                                tags.rows = [...tags.rows];
                              }}
                              class={[
                                "inline-flex h-11 items-center rounded-l-full pr-1 pl-3 disabled:opacity-40 sm:h-8 sm:pl-2.5",
                                "data-changed:ring-2 data-changed:ring-sky-500",
                              ]}
                            >
                              {row.visNow === "mixed" ? (
                                <span class="inline-flex items-center">
                                  <VisibilityIcon
                                    visibility="public"
                                    class="size-3.5"
                                  />
                                  <VisibilityIcon
                                    visibility="private"
                                    class="size-3.5"
                                  />
                                </span>
                              ) : (
                                <VisibilityIcon
                                  visibility={
                                    row.visNow === "shown"
                                      ? "public"
                                      : "private"
                                  }
                                />
                              )}
                            </button>
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={
                                row.now === "all"
                                  ? "true"
                                  : row.now === "none"
                                    ? "false"
                                    : "mixed"
                              }
                              data-changed={
                                row.now !== row.initial ? "" : undefined
                              }
                              onClick$={() => {
                                row.now = nextTagState(row.now, row.initial);
                                tags.rows = [...tags.rows];
                              }}
                              class={[
                                "inline-flex h-11 items-center gap-1.5 rounded-r-full pr-3 pl-1 text-sm sm:h-8",
                                off && "line-through",
                                "data-changed:ring-2 data-changed:ring-sky-500",
                              ]}
                            >
                              <span
                                aria-hidden="true"
                                class="inline-flex h-4 w-4 items-center justify-center rounded border border-current text-[0.625rem] leading-none"
                              >
                                {row.now === "all"
                                  ? "✓"
                                  : row.now === "some"
                                    ? "−"
                                    : ""}
                              </span>
                              {row.tag}
                              <span class={["text-xs tabular-nums", muted]}>
                                {shown}/{n}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div class="flex gap-2">
                    <label for="bulk-info-new-tag" class="sr-only">
                      タグを追加
                    </label>
                    <input
                      id="bulk-info-new-tag"
                      // (Not in Qwik's input types.)
                      {...{ list: "bulk-info-tag-options" }}
                      placeholder="タグを追加"
                      bind:value={draft}
                      maxLength={200}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellcheck={false}
                      enterKeyHint="done"
                      onKeyDown$={[
                        sync$((e: KeyboardEvent) => {
                          if (e.key === "Enter" && !e.isComposing) {
                            e.preventDefault();
                          }
                        }),
                        $((e: KeyboardEvent) => {
                          if (e.key === "Enter" && !e.isComposing) addTag();
                        }),
                      ]}
                      class={[field, "min-w-0"]}
                    />
                    <datalist id="bulk-info-tag-options">
                      {data.tags.map((t) => (
                        <option
                          key={t.name}
                          value={t.name}
                          label={t.public ? "公開" : "非公開"}
                        />
                      ))}
                    </datalist>
                    <button
                      type="button"
                      onClick$={addTag}
                      class={[buttonSecondary, "shrink-0 whitespace-nowrap"]}
                    >
                      追加
                    </button>
                  </div>
                </section>

                <section aria-labelledby="bulk-info-taken" class="space-y-2">
                  <h3 id="bulk-info-taken" class={sectionTitle}>
                    撮影日時
                  </h3>
                  <div class="grid gap-3 sm:grid-cols-3">
                    <ValueField
                      name="date"
                      text="日付"
                      type="date"
                      value={sharedDate}
                      fixed
                    />
                    <ValueField
                      name="time"
                      text="時刻"
                      type="time"
                      value={sharedTime}
                    />
                    <div>
                      <label for="bulk-info-offset" class={label}>
                        時差
                      </label>
                      <select
                        id="bulk-info-offset"
                        name="offset"
                        data-initial={sharedOffset ?? ""}
                        onChange$={(_, el) => markChanged(el)}
                        class={[field, changedRing]}
                      >
                        <option value="" selected={!sharedOffset}>
                          {sharedOffset === undefined ? MIXED : "—"}
                        </option>
                        {OFFSETS.map((o) => (
                          <option
                            key={o}
                            value={o}
                            selected={sharedOffset === o}
                          >
                            {`UTC${o}`}
                          </option>
                        ))}
                        <option value="Z" selected={sharedOffset === "Z"}>
                          UTC
                        </option>
                      </select>
                    </div>
                  </div>
                </section>

                {vrchat && (
                  <section aria-labelledby="bulk-info-world" class="space-y-2">
                    <h3 id="bulk-info-world" class={sectionTitle}>
                      ワールド
                    </h3>
                    <div class="grid gap-3 sm:grid-cols-2">
                      <ValueField
                        name="world_id"
                        text="ワールド ID"
                        value={sharedOf((p) => p.world_id)}
                      />
                      <ValueField
                        name="world_name"
                        text="ワールド名"
                        value={sharedOf((p) => p.world_name)}
                      />
                    </div>
                  </section>
                )}

                <section aria-labelledby="bulk-info-location" class="space-y-2">
                  <h3 id="bulk-info-location" class={sectionTitle}>
                    撮影場所
                  </h3>
                  <div class="grid gap-3 sm:grid-cols-2">
                    <ValueField
                      name="latitude"
                      text="緯度"
                      inputMode="decimal"
                      value={sharedOf((p) => p.latitude)}
                    />
                    <ValueField
                      name="longitude"
                      text="経度"
                      inputMode="decimal"
                      value={sharedOf((p) => p.longitude)}
                    />
                  </div>
                  {/* As on the edit page: no map for photos on virtual
                      platforms alone unless one has a position. It fills
                      the inputs. */}
                  {(realPlace || photos.some((p) => p.latitude !== null)) && (
                    <LocationPicker
                      latitude={shared(photos.map((p) => p.latitude)) ?? null}
                      longitude={shared(photos.map((p) => p.longitude)) ?? null}
                    />
                  )}
                </section>

                <section aria-labelledby="bulk-info-exif" class="space-y-2">
                  <h3 id="bulk-info-exif" class={sectionTitle}>
                    撮影設定
                  </h3>
                  <div class="grid gap-3 sm:grid-cols-2">
                    {EXIF_EDIT_KEYS.map((k) => (
                      <ValueField
                        key={k}
                        name={`exif_${k}`}
                        text={EXIF_LABELS[k]}
                        inputMode={
                          k === "focal_length_mm" ||
                          k === "f_number" ||
                          k === "iso"
                            ? "decimal"
                            : undefined
                        }
                        value={sharedOf((p) => p.exif[k])}
                      />
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
          <div class="space-y-2 border-t border-zinc-200 p-4 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))] dark:border-zinc-800">
            {error.value && (
              <p role="alert" class="text-sm text-red-700 dark:text-red-400">
                {error.value}
              </p>
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
                disabled={busy.value || !data}
                class={[buttonPrimary, "max-sm:flex-1"]}
              >
                {busy.value ? "適用中…" : "適用"}
              </button>
            </div>
          </div>
        </form>
      </dialog>
    );
  },
);
