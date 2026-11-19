import { $, component$, useSignal, useTask$ } from "@builder.io/qwik";
import {
  Form,
  routeAction$,
  routeLoader$,
  useLocation,
  z,
  zod$,
  type DocumentHead,
} from "@builder.io/qwik-city";
import {
  isTagFieldLevel,
  parseOptionsText,
  readValue,
  TAG_FIELD_LEVEL_LABELS,
  TAG_FIELD_LIMITS,
  TAG_FIELD_TYPE_LABELS,
  TAG_FIELD_TYPES,
  validateFieldInput,
  validateLabel,
  validateOptions,
  type TagFieldDef,
  type TagFieldLevel,
  type TagFieldValue,
} from "@shared/tag-field/tag-field";
import { MissingBindingError } from "~/components/missing-binding-error";
import { StatePanel } from "~/components/state-panel";
import { SubmitButton } from "~/components/submit-button";
import { Toast, type ToastState } from "~/components/toast";
import {
  buttonSecondary,
  card,
  field,
  label,
  muted,
  textarea,
} from "~/components/ui";
import { listTags, setTagPublic, type TagRow } from "~/lib/db-meta";
import {
  addTagField,
  countTagValues,
  editTagField,
  listTagFields,
  moveTagField,
  removeTagField,
  restoreTagField,
  type FieldEdit,
  type RemovedField,
} from "~/lib/db-tag-field";
import { getDB } from "~/lib/env";
import { contentChanged } from "~/lib/last-good";

// /tag/: every tag, how many photos have it, and whether it is public.
// The public site only ever shows public tags; new ones start private.
// Each tag may also have fields (項目: e.g. フィルム → 銘柄, ISO), which
// every photo with the tag gets on its edit page; they are edited here
// under the tag's 項目 button.

type TagResult =
  | {
      kind: "ok";
      tags: TagRow[];
      fields: TagFieldDef[];
      /** Listed photos with a value, by field id. */
      counts: Record<string, number>;
    }
  | { kind: "missing-binding" };

export const useTags = routeLoader$<TagResult>(async ({ platform, status }) => {
  try {
    const db = getDB(platform);
    const [tags, fields] = await Promise.all([listTags(db), listTagFields(db)]);
    // A pass over media: only when there are fields to count for.
    const counts = fields.length > 0 ? await countTagValues(db) : {};
    return { kind: "ok", tags, fields, counts };
  } catch (err) {
    console.error("/tag loader: getDB failed:", err);
    status(500);
    return { kind: "missing-binding" };
  }
});

export const useSetTagPublic = routeAction$(
  async (data, { platform }) => {
    const db = getDB(platform);
    await setTagPublic(db, data.name, data.public === "1");
    await contentChanged(db);
    return { ok: true, name: data.name, public: data.public === "1" };
  },
  zod$({ name: z.string().min(1).max(200), public: z.enum(["0", "1"]) }),
);

export const useAddField = routeAction$(
  async (data, { platform, fail }) => {
    const v = validateFieldInput({
      label: data.label,
      type: data.type,
      options: parseOptionsText(data.options ?? ""),
    });
    if (!v.ok) return fail(400, { message: v.error });
    const r = await addTagField(getDB(platform), data.tag, v.value);
    if (!r.ok) return fail(409, { message: r.error });
    return { ok: true as const, field: r.value };
  },
  zod$({
    tag: z.string().min(1).max(200),
    label: z.string().max(200),
    type: z.string().max(20),
    options: z.string().max(5000).optional(),
  }),
);

/** A field's label, options or default level; returns the old ones. */
export const useEditField = routeAction$(
  async (data, { platform, fail }) => {
    const edit: FieldEdit = {};
    if (data.label !== undefined) {
      const v = validateLabel(data.label);
      if (!v.ok) return fail(400, { message: v.error });
      edit.label = v.value;
    }
    if (data.options !== undefined) {
      const v = validateOptions(
        Array.isArray(data.options)
          ? data.options
          : parseOptionsText(data.options),
      );
      if (!v.ok) return fail(400, { message: v.error });
      edit.options = v.value;
    }
    if (data.visibility !== undefined) {
      if (!isTagFieldLevel(data.visibility)) {
        return fail(400, { message: "bad level" });
      }
      edit.visibility = data.visibility;
    }
    const r = await editTagField(getDB(platform), data.id, edit);
    if (!r.ok) return fail(409, { message: r.error });
    // (An undo says so: its own toast, no undo of the undo.)
    return { ok: true as const, id: data.id, undo: !!data.undo, ...r.value };
  },
  zod$({
    id: z.coerce.number().int().positive(),
    label: z.string().max(200).optional(),
    options: z
      .union([z.string().max(5000), z.array(z.string().max(200)).max(100)])
      .optional(),
    visibility: z.string().max(20).optional(),
    undo: z.boolean().optional(),
  }),
);

export const useMoveField = routeAction$(
  async (data, { platform }) => {
    const moved = await moveTagField(getDB(platform), data.id, data.delta);
    return { ok: true as const, id: data.id, delta: data.delta, moved };
  },
  zod$({
    id: z.coerce.number().int().positive(),
    delta: z.coerce
      .number()
      .refine((d): d is -1 | 1 => d === -1 || d === 1)
      .transform((d) => d as -1 | 1),
  }),
);

export const useRemoveField = routeAction$(
  async (data, { platform, fail }) => {
    const removed = await removeTagField(getDB(platform), data.id);
    if (!removed) return fail(404, { message: "項目がありません" });
    return { ok: true as const, removed, undo: !!data.undo };
  },
  zod$({
    id: z.coerce.number().int().positive(),
    undo: z.boolean().optional(),
  }),
);

/** Undo of a removal: the field and its values, checked again. */
export const useRestoreField = routeAction$(
  async (data, { platform, fail }) => {
    const f = data.removed.field;
    const v = validateFieldInput({
      label: f.label,
      type: f.type,
      options: f.options ?? undefined,
    });
    if (!v.ok || !isTagFieldLevel(f.visibility)) {
      return fail(400, { message: v.ok ? "bad level" : v.error });
    }
    const removed: RemovedField = {
      field: {
        id: f.id,
        tag: f.tag,
        position: f.position,
        visibility: f.visibility,
        ...v.value,
      },
      values: data.removed.values.map(([id, value, level]) => [
        id,
        readValue(v.value.type, value) as TagFieldValue | null,
        isTagFieldLevel(level) ? (level as TagFieldLevel) : null,
      ]),
    };
    const r = await restoreTagField(getDB(platform), removed);
    if (!r.ok) return fail(409, { message: r.error });
    return { ok: true as const };
  },
  zod$({
    removed: z.object({
      field: z.object({
        id: z.number().int().positive(),
        tag: z.string().min(1).max(200),
        label: z.string().max(200),
        type: z.string().max(20),
        options: z.array(z.string().max(200)).max(100).nullable(),
        visibility: z.string().max(20),
        position: z.number().int(),
      }),
      values: z
        .array(
          z.tuple([
            z.number().int().positive(),
            z.union([z.string().max(400), z.number(), z.null()]),
            z.string().max(20).nullable(),
          ]),
        )
        .max(100_000),
    }),
  }),
);

/** The last change, for the toast's 元に戻す. */
type Undo =
  | { kind: "public"; name: string; public: boolean }
  | { kind: "add"; id: number }
  | { kind: "edit"; id: number; before: FieldEdit }
  | { kind: "move"; id: number; delta: -1 | 1 }
  | { kind: "remove"; removed: RemovedField };

const iconButton =
  "inline-flex size-11 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 sm:size-9 dark:text-zinc-300 dark:hover:bg-zinc-800";

const Switch = ({ on, text }: { on: boolean; text: string }) => (
  <>
    <span
      class={[
        "relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors",
        on ? "bg-sky-600" : "bg-zinc-300 dark:bg-zinc-700",
      ]}
    >
      <span
        class={[
          "absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform",
          on ? "translate-x-4.5" : "translate-x-0.5",
        ]}
      />
    </span>
    <span class="w-16 text-left whitespace-nowrap">{text}</span>
  </>
);

export default component$(() => {
  const data = useTags();
  const toggle = useSetTagPublic();
  const add = useAddField();
  const edit = useEditField();
  const move = useMoveField();
  const remove = useRemoveField();
  const restore = useRestoreField();
  const toast = useSignal<ToastState | null>(null);
  const last = useSignal<Undo | null>(null);
  /** The tag whose fields are open (?tag= opens one from a photo). */
  const open = useSignal<string | null>(
    useLocation().url.searchParams.get("tag"),
  );
  /** The new field's type, for showing the options box. */
  const newType = useSignal("text");

  const done = $((message: string, undo: Undo | null) => {
    last.value = undo;
    toast.value = {
      tone: "success",
      message,
      actionLabel: undo ? "元に戻す" : undefined,
    };
  });
  const failed = $((message: string | undefined) => {
    toast.value = { tone: "error", message: message ?? "変更できませんでした" };
  });

  useTask$(({ track }) => {
    const v = track(() => toggle.value);
    if (!v) return;
    if (v.failed) return failed(undefined);
    return done(`『${v.name}』を${v.public ? "公開" : "非公開"}にしました。`, {
      kind: "public",
      name: v.name,
      public: !v.public,
    });
  });
  useTask$(({ track }) => {
    const v = track(() => add.value);
    if (!v) return;
    if (v.failed) return failed(v.message);
    return done(`『${v.field.label}』を追加しました。`, {
      kind: "add",
      id: v.field.id,
    });
  });
  useTask$(({ track }) => {
    const v = track(() => edit.value);
    if (!v) return;
    if (v.failed) return failed(v.message);
    if (v.undo || Object.keys(v.before).length === 0) return;
    return done(
      v.before.label !== undefined
        ? `『${v.before.label}』を『${v.field.label}』にしました。`
        : `『${v.field.label}』を変えました。`,
      { kind: "edit", id: v.id, before: v.before },
    );
  });
  useTask$(({ track }) => {
    const v = track(() => remove.value);
    if (!v) return;
    if (v.failed) return failed(v.message);
    if (v.undo) return;
    return done(`『${v.removed.field.label}』を削除しました。`, {
      kind: "remove",
      removed: v.removed,
    });
  });
  useTask$(({ track }) => {
    const v = track(() => restore.value);
    if (!v) return;
    toast.value = v.failed
      ? { tone: "error", message: `元に戻せませんでした: ${v.message ?? ""}` }
      : { tone: "success", message: "元に戻しました。" };
  });

  const undo = $(async () => {
    const l = last.value;
    if (!l) return;
    last.value = null;
    if (l.kind === "public") {
      await toggle.submit({ name: l.name, public: l.public ? "1" : "0" });
      return;
    }
    let ok = true;
    if (l.kind === "add") {
      // An ordinary removal (values typed into it since go too, and come
      // back with its own 元に戻す).
      await remove.submit({ id: l.id });
      return;
    } else if (l.kind === "edit") {
      ok = !(await edit.submit({ id: l.id, ...l.before, undo: true })).value
        .failed;
    } else if (l.kind === "move") {
      ok = !(await move.submit({ id: l.id, delta: -l.delta as -1 | 1 })).value
        .failed;
    } else {
      await restore.submit({ removed: l.removed });
      return;
    }
    toast.value = ok
      ? { tone: "success", message: "元に戻しました。" }
      : { tone: "error", message: "元に戻せませんでした" };
  });

  if (data.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/" />;
  }
  const { tags, fields, counts } = data.value;
  const busy =
    add.isRunning ||
    edit.isRunning ||
    move.isRunning ||
    remove.isRunning ||
    restore.isRunning;
  return (
    <div class="mx-auto max-w-3xl space-y-6">
      <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
        タグ <span class={["font-normal", muted]}>({tags.length})</span>
      </h1>
      {tags.length === 0 ? (
        <StatePanel tone="empty" level={2} title="タグはまだありません" />
      ) : (
        <ul
          class={[
            card,
            "divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800",
          ]}
        >
          {tags.map((t) => {
            const own = fields.filter((f) => f.tag === t.name);
            const isOpen = open.value === t.name;
            const panelId = `fields-${encodeURIComponent(t.name)}`;
            return (
              <li key={t.name} data-testid="tag-row">
                <div class="flex flex-wrap items-center gap-x-3 px-4 py-2">
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-medium">{t.name}</span>
                    {own.length > 0 && (
                      <span
                        class={["block truncate text-xs", muted]}
                        data-testid="tag-field-summary"
                      >
                        {own.map((f) => f.label).join("・")}
                      </span>
                    )}
                  </span>
                  <span class={["text-xs tabular-nums", muted]}>
                    {t.count} 枚
                  </span>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick$={() => (open.value = isOpen ? null : t.name)}
                    class={[
                      "inline-flex h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium hover:bg-zinc-100 sm:h-9 dark:hover:bg-zinc-800",
                      isOpen && "bg-zinc-100 dark:bg-zinc-800",
                    ]}
                  >
                    項目
                    {own.length > 0 && (
                      <span class={["tabular-nums", muted]}>{own.length}</span>
                    )}
                    <span
                      aria-hidden="true"
                      class={["transition-transform", isOpen && "rotate-90"]}
                    >
                      ›
                    </span>
                  </button>
                  <Form action={toggle}>
                    <input type="hidden" name="name" value={t.name} />
                    <input
                      type="hidden"
                      name="public"
                      value={t.public ? "0" : "1"}
                    />
                    {/* A switch: its state is the tag's. */}
                    <button
                      type="submit"
                      role="switch"
                      aria-checked={t.public}
                      aria-label={`${t.name} を公開`}
                      disabled={toggle.isRunning}
                      class="group flex h-11 items-center gap-2 text-sm sm:h-9"
                    >
                      <Switch
                        on={t.public}
                        text={t.public ? "公開" : "非公開"}
                      />
                    </button>
                  </Form>
                </div>
                {isOpen && (
                  <div
                    id={panelId}
                    role="region"
                    aria-label={`${t.name}の項目`}
                    data-testid="tag-fields"
                    class="space-y-3 border-t border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/40"
                  >
                    {own.length > 0 && (
                      <ul class="space-y-2">
                        {own.map((f, i) => {
                          const n = counts[String(f.id)] ?? 0;
                          return (
                            <li
                              key={f.id}
                              data-testid="tag-field"
                              class="rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900"
                            >
                              <div class="flex flex-wrap items-center gap-2">
                                <Form
                                  action={edit}
                                  class="min-w-40 flex-1"
                                  // Renamed when the input loses focus
                                  // or on Enter.
                                >
                                  <input type="hidden" name="id" value={f.id} />
                                  <label
                                    for={`field-label-${f.id}`}
                                    class="sr-only"
                                  >
                                    項目名
                                  </label>
                                  <input
                                    // Keyed: an undo shows the old label.
                                    key={f.label}
                                    id={`field-label-${f.id}`}
                                    name="label"
                                    value={f.label}
                                    required
                                    maxLength={TAG_FIELD_LIMITS.label}
                                    enterKeyHint="done"
                                    onChange$={(_, el) =>
                                      el.form?.requestSubmit()
                                    }
                                    class={field}
                                  />
                                </Form>
                                <span
                                  class={["w-14 text-xs", muted]}
                                  data-testid="tag-field-type"
                                >
                                  {TAG_FIELD_TYPE_LABELS[f.type]}
                                </span>
                                <span
                                  class={[
                                    "w-12 text-right text-xs tabular-nums",
                                    muted,
                                  ]}
                                >
                                  {n} 枚
                                </span>
                                <Form action={edit}>
                                  <input type="hidden" name="id" value={f.id} />
                                  <input
                                    type="hidden"
                                    name="visibility"
                                    value={
                                      f.visibility === "shown"
                                        ? "hidden"
                                        : "shown"
                                    }
                                  />
                                  <button
                                    type="submit"
                                    role="switch"
                                    aria-checked={f.visibility === "shown"}
                                    aria-label={`${f.label}を公開サイトに出す`}
                                    disabled={busy}
                                    class="flex h-11 items-center gap-2 text-sm sm:h-9"
                                  >
                                    <Switch
                                      on={f.visibility === "shown"}
                                      text={
                                        TAG_FIELD_LEVEL_LABELS[f.visibility]
                                      }
                                    />
                                  </button>
                                </Form>
                                <span class="flex">
                                  <button
                                    type="button"
                                    aria-label={`${f.label}を上へ`}
                                    disabled={busy || i === 0}
                                    onClick$={async () => {
                                      const r = await move.submit({
                                        id: f.id,
                                        delta: -1,
                                      });
                                      if (!r.value.failed && r.value.moved) {
                                        await done("並べ替えました。", {
                                          kind: "move",
                                          id: f.id,
                                          delta: -1,
                                        });
                                      }
                                    }}
                                    class={iconButton}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`${f.label}を下へ`}
                                    disabled={busy || i === own.length - 1}
                                    onClick$={async () => {
                                      const r = await move.submit({
                                        id: f.id,
                                        delta: 1,
                                      });
                                      if (!r.value.failed && r.value.moved) {
                                        await done("並べ替えました。", {
                                          kind: "move",
                                          id: f.id,
                                          delta: 1,
                                        });
                                      }
                                    }}
                                    class={iconButton}
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`${f.label}を削除`}
                                    disabled={busy}
                                    onClick$={async () => {
                                      // Values go too: say how many first.
                                      if (
                                        n > 0 &&
                                        !confirm(
                                          `『${f.label}』を削除します。${n} 枚の写真に入っている値も消えます。`,
                                        )
                                      ) {
                                        return;
                                      }
                                      await remove.submit({ id: f.id });
                                    }}
                                    class={[
                                      iconButton,
                                      "text-red-700 dark:text-red-400",
                                    ]}
                                  >
                                    <svg
                                      viewBox="0 0 20 20"
                                      fill="currentColor"
                                      aria-hidden="true"
                                      class="size-4"
                                    >
                                      <path
                                        fill-rule="evenodd"
                                        d="M8.75 2.5A1.75 1.75 0 0 0 7 4.25V5H4a.75.75 0 0 0 0 1.5h.3l.8 9.6A2 2 0 0 0 7.1 18h5.8a2 2 0 0 0 2-1.9l.8-9.6h.3a.75.75 0 0 0 0-1.5h-3v-.75A1.75 1.75 0 0 0 11.25 2.5h-2.5ZM11.5 5v-.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25V5h3Z"
                                      />
                                    </svg>
                                  </button>
                                </span>
                              </div>
                              {f.type === "select" && (
                                <details class="group mt-1">
                                  <summary class="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 px-1 text-sm font-medium sm:min-h-8 [&::-webkit-details-marker]:hidden">
                                    <span
                                      aria-hidden="true"
                                      class="transition-transform group-open:rotate-90"
                                    >
                                      ›
                                    </span>
                                    選択肢（{(f.options ?? []).length}）
                                  </summary>
                                  <Form action={edit} class="mt-2 space-y-2">
                                    <input
                                      type="hidden"
                                      name="id"
                                      value={f.id}
                                    />
                                    <label
                                      for={`field-options-${f.id}`}
                                      class="sr-only"
                                    >
                                      選択肢（1 行に 1 つ）
                                    </label>
                                    <textarea
                                      key={(f.options ?? []).join("\n")}
                                      id={`field-options-${f.id}`}
                                      name="options"
                                      value={(f.options ?? []).join("\n")}
                                      class={textarea}
                                    />
                                    <SubmitButton
                                      running={edit.isRunning}
                                      class={buttonSecondary}
                                    >
                                      選択肢を保存
                                    </SubmitButton>
                                  </Form>
                                </details>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <Form
                      action={add}
                      aria-label={`${t.name}に項目を追加`}
                      onSubmitCompleted$={(ev, form) => {
                        const { value } = ev.detail as {
                          value?: { ok?: boolean };
                        };
                        if (value?.ok) {
                          form.reset();
                          newType.value = "text";
                        }
                      }}
                      class="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
                    >
                      <input type="hidden" name="tag" value={t.name} />
                      <div>
                        <label for={`new-field-${panelId}`} class={label}>
                          項目名
                        </label>
                        <input
                          id={`new-field-${panelId}`}
                          name="label"
                          required
                          maxLength={TAG_FIELD_LIMITS.label}
                          placeholder={
                            own.length === 0 ? "例: フィルム銘柄" : undefined
                          }
                          class={field}
                        />
                      </div>
                      <div>
                        <label for={`new-type-${panelId}`} class={label}>
                          種類
                        </label>
                        <select
                          id={`new-type-${panelId}`}
                          name="type"
                          onChange$={(_, el) => (newType.value = el.value)}
                          class={field}
                        >
                          {TAG_FIELD_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {TAG_FIELD_TYPE_LABELS[type]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <SubmitButton
                        running={add.isRunning}
                        class={buttonSecondary}
                      >
                        追加
                      </SubmitButton>
                      {newType.value === "select" && (
                        <div class="sm:col-span-3">
                          <label for={`new-options-${panelId}`} class={label}>
                            選択肢（1 行に 1 つ）
                          </label>
                          <textarea
                            id={`new-options-${panelId}`}
                            name="options"
                            required
                            class={textarea}
                          />
                        </div>
                      )}
                    </Form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Toast toast={toast} onAction$={undo} />
    </div>
  );
});

export const head: DocumentHead = { title: "タグ — Admin" };
