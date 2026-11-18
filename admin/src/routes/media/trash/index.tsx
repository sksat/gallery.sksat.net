import { $, component$, useSignal, useTask$ } from "@builder.io/qwik";
import {
  Form,
  Link,
  routeAction$,
  routeLoader$,
  z,
  zod$,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { MissingBindingError } from "~/components/missing-binding-error";
import { StatePanel } from "~/components/state-panel";
import { SubmitButton } from "~/components/submit-button";
import { Thumb } from "~/components/thumb";
import { Toast, type ToastState } from "~/components/toast";
import {
  backLink,
  buttonPrimary,
  buttonSecondary,
  card,
  muted,
} from "~/components/ui";
import { getUploadConfig } from "~/lib/b2";
import { deleteAllVersions } from "~/lib/b2-delete";
import {
  listTrash,
  purgeItems,
  RestoreError,
  restoreItems,
  type TrashedPhoto,
} from "~/lib/db-ops";
import { getDB, getImageBase } from "~/lib/env";
import { formatJst, splitPath } from "~/lib/format";
import { formatDecimalBytes } from "~/lib/storage";

// The trash (/media/trash/): photos taken out of the Files view. They are
// not on the public site; 元に戻す puts them back where they were (a
// numbered name if that place was taken meanwhile), 完全に削除 deletes
// every version of the B2 object and then the row, after a confirmation.

type TrashResult =
  | {
      kind: "ok";
      rows: TrashedPhoto[];
      bytes: number;
      imageBase: string | null;
      /** B2 settings exist, so 完全に削除 can work. */
      canPurge: boolean;
    }
  | { kind: "missing-binding" };

export const useTrash = routeLoader$<TrashResult>(
  async ({ platform, status }) => {
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/media/trash loader: getDB failed:", err);
      status(500);
      return { kind: "missing-binding" };
    }
    const { rows, bytes } = await listTrash(db);
    return {
      kind: "ok",
      rows,
      bytes,
      imageBase: getImageBase(platform),
      canPurge: getUploadConfig(platform) !== null,
    };
  },
);

const ids = z.array(z.string().max(20)).max(10_000).default([]);
const parseIds = (raw: readonly string[]) =>
  [...new Set(raw.map(Number))].filter((n) => Number.isInteger(n) && n > 0);

export const useRestore = routeAction$(async (data, { platform, fail }) => {
  const picked = parseIds(data.ids);
  if (picked.length === 0) return fail(400, { message: "選ばれていません" });
  try {
    const r = await restoreItems(getDB(platform), picked);
    return { ok: true, restored: r.restored.length };
  } catch (err) {
    if (err instanceof RestoreError) return fail(409, { message: err.message });
    throw err;
  }
}, zod$({ ids }));

/**
 * Photos deleted per request: each costs a few B2 requests (list, then a
 * DELETE per version), and a Pages request may make only 50 subrequests
 * on the Free plan. The page sends larger selections in turns.
 */
const PURGE_CHUNK = 10;

export const usePurge = routeAction$(async (data, { platform, fail }) => {
  const config = getUploadConfig(platform);
  if (!config) {
    return fail(503, { message: "B2 の設定がないので削除できません" });
  }
  const db = getDB(platform);
  const picked = parseIds(data.ids);
  if (picked.length === 0) return fail(400, { message: "選ばれていません" });
  if (picked.length > PURGE_CHUNK) {
    return fail(400, { message: `一度に ${PURGE_CHUNK} 件までです` });
  }
  const r = await purgeItems(db, picked, async (file) => {
    await deleteAllVersions(config, file);
  });
  return {
    ok: true,
    deleted: r.deleted.length,
    notDeleted: r.failed.length,
    error: r.failed[0]?.error ?? null,
  };
}, zod$({ ids }));

export default component$(() => {
  const data = useTrash();
  const restore = useRestore();
  const purge = usePurge();
  const toast = useSignal<ToastState | null>(null);
  /** Which purge is waiting for its confirmation: picked ones, or all. */
  const confirming = useSignal<"picked" | "all" | null>(null);
  const picked = useSignal(0);

  useTask$(({ track }) => {
    const v = track(() => restore.value);
    if (!v) return;
    toast.value = v.failed
      ? { tone: "error", message: v.message ?? "元に戻せませんでした" }
      : { tone: "success", message: `${v.restored} 件を元に戻しました。` };
  });
  /** Deleting in turns: how far it got, for the button. */
  const purging = useSignal<{ done: number; total: number } | null>(null);
  /** Delete `ids` for good, PURGE_CHUNK per request, then say how it went. */
  const purgeAll = $(async (ids: string[]) => {
    let deleted = 0;
    let notDeleted = 0;
    let error: string | null = null;
    purging.value = { done: 0, total: ids.length };
    for (let i = 0; i < ids.length; i += PURGE_CHUNK) {
      const chunk = ids.slice(i, i + PURGE_CHUNK);
      const { value: v } = await purge.submit({ ids: chunk });
      if (v.failed) {
        notDeleted += chunk.length;
        error ??= v.message ?? "削除できませんでした";
      } else {
        deleted += v.deleted;
        notDeleted += v.notDeleted;
        error ??= v.error;
      }
      purging.value = { done: i + chunk.length, total: ids.length };
    }
    purging.value = null;
    confirming.value = null;
    toast.value =
      notDeleted > 0
        ? {
            tone: "error",
            message:
              deleted > 0
                ? `${deleted} 件を削除、${notDeleted} 件は削除できませんでした: ${error}`
                : `削除できませんでした: ${error}`,
          }
        : { tone: "success", message: `${deleted} 件を完全に削除しました。` };
  });
  const recount = $((form: HTMLFormElement) => {
    picked.value = form.querySelectorAll('input[name="ids[]"]:checked').length;
  });

  if (data.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/media/" />;
  }
  const { rows, bytes, imageBase, canPurge } = data.value;

  return (
    <div class="space-y-6">
      <div>
        <Link prefetch="js" href="/media/?view=files" class={backLink}>
          ← Files
        </Link>
        <div class="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
            ゴミ箱 <span class={["font-normal", muted]}>({rows.length})</span>
          </h1>
          <p class={["text-sm tabular-nums", muted]} data-testid="trash-bytes">
            合計 {formatDecimalBytes(bytes)}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <StatePanel tone="empty" level={2} title="ゴミ箱は空です">
          <p>Files で消した写真はここに入り、元に戻せます。</p>
        </StatePanel>
      ) : (
        <Form
          action={restore}
          id="trash-form"
          aria-busy={restore.isRunning || purging.value !== null}
          onChange$={(_, form) => recount(form)}
          onSubmitCompleted$={(_, form) => {
            form.reset();
            picked.value = 0;
          }}
          class="space-y-3"
        >
          <div class="flex flex-wrap items-center gap-2">
            <p class={["mr-auto text-sm", muted]}>
              {picked.value > 0 ? `${picked.value} 件選択中` : "選んでください"}
            </p>
            <SubmitButton
              running={restore.isRunning}
              disabled={picked.value === 0}
              class={buttonSecondary}
            >
              元に戻す
            </SubmitButton>
            {canPurge && (
              <>
                <button
                  type="button"
                  disabled={picked.value === 0}
                  onClick$={() => (confirming.value = "picked")}
                  class={[buttonSecondary, "text-red-700 dark:text-red-400"]}
                >
                  完全に削除…
                </button>
                <button
                  type="button"
                  onClick$={() => (confirming.value = "all")}
                  class={[buttonSecondary, "text-red-700 dark:text-red-400"]}
                >
                  ゴミ箱を空にする…
                </button>
              </>
            )}
          </div>

          <ul
            class={[
              card,
              "divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800",
            ]}
          >
            {rows.map((r) => {
              const { dir, base } = splitPath(r.path);
              return (
                <li
                  key={r.id}
                  data-testid="trash-row"
                  class="flex items-center gap-3 p-3 has-checked:bg-sky-50 dark:has-checked:bg-sky-950/40"
                >
                  <input
                    type="checkbox"
                    name="ids[]"
                    value={String(r.id)}
                    aria-label={`${r.path} を選ぶ`}
                    class="size-5 shrink-0 accent-sky-600"
                  />
                  <Thumb
                    file={r.file}
                    platform={r.platform}
                    imageBase={imageBase}
                    variant="list"
                    class="w-20 rounded-md"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-medium" title={r.path}>
                      {base}
                    </p>
                    <p class={["truncate text-xs", muted]}>{dir}</p>
                  </div>
                  <div
                    class={["shrink-0 text-right text-xs tabular-nums", muted]}
                  >
                    <p>{r.size === null ? "—" : formatDecimalBytes(r.size)}</p>
                    <p data-testid="trashed-at">{formatJst(r.trashed_at)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Form>
      )}

      {confirming.value && (
        <div
          role="alertdialog"
          aria-labelledby="purge-title"
          class="space-y-3 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
        >
          <p id="purge-title" class="font-semibold">
            {confirming.value === "all"
              ? `ゴミ箱の ${rows.length} 件を完全に削除しますか？`
              : `選んだ ${picked.value} 件を完全に削除しますか？`}
          </p>
          <p>B2 からファイルを消すので、元に戻せません。</p>
          <div class="flex flex-wrap gap-2">
            {/* Picked: the boxes ticked in the trash form. */}
            <button
              type="button"
              disabled={purging.value !== null}
              onClick$={async () => {
                // All: the rows this page lists (what the question
                // counted), not whatever is in the trash by now.
                const selector =
                  confirming.value === "all"
                    ? 'input[name="ids[]"]'
                    : 'input[name="ids[]"]:checked';
                const form = document.getElementById(
                  "trash-form",
                ) as HTMLFormElement | null;
                const ids = form
                  ? Array.from(
                      form.querySelectorAll<HTMLInputElement>(selector),
                      (b) => b.value,
                    )
                  : [];
                await purgeAll(ids);
              }}
              class={[buttonPrimary, "bg-red-600 hover:bg-red-700"]}
            >
              {purging.value
                ? `削除中… ${purging.value.done} / ${purging.value.total}`
                : "完全に削除する"}
            </button>
            <button
              type="button"
              onClick$={() => (confirming.value = null)}
              class={buttonSecondary}
            >
              やめる
            </button>
          </div>
        </div>
      )}
      <Toast toast={toast} />
    </div>
  );
});

export const head: DocumentHead = {
  title: "ゴミ箱 — Admin",
};
