import {
  $,
  component$,
  noSerialize,
  useSignal,
  useVisibleTask$,
  type NoSerialize,
  type QRL,
  type Signal,
} from "@builder.io/qwik";
import { MAX_BULK_IDS } from "~/lib/db";
import { formatBytes, UPLOAD_ACCEPT } from "~/lib/upload";
import type { IncompleteUpload } from "~/lib/db-upload";
import { browserDeps, type PickedFile } from "~/lib/upload-client";
import {
  createUploadQueue,
  summarize,
  type UploadItem,
  type UploadQueue,
  type UploadStatus,
} from "~/lib/upload-queue";
import type { Visibility } from "~/lib/types";
import { buttonPrimary, buttonSecondary, card, muted } from "./ui";

// Uploading photos into the open folder of the Files view: a button that
// opens the file picker (the page puts it in the toolbar) and a panel with
// a row per file, the overall progress, retry and, once done, a quick
// visibility change. The queue (src/lib/upload-queue.ts) runs in the
// browser; this file only wires it to Qwik.

export type Uploader = {
  items: Signal<UploadItem[]>;
  queue: Signal<NoSerialize<UploadQueue<PickedFile>>>;
  /** Queue picked files for `dir`. */
  add: QRL<(dir: string, files: PickedFile[]) => void>;
  /** Drop finished rows from the panel. */
  clear: QRL<() => void>;
};

/** Phones upload two at a time (each file is hashed in memory first). */
const concurrencyFor = () =>
  window.matchMedia("(pointer: coarse)").matches ? 2 : 3;

/**
 * The page's uploader state. Once a batch has finished, `refresh` reloads
 * the page data so the new photos show up in the folder. (A routeAction
 * does that; navigating to the same URL with forceReload reuses Qwik
 * City's cached page data.)
 */
export const useUploader = (refresh: QRL<() => unknown>): Uploader => {
  const items = useSignal<UploadItem[]>([]);
  /** Anything queued or in flight (changes only at a batch's ends). */
  const busy = useSignal(false);
  /** Done files the page data already includes. */
  const shownDone = useSignal(0);
  const queue = useSignal<NoSerialize<UploadQueue<PickedFile>>>();

  const add = $((dir: string, files: PickedFile[]) => {
    if (!queue.value) {
      queue.value = noSerialize(
        createUploadQueue(
          browserDeps((next) => {
            items.value = next;
            busy.value = summarize(next).active > 0;
          }, concurrencyFor()),
        ),
      );
    }
    queue.value?.add(dir, files);
  });
  const clear = $(() => {
    queue.value?.clearFinished();
    shownDone.value = 0;
  });

  // While anything is in flight: keep the screen on (a phone that sleeps
  // drops the upload) and warn before leaving the page. When a batch
  // ends with new photos, reload the page data.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    if (!track(() => busy.value)) {
      const done = summarize(items.value).count.done;
      if (done > shownDone.value) void refresh();
      shownDone.value = done;
      return;
    }
    let lock: WakeLockSentinel | null = null;
    let released = false;
    const acquire = () =>
      navigator.wakeLock
        ?.request("screen")
        .then((l) => {
          if (released) void l.release();
          else lock = l;
        })
        .catch(() => {});
    // A wake lock is dropped when the page is hidden; take it again.
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("beforeunload", onBeforeUnload);
    cleanup(() => {
      released = true;
      void lock?.release().catch(() => {});
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("beforeunload", onBeforeUnload);
    });
  });

  return { items, queue, add, clear };
};

const UploadIcon = () => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    class="size-4"
  >
    <path d="M10 2.5a.75.75 0 0 1 .53.22l4 4a.75.75 0 1 1-1.06 1.06l-2.72-2.72v8.19a.75.75 0 0 1-1.5 0V5.06L6.53 7.78a.75.75 0 0 1-1.06-1.06l4-4A.75.75 0 0 1 10 2.5ZM3.75 14a.75.75 0 0 1 .75.75v.75c0 .14.11.25.25.25h10.5c.14 0 .25-.11.25-.25v-.75a.75.75 0 0 1 1.5 0v.75A1.75 1.75 0 0 1 15.25 17H4.75A1.75 1.75 0 0 1 3 15.5v-.75a.75.75 0 0 1 .75-.75Z" />
  </svg>
);

/** "Upload" button: a label around a hidden file input. */
export const UploadButton = component$<{ uploader: Uploader; dir: string }>(
  ({ uploader, dir }) => (
    <label
      class={[
        buttonPrimary,
        "cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-sky-500 max-sm:flex-1",
      ]}
    >
      <UploadIcon />
      Upload
      <input
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        aria-label="Upload photos"
        data-testid="upload-input"
        class="sr-only"
        onChange$={(_, el) => {
          const files = Array.from(el.files ?? []).map((f): PickedFile => ({
            name: f.name,
            relativePath: f.name,
            size: f.size,
            type: f.type,
            blob: f,
          }));
          // Picking the same files again must fire change again.
          el.value = "";
          if (files.length > 0) void uploader.add(dir, files);
        }}
      />
    </label>
  ),
);

/**
 * Uploads in this folder that never completed (their rows reserve the
 * path, but they are not photos). Picking the same file again resumes
 * one; Delete forgets it.
 */
export const IncompleteUploads = component$<{
  rows: IncompleteUpload[];
  uploader: Uploader;
  /** Delete one (the page's action; it reloads the data). */
  onDelete$: QRL<(id: number) => Promise<unknown>>;
}>((props) => {
  const busy = useSignal<number | null>(null);
  // Not the ones the upload panel already shows (in flight or failed).
  const inFlight = new Set(
    props.uploader.items.value
      .filter((i) => i.mediaId !== null)
      .map((i) => i.mediaId),
  );
  const rows = props.rows.filter((r) => !inFlight.has(r.id));
  if (rows.length === 0) return null;
  return (
    <section
      aria-label="Incomplete uploads"
      data-testid="incomplete-uploads"
      class="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30"
    >
      <h2 class="font-semibold text-amber-900 dark:text-amber-200">
        未完了のアップロード ({rows.length})
      </h2>
      <p class="text-amber-900/80 dark:text-amber-200/80">
        同じファイルをもう一度アップロードすると続きから登録します。
      </p>
      <ul class="divide-y divide-amber-200 dark:divide-amber-900">
        {rows.map((r) => (
          <li
            key={r.id}
            data-testid="incomplete-row"
            class="flex items-center gap-3 py-1.5"
          >
            <span class="min-w-0 flex-1 truncate" title={r.file}>
              {r.file.slice(r.file.lastIndexOf("/") + 1)}
            </span>
            {r.size !== null && (
              <span class={["shrink-0 text-xs tabular-nums", muted]}>
                {formatBytes(r.size)}
              </span>
            )}
            <button
              type="button"
              disabled={busy.value !== null}
              aria-label={`${r.file} の未完了のアップロードを削除`}
              onClick$={async () => {
                busy.value = r.id;
                try {
                  await props.onDelete$(r.id);
                } finally {
                  busy.value = null;
                }
              }}
              class="h-11 shrink-0 rounded-lg px-2 font-medium text-red-700 disabled:opacity-60 sm:h-auto dark:text-red-400"
            >
              削除
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
});

const STATUS_LABEL: Record<UploadStatus, string> = {
  queued: "待機中",
  preparing: "準備中",
  uploading: "アップロード中",
  completing: "仕上げ中",
  done: "完了",
  skipped: "スキップ",
  failed: "失敗",
};

const Bar = ({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "error";
}) => (
  <div
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(value * 100)}
    class="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
  >
    <div
      class={[
        "h-full rounded-full transition-[width] duration-300",
        tone === "error" ? "bg-red-500" : "bg-sky-500",
      ]}
      style={{ width: `${Math.round(value * 100)}%` }}
    />
  </div>
);

const VISIBILITY_CHOICES: { v: Visibility; label: string }[] = [
  { v: "unlisted", label: "限定公開にする" },
  { v: "public", label: "公開する" },
];

type PanelProps = {
  uploader: Uploader;
  /** Change the visibility of uploaded photos (the page's bulk action). */
  onSetVisibility$: QRL<(ids: number[], visibility: Visibility) => void>;
};

export const UploadPanel = component$<PanelProps>(
  ({ uploader, onSetVisibility$ }) => {
    const list = uploader.items.value;
    if (list.length === 0) return null;
    const { count, active, progress } = summarize(list);
    // Unique: the same file picked twice resumes one row.
    const uploadedIds = [
      ...new Set(
        list
          .filter((i) => i.status === "done" && i.mediaId !== null)
          .map((i) => i.mediaId as number),
      ),
    ];
    const total = list.length - count.skipped;
    const finished = count.done + count.failed;
    return (
      <section
        aria-label="Uploads"
        data-testid="upload-panel"
        class={[card, "space-y-3 p-4"]}
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-semibold" aria-live="polite">
            {active > 0
              ? `アップロード中 ${finished} / ${total}`
              : count.failed > 0
                ? `${count.failed} 件が失敗しました`
                : `${count.done} 件アップロードしました`}
          </h2>
          <div class="flex gap-2">
            {count.failed > 0 && (
              <button
                type="button"
                onClick$={() => uploader.queue.value?.retryFailed()}
                class={buttonSecondary}
              >
                失敗したものを再試行
              </button>
            )}
            {active === 0 && (
              <button
                type="button"
                onClick$={() => uploader.clear()}
                class={buttonSecondary}
              >
                閉じる
              </button>
            )}
          </div>
        </div>
        <Bar value={progress} label="全体の進み具合" />

        {active === 0 && uploadedIds.length > 0 && (
          <div class="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
            <p class="mr-auto">
              {uploadedIds.length} 枚は非公開で追加されました。
              {uploadedIds.length > MAX_BULK_IDS &&
                ` 公開範囲は一覧から ${MAX_BULK_IDS} 枚ずつ変更してください。`}
            </p>
            {/* The bulk action takes one page (MAX_BULK_IDS) at a time. */}
            {uploadedIds.length <= MAX_BULK_IDS &&
              VISIBILITY_CHOICES.map(({ v, label }) => (
                <button
                  key={v}
                  type="button"
                  onClick$={() => onSetVisibility$(uploadedIds, v)}
                  class={buttonSecondary}
                >
                  {label}
                </button>
              ))}
          </div>
        )}

        <ul class="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {list.map((it) => (
            <li
              key={it.key}
              data-testid="upload-row"
              data-status={it.status}
              class="space-y-1.5 py-2"
            >
              <div class="flex items-center gap-3">
                <span
                  class="min-w-0 flex-1 truncate font-medium"
                  title={it.file || it.name}
                >
                  {it.name}
                </span>
                <span class={["shrink-0 text-xs tabular-nums", muted]}>
                  {formatBytes(it.size)}
                </span>
                <span
                  class={[
                    "shrink-0 text-xs font-medium",
                    it.status === "failed"
                      ? "text-red-700 dark:text-red-400"
                      : it.status === "done"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : muted,
                  ]}
                >
                  {STATUS_LABEL[it.status]}
                </span>
                {it.status === "failed" && (
                  <button
                    type="button"
                    onClick$={() => uploader.queue.value?.retry(it.key)}
                    aria-label={`${it.name} を再試行`}
                    class="h-11 shrink-0 rounded-lg px-2 text-sm font-medium text-sky-700 sm:h-auto dark:text-sky-400"
                  >
                    再試行
                  </button>
                )}
              </div>
              {(it.status === "uploading" ||
                it.status === "completing" ||
                it.status === "failed") && (
                <Bar
                  value={it.size ? it.loaded / it.size : 0}
                  label={`${it.name} の進み具合`}
                  tone={it.status === "failed" ? "error" : undefined}
                />
              )}
              {it.message && (
                <p
                  class={[
                    "text-xs",
                    it.status === "failed"
                      ? "text-red-700 dark:text-red-400"
                      : muted,
                  ]}
                >
                  {it.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  },
);
