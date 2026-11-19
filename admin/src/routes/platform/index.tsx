import { $, component$, useSignal, useTask$ } from "@builder.io/qwik";
import {
  Form,
  routeAction$,
  routeLoader$,
  z,
  zod$,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { MissingBindingError } from "~/components/missing-binding-error";
import { SubmitButton } from "~/components/submit-button";
import { Toast, type ToastState } from "~/components/toast";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  field,
  label,
  muted,
  platformBadge,
} from "~/components/ui";
import {
  addPlatform,
  deletePlatform,
  listPlatformsWithCounts,
  movePlatform,
  restorePlatform,
  updatePlatform,
  type PlatformRow,
  type PlatformWithCount,
} from "~/lib/db-platform";
import { getDB } from "~/lib/env";
import {
  isBuiltinPlatform,
  PLATFORM_KEY_RE,
  PLATFORM_KIND_LABELS,
  PLATFORM_KINDS,
  PLATFORM_NAME_MAX,
  validatePlatformName,
  type PlatformKind,
} from "~/lib/platform";

// /platform/: where photos are taken (the `platform` table, 0014). Each
// platform's name (shown in the admin and on the public site, whose tag
// filter lists it) and kind (a virtual one has no real-world position)
// can be changed, the order too; one no photo uses can be deleted. Every
// change can be undone from the toast.

type PlatformResult =
  { kind: "ok"; platforms: PlatformWithCount[] } | { kind: "missing-binding" };

export const usePlatforms = routeLoader$<PlatformResult>(
  async ({ platform, status }) => {
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/platform loader: getDB failed:", err);
      status(500);
      return { kind: "missing-binding" };
    }
    return { kind: "ok", platforms: await listPlatformsWithCounts(db) };
  },
);

const key = z.string().regex(PLATFORM_KEY_RE);
const kind = z.enum(PLATFORM_KINDS);

export const useAddPlatform = routeAction$(
  async (data, { platform, fail }) => {
    const name = validatePlatformName(data.name);
    if (!name.ok) return fail(400, { message: name.error });
    const r = await addPlatform(getDB(platform), name.name, data.kind);
    if (!r.ok) return fail(400, { message: r.error });
    return { ok: true as const, row: r.value };
  },
  zod$({ name: z.string().max(200), kind }),
);

/** Name and kind; both change what the API answers (bumped in the batch). */
export const useUpdatePlatform = routeAction$(
  async (data, { platform, fail }) => {
    const name = validatePlatformName(data.name);
    if (!name.ok) return fail(400, { message: name.error });
    const r = await updatePlatform(getDB(platform), data.key, {
      name: name.name,
      kind: data.kind,
    });
    if (!r.ok) return fail(400, { message: r.error });
    return {
      ok: true as const,
      before: r.value,
      after: { key: data.key, name: name.name, kind: data.kind },
    };
  },
  zod$({ key, name: z.string().max(200), kind }),
);

export const useMovePlatform = routeAction$(
  async (data, { platform, fail }) => {
    const step = data.step === "1" ? 1 : -1;
    if (!(await movePlatform(getDB(platform), data.key, step))) {
      return fail(400, { message: "動かせませんでした" });
    }
    return { ok: true as const, key: data.key, step };
  },
  zod$({ key, step: z.enum(["-1", "1"]) }),
);

export const useDeletePlatform = routeAction$(
  async (data, { platform, fail }) => {
    const r = await deletePlatform(getDB(platform), data.key);
    if (!r.ok) return fail(400, { message: r.error });
    return { ok: true as const, row: r.value };
  },
  zod$({ key }),
);

/** Undo of a delete: the same row again. */
export const useRestorePlatform = routeAction$(
  async (data, { platform, fail }) => {
    const r = await restorePlatform(getDB(platform), data);
    if (!r.ok) return fail(400, { message: r.error });
    return { ok: true as const };
  },
  zod$({
    key,
    name: z.string().min(1).max(PLATFORM_NAME_MAX),
    kind,
    position: z.number().int(),
  }),
);

/** What 元に戻す does for the last change. */
type Undo =
  | { op: "add"; key: string }
  | { op: "update"; key: string; name: string; kind: PlatformKind }
  | { op: "move"; key: string; step: -1 | 1 }
  | { op: "delete"; row: PlatformRow };

// Name, kind and the button on one line from sm; on phones the name has
// its own line and the kind and button share the next.
const formGrid =
  "grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[1fr_auto_auto]";
const nameCell = "col-span-2 sm:col-span-1";

// A square: buttonSecondary's own padding is overridden.
const iconButton = [buttonSecondary, "w-11 px-0! sm:w-10"].join(" ");

const Arrow = ({ up }: { up: boolean }) => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    class={["size-4 shrink-0", up ? "" : "rotate-180"]}
  >
    <path
      fill-rule="evenodd"
      d="M10 3a.75.75 0 0 1 .53.22l5 5a.75.75 0 1 1-1.06 1.06L10.75 5.56v10.69a.75.75 0 0 1-1.5 0V5.56L5.53 9.28a.75.75 0 0 1-1.06-1.06l5-5A.75.75 0 0 1 10 3Z"
      clip-rule="evenodd"
    />
  </svg>
);

export default component$(() => {
  const data = usePlatforms();
  const add = useAddPlatform();
  const update = useUpdatePlatform();
  const move = useMovePlatform();
  const del = useDeletePlatform();
  const restore = useRestorePlatform();
  const toast = useSignal<ToastState | null>(null);
  const undo = useSignal<Undo | null>(null);
  /** Bumped after an add, to empty the form. */
  const added = useSignal(0);

  // $(): the tasks below capture them, so they must be serializable.
  const failed = $((v: { failed?: boolean; message?: string }) => {
    toast.value = {
      tone: "error",
      message: v.message ?? "変更できませんでした",
    };
  });
  const done = $((message: string, next: Undo | null) => {
    undo.value = next;
    toast.value = next
      ? { tone: "success", message, actionLabel: "元に戻す" }
      : { tone: "success", message };
  });

  useTask$(async ({ track }) => {
    const v = track(() => add.value);
    if (!v) return;
    if (v.failed) return await failed(v);
    added.value++;
    await done(`『${v.row.name}』を追加しました。`, {
      op: "add",
      key: v.row.key,
    });
  });
  useTask$(async ({ track }) => {
    const v = track(() => update.value);
    if (!v) return;
    if (v.failed) return await failed(v);
    await done(`『${v.after.name}』を保存しました。`, {
      op: "update",
      ...v.before,
    });
  });
  useTask$(async ({ track }) => {
    const v = track(() => move.value);
    if (!v) return;
    if (v.failed) return await failed(v);
    await done("並べ替えました。", {
      op: "move",
      key: v.key,
      step: v.step === 1 ? -1 : 1,
    });
  });
  useTask$(async ({ track }) => {
    const v = track(() => del.value);
    if (!v) return;
    if (v.failed) return await failed(v);
    await done(`『${v.row.name}』を削除しました。`, {
      op: "delete",
      row: v.row,
    });
  });
  useTask$(async ({ track }) => {
    const v = track(() => restore.value);
    if (!v) return;
    if (v.failed) return await failed(v);
    await done("元に戻しました。", null);
  });

  if (data.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/" />;
  }
  const { platforms } = data.value;
  const busy =
    add.isRunning ||
    update.isRunning ||
    move.isRunning ||
    del.isRunning ||
    restore.isRunning;

  return (
    <div class="mx-auto max-w-3xl space-y-6">
      <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
        プラットフォーム{" "}
        <span class={["font-normal", muted]}>({platforms.length})</span>
      </h1>
      <ul
        class={[
          card,
          "divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800",
        ]}
      >
        {platforms.map((p, i) => {
          const deletable = p.used === 0 && !isBuiltinPlatform(p.key);
          return (
            // Keyed by what is saved: a saved or undone change resets the
            // inputs to it.
            <li
              key={`${p.key}\n${p.name}\n${p.kind}`}
              data-testid="platform-row"
              class="space-y-2 px-4 py-3"
            >
              <div class="flex items-center gap-2">
                <span class={platformBadge(p.kind)}>{p.name}</span>
                <span class={["text-xs tabular-nums", muted]}>
                  {p.count} 枚
                </span>
                <span class="flex-1" />
                <Form action={move}>
                  <input type="hidden" name="key" value={p.key} />
                  <input type="hidden" name="step" value="-1" />
                  <button
                    type="submit"
                    class={iconButton}
                    aria-label={`${p.name} を上へ`}
                    disabled={busy || i === 0}
                  >
                    <Arrow up />
                  </button>
                </Form>
                <Form action={move}>
                  <input type="hidden" name="key" value={p.key} />
                  <input type="hidden" name="step" value="1" />
                  <button
                    type="submit"
                    class={iconButton}
                    aria-label={`${p.name} を下へ`}
                    disabled={busy || i === platforms.length - 1}
                  >
                    <Arrow up={false} />
                  </button>
                </Form>
                <Form action={del}>
                  <input type="hidden" name="key" value={p.key} />
                  <button
                    type="submit"
                    class={buttonSecondary}
                    disabled={busy || !deletable}
                    title={
                      deletable
                        ? undefined
                        : p.used > 0
                          ? "写真があるので削除できません"
                          : "アップロードで使うので削除できません"
                    }
                  >
                    削除
                  </button>
                </Form>
              </div>
              <Form
                action={update}
                class={formGrid}
                aria-busy={update.isRunning}
              >
                <input type="hidden" name="key" value={p.key} />
                <div class={nameCell}>
                  <label for={`name-${p.key}`} class="sr-only">
                    {p.name} の名前
                  </label>
                  <input
                    id={`name-${p.key}`}
                    name="name"
                    value={p.name}
                    required
                    maxLength={PLATFORM_NAME_MAX}
                    class={field}
                  />
                </div>
                <div>
                  <label for={`kind-${p.key}`} class="sr-only">
                    {p.name} の種類
                  </label>
                  <select id={`kind-${p.key}`} name="kind" class={field}>
                    {PLATFORM_KINDS.map((k) => (
                      <option key={k} value={k} selected={p.kind === k}>
                        {PLATFORM_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <SubmitButton
                  running={update.isRunning}
                  class={buttonSecondary}
                >
                  保存
                </SubmitButton>
              </Form>
            </li>
          );
        })}
      </ul>

      <section class={[card, "space-y-3 p-4"]}>
        <h2 class="font-semibold">追加</h2>
        <Form
          key={added.value}
          action={add}
          class={formGrid}
          aria-busy={add.isRunning}
        >
          <div class={nameCell}>
            <label for="new-name" class={label}>
              名前
            </label>
            <input
              id="new-name"
              name="name"
              required
              maxLength={PLATFORM_NAME_MAX}
              placeholder="Resonite"
              class={field}
            />
          </div>
          <div>
            <label for="new-kind" class={label}>
              種類
            </label>
            <select id="new-kind" name="kind" class={field}>
              {PLATFORM_KINDS.map((k) => (
                <option key={k} value={k} selected={k === "virtual"}>
                  {PLATFORM_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton running={add.isRunning} class={buttonPrimary}>
            追加
          </SubmitButton>
        </Form>
      </section>

      <Toast
        toast={toast}
        onAction$={async () => {
          const u = undo.value;
          if (!u) return;
          undo.value = null;
          if (u.op === "add") await del.submit({ key: u.key });
          else if (u.op === "update") {
            await update.submit({ key: u.key, name: u.name, kind: u.kind });
          } else if (u.op === "move") {
            await move.submit({ key: u.key, step: u.step === 1 ? "1" : "-1" });
          } else await restore.submit(u.row);
        }}
      />
    </div>
  );
});

export const head: DocumentHead = { title: "プラットフォーム — Admin" };
