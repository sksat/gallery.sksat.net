import { $, component$, useSignal } from "@builder.io/qwik";
import {
  Link,
  routeAction$,
  routeLoader$,
  z,
  zod$,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { MissingBindingError } from "~/components/missing-binding-error";
import { StatePanel } from "~/components/state-panel";
import { Spinner } from "~/components/submit-button";
import { Toast, type ToastState } from "~/components/toast";
import {
  backLink,
  buttonPrimary,
  buttonSecondary,
  card,
  field,
  label,
  muted,
  tagChip,
} from "~/components/ui";
import {
  newRuleId,
  toDraft,
  UploadRuleEditor,
  type RuleDraft,
} from "~/components/upload-rule-editor";
import { MAX_BULK_IDS } from "~/lib/db";
import {
  applyExisting,
  cameraNames,
  getUploadRules,
  previewExisting,
  restoreExisting,
  setUploadRules,
  type ExistingBefore,
} from "~/lib/db-upload-rules";
import { listPlatforms } from "~/lib/db-platform";
import { getDB } from "~/lib/env";
import { PLATFORM_KEY_RE, platformOf } from "~/lib/platform";
import { usePlatformList } from "~/routes/layout";
import { inChunks } from "~/lib/selection";
import {
  actionLabels,
  conditionLabels,
  ruleTitle,
  applyScope,
  validateRules,
  type UploadRule,
} from "~/lib/upload-rules";

// /setting/upload-rule/: what a new photo gets from its file (platform,
// camera, tags, visibility, metadata levels), as an ordered list of rules
// (src/lib/upload-rules.ts). Every change is saved at once; the upload
// init applies the saved list. 既存の写真に適用 fills in what photos
// already uploaded lack.

type Result =
  | {
      kind: "ok";
      rules: UploadRule[];
      cameras: { id: number; name: string }[];
    }
  | { kind: "missing-binding" };

export const useRules = routeLoader$<Result>(async ({ platform, status }) => {
  try {
    const db = getDB(platform);
    const [rules, cameras] = await Promise.all([
      getUploadRules(db),
      cameraNames(db),
    ]);
    return { kind: "ok", rules, cameras };
  } catch (err) {
    console.error("/setting/upload-rule loader failed:", err);
    status(500);
    return { kind: "missing-binding" };
  }
});

export const useSaveRules = routeAction$(
  async (data, { platform, fail }) => {
    const v = validateRules(data.rules);
    if (!v.ok) return fail(400, { message: v.error });
    const db = getDB(platform);
    const known = new Set((await cameraNames(db)).map((c) => c.id));
    if (
      v.value.some((r) => r.actions.cameraId && !known.has(r.actions.cameraId))
    ) {
      return fail(400, { message: "そのカメラはありません" });
    }
    const platforms = new Set((await listPlatforms(db)).map((p) => p.key));
    if (
      v.value.some(
        (r) => r.actions.platform && !platforms.has(r.actions.platform),
      )
    ) {
      return fail(400, { message: "そのプラットフォームはありません" });
    }
    await setUploadRules(db, v.value);
    return { ok: true as const, rules: v.value };
  },
  zod$({ rules: z.array(z.unknown()).max(100) }),
);

export const usePreviewExisting = routeAction$(
  async (data, { platform, fail }) => {
    // Every photo only when that was chosen; a folder is checked as typed.
    const scope = applyScope(data.all, data.folder);
    if (!scope.ok) return fail(400, { message: scope.error });
    const db = getDB(platform);
    const folder = scope.folder;
    const preview = await previewExisting(db, await getUploadRules(db), folder);
    return { ok: true as const, folder, ...preview };
  },
  zod$({ all: z.boolean(), folder: z.string().max(300) }),
);

export const useApplyExisting = routeAction$(
  async (data, { platform }) => {
    const db = getDB(platform);
    const previous = await applyExisting(
      db,
      await getUploadRules(db),
      data.ids,
    );
    return { ok: true as const, previous };
  },
  zod$({
    ids: z.array(z.number().int().positive()).min(1).max(MAX_BULK_IDS),
  }),
);

export const useRestoreExisting = routeAction$(
  async (data, { platform }) => {
    await restoreExisting(getDB(platform), data.previous);
    return { ok: true as const };
  },
  zod$({
    previous: z
      .array(
        z.object({
          id: z.number().int().positive(),
          platform: z.string().regex(PLATFORM_KEY_RE),
          camera_id: z.number().int().positive().nullable(),
          camera_source: z.enum(["manual", "file"]).nullable(),
          tags: z.string().max(30000).nullable(),
          metadata_visibility: z.string().max(1000).nullable(),
        }),
      )
      .max(MAX_BULK_IDS),
  }),
);

/** What a rule sets, apart from its conditions (tagChip). */
const actionChip =
  "inline-flex items-center rounded-md bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-sky-200 ring-inset dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800";

type Undo =
  | { kind: "rules"; rules: UploadRule[] }
  | { kind: "existing"; previous: ExistingBefore[] };

const iconButton =
  "grid size-11 shrink-0 place-items-center rounded-lg text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent sm:size-9 dark:text-zinc-300 dark:hover:bg-zinc-800";

export default component$(() => {
  const data = useRules();
  const platforms = usePlatformList().value;
  const saveAction = useSaveRules();
  const previewAction = usePreviewExisting();
  const applyAction = useApplyExisting();
  const restoreAction = useRestoreExisting();
  const toast = useSignal<ToastState | null>(null);
  const undo = useSignal<Undo | null>(null);
  const rules = useSignal<UploadRule[]>(
    data.value.kind === "ok" ? data.value.rules : [],
  );
  const draft = useSignal<RuleDraft | null>(null);
  const isNew = useSignal(false);
  const folder = useSignal("");
  /** すべての写真 (rather than the typed folder). */
  const allPhotos = useSignal(false);
  const progress = useSignal<{ done: number; total: number } | null>(null);
  const preview = useSignal<{
    folder: string;
    photos: number;
    ids: number[];
    byRule: Record<string, number>;
  } | null>(null);

  /** Save the whole list; true when it went through. */
  const save = $(
    async (next: UploadRule[], message: string, undoable: boolean) => {
      // Each chunk of 既存の写真に適用 reads the saved rules: keep them.
      if (progress.value !== null) {
        toast.value = {
          tone: "error",
          message: "適用が終わってから変更してください",
        };
        return false;
      }
      const before = rules.value;
      rules.value = next;
      const r = await saveAction.submit({ rules: next }).catch(() => null);
      if (!r || r.value.failed) {
        rules.value = before;
        toast.value = {
          tone: "error",
          message:
            (r?.value.failed && String(r.value.message ?? "")) ||
            "保存できませんでした",
        };
        return false;
      }
      preview.value = null;
      undo.value = undoable ? { kind: "rules", rules: before } : null;
      toast.value = {
        tone: "success",
        message,
        ...(undoable ? { actionLabel: "元に戻す" } : {}),
      };
      return true;
    },
  );

  if (data.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/setting/" />;
  }
  const { cameras } = data.value;
  const names = new Map(cameras.map((c) => [c.id, c.name]));
  const list = rules.value;
  /** No changes while saving, or while an apply goes through. */
  const locked = saveAction.isRunning || progress.value !== null;

  return (
    <div class="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/setting/" prefetch="js" class={backLink}>
          ← 設定
        </Link>
        <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
          アップロード時のルール
        </h1>
      </div>

      <section aria-labelledby="rules-title" class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 id="rules-title" class="text-sm font-semibold">
            ルール{" "}
            <span class={["font-normal", muted]} data-testid="rules-order">
              上のルールが優先
            </span>
          </h2>
          <button
            type="button"
            onClick$={() => {
              isNew.value = true;
              draft.value = toDraft({
                id: newRuleId(),
                name: "",
                enabled: true,
                conditions: {},
                actions: {},
              });
            }}
            class={buttonPrimary}
          >
            ＋ ルールを追加
          </button>
        </div>
        {list.length === 0 ? (
          <StatePanel tone="empty" level={2} title="ルールはありません" />
        ) : (
          <ol class="space-y-3" data-testid="rule-list">
            {list.map((r, i) => {
              const title = ruleTitle(r);
              const count = preview.value?.byRule[r.id];
              return (
                <li
                  key={r.id}
                  data-testid="rule-card"
                  data-rule={r.id}
                  data-enabled={r.enabled ? "true" : "false"}
                  class={[
                    card,
                    "flex gap-2 p-3 sm:gap-3 sm:p-4",
                    !r.enabled && "opacity-60",
                  ]}
                >
                  <div class="flex shrink-0 flex-col">
                    <button
                      type="button"
                      aria-label={`${title} を上へ`}
                      disabled={i === 0 || locked}
                      onClick$={() => {
                        const next = [...list];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        return save(next, "並べ替えました。", true);
                      }}
                      class={iconButton}
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`${title} を下へ`}
                      disabled={i === list.length - 1 || locked}
                      onClick$={() => {
                        const next = [...list];
                        [next[i + 1], next[i]] = [next[i], next[i + 1]];
                        return save(next, "並べ替えました。", true);
                      }}
                      class={iconButton}
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                  </div>
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="flex items-start gap-2">
                      <h3 class="min-w-0 flex-1 pt-2 font-medium break-words sm:pt-1.5">
                        {title}
                      </h3>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={r.enabled}
                        aria-label={`${title} を使う`}
                        disabled={locked}
                        onClick$={() =>
                          save(
                            list.map((x) =>
                              x.id === r.id ? { ...x, enabled: !x.enabled } : x,
                            ),
                            r.enabled
                              ? `「${title}」を止めました。`
                              : `「${title}」を使います。`,
                            true,
                          )
                        }
                        class="flex h-11 min-w-11 shrink-0 items-center justify-center sm:h-9"
                      >
                        <span
                          class={[
                            "relative inline-flex h-6 w-10 rounded-full transition-colors",
                            r.enabled
                              ? "bg-sky-600"
                              : "bg-zinc-300 dark:bg-zinc-700",
                          ]}
                        >
                          <span
                            class={[
                              "absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform",
                              r.enabled ? "translate-x-4.5" : "translate-x-0.5",
                            ]}
                          />
                        </span>
                      </button>
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5 text-sm">
                      {conditionLabels(r.conditions).map((c) => (
                        <span key={c} class={tagChip}>
                          {c}
                        </span>
                      ))}
                      <span aria-hidden="true" class={muted}>
                        →
                      </span>
                      <span class="sr-only">なら</span>
                      {actionLabels(
                        r.actions,
                        names,
                        (k) => platformOf(platforms, k).name,
                      ).map((a) => (
                        <span key={a} class={actionChip}>
                          {a}
                        </span>
                      ))}
                    </div>
                    <div class="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick$={() => {
                          isNew.value = false;
                          draft.value = toDraft(r);
                        }}
                        class="h-11 rounded-lg px-2 text-sm font-medium text-sky-700 hover:underline sm:h-8 dark:text-sky-400"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        disabled={locked}
                        onClick$={() =>
                          save(
                            list.filter((x) => x.id !== r.id),
                            `「${title}」を削除しました。`,
                            true,
                          )
                        }
                        class="h-11 rounded-lg px-2 text-sm font-medium text-red-700 hover:underline sm:h-8 dark:text-red-400"
                      >
                        削除
                      </button>
                      {count !== undefined && (
                        <span
                          data-testid="rule-count"
                          class={["ml-auto text-xs tabular-nums", muted]}
                        >
                          {count} 枚が変わります
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section
        aria-labelledby="existing-title"
        class={[card, "space-y-3 p-4 sm:p-6"]}
        data-testid="apply-existing"
      >
        <h2 id="existing-title" class="text-sm font-semibold">
          既存の写真に適用
        </h2>
        <p class={["text-xs", muted]}>
          空の項目だけ埋めます (Platform は Real
          のときだけ、公開範囲は変えません)
        </p>
        <form
          preventdefault:submit
          onSubmit$={async () => {
            const r = await previewAction
              .submit({ all: allPhotos.value, folder: folder.value })
              .catch(() => null);
            if (!r || r.value.failed) {
              preview.value = null;
              toast.value = {
                tone: "error",
                message:
                  (r?.value.failed && String(r.value.message ?? "")) ||
                  "確認できませんでした",
              };
              return;
            }
            const v = r.value;
            preview.value = {
              folder: v.folder!,
              photos: v.photos!,
              ids: v.ids!,
              byRule: v.byRule!,
            };
          }}
          class="flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <div class="flex-1">
            <label for="apply-folder" class={label}>
              フォルダ (下のフォルダも含む)
            </label>
            <input
              id="apply-folder"
              type="text"
              value={folder.value}
              placeholder="/VRChat"
              disabled={allPhotos.value}
              onInput$={(_, el) => {
                folder.value = el.value;
                preview.value = null;
              }}
              autoCapitalize="off"
              autoCorrect="off"
              spellcheck={false}
              class={[field, "disabled:opacity-50"]}
            />
          </div>
          <label class="flex h-11 shrink-0 cursor-pointer items-center gap-2 text-sm sm:h-10">
            <input
              type="checkbox"
              checked={allPhotos.value}
              onChange$={(_, el) => {
                allPhotos.value = el.checked;
                preview.value = null;
              }}
              class="size-4"
            />
            すべての写真
          </label>
          <button
            type="submit"
            disabled={previewAction.isRunning}
            class={buttonSecondary}
          >
            {previewAction.isRunning && <Spinner />}
            確認
          </button>
        </form>
        {/* Always in the DOM, so the count is announced when it comes. */}
        <p class="sr-only" aria-live="polite">
          {preview.value ? `${preview.value.ids.length} 枚が変わります` : ""}
        </p>
        {preview.value && (
          <div
            class="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50"
            data-testid="apply-preview"
          >
            <p class="mr-auto">
              {preview.value.folder === "/"
                ? "すべての写真"
                : preview.value.folder}{" "}
              の {preview.value.photos} 枚のうち{" "}
              <strong>{preview.value.ids.length} 枚</strong>が変わります
            </p>
            {preview.value.ids.length > 0 && (
              <button
                type="button"
                disabled={progress.value !== null}
                onClick$={async () => {
                  const p = preview.value;
                  if (!p) return;
                  const previous: ExistingBefore[] = [];
                  let error: string | null = null;
                  progress.value = { done: 0, total: p.ids.length };
                  for (const ids of inChunks(p.ids, MAX_BULK_IDS)) {
                    const r = await applyAction
                      .submit({ ids })
                      .catch(() => null);
                    if (!r || r.value.failed) {
                      error = "途中で失敗しました";
                      break;
                    }
                    previous.push(...(r.value.previous as ExistingBefore[]));
                    progress.value = {
                      done: progress.value.done + ids.length,
                      total: p.ids.length,
                    };
                  }
                  progress.value = null;
                  preview.value = null;
                  undo.value =
                    previous.length > 0 ? { kind: "existing", previous } : null;
                  toast.value = {
                    tone: error ? "error" : "success",
                    message: error
                      ? `${error} (${previous.length} 枚は適用済み)`
                      : `${previous.length} 枚に適用しました。`,
                    ...(previous.length > 0 ? { actionLabel: "元に戻す" } : {}),
                  };
                }}
                class={buttonPrimary}
                data-testid="apply-run"
              >
                {progress.value && <Spinner />}
                {progress.value
                  ? `適用中 ${progress.value.done} / ${progress.value.total}`
                  : `${preview.value.ids.length} 枚に適用`}
              </button>
            )}
          </div>
        )}
      </section>

      {draft.value && (
        <UploadRuleEditor
          draft={draft as typeof draft & { value: RuleDraft }}
          isNew={isNew.value}
          cameras={cameras}
          busy={locked}
          onSave$={async (rule) => {
            const exists = rules.value.some((r) => r.id === rule.id);
            const next = exists
              ? rules.value.map((r) => (r.id === rule.id ? rule : r))
              : [...rules.value, rule];
            const ok = await save(
              next,
              exists ? "保存しました。" : "ルールを追加しました。",
              true,
            );
            if (ok) draft.value = null;
          }}
          onClose$={() => {
            draft.value = null;
          }}
        />
      )}

      <Toast
        toast={toast}
        onAction$={async () => {
          const u = undo.value;
          if (!u) return;
          if (progress.value !== null) {
            // Kept for later: nothing changes while an apply goes through.
            toast.value = {
              tone: "error",
              message: "適用が終わってから元に戻してください",
            };
            return;
          }
          undo.value = null;
          if (u.kind === "rules") {
            await save(u.rules, "元に戻しました。", false);
            return;
          }
          for (const previous of inChunks(u.previous, MAX_BULK_IDS)) {
            const r = await restoreAction
              .submit({ previous })
              .catch(() => null);
            if (!r || r.value.failed) {
              toast.value = { tone: "error", message: "元に戻せませんでした" };
              return;
            }
          }
          toast.value = { tone: "success", message: "元に戻しました。" };
        }}
      />
    </div>
  );
});

export const head: DocumentHead = { title: "アップロード時のルール — Admin" };
