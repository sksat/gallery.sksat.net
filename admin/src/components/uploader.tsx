import {
  $,
  component$,
  noSerialize,
  Slot,
  useSignal,
  useVisibleTask$,
  type NoSerialize,
  type QRL,
  type Signal,
} from "@builder.io/qwik";
import { MAX_BULK_IDS } from "~/lib/db";
import { formatUploadSize, UPLOAD_ACCEPT } from "~/lib/upload";
import type { IncompleteUpload } from "~/lib/db-upload";
import {
  collectDropped,
  MAX_DROPPED_FILES,
  type EntryLike,
} from "~/lib/drop-entries";
import {
  browserDeps,
  completeUploadRequest,
  type PickedFile,
} from "~/lib/upload-client";
import {
  createUploadQueue,
  summarize,
  UploadError,
  type UploadItem,
  type UploadQueue,
  type UploadStatus,
} from "~/lib/upload-queue";
import { dirOf } from "~/lib/folders";
import type { Visibility } from "~/lib/types";
import { buttonPrimary, buttonSecondary, card, muted, tagChip } from "./ui";

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
  /** Drop finished (and failed) rows from the panel. */
  clear: QRL<() => void>;
  /** Reload the page data. */
  refresh: QRL<() => unknown>;
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
    // Failed rows move to the folder's incomplete uploads: show them.
    void refresh();
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

  return { items, queue, add, clear, refresh };
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
        "min-w-fit cursor-pointer whitespace-nowrap has-focus-visible:outline-2 has-focus-visible:outline-sky-500 max-sm:flex-1",
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

/** What an incomplete row's failed completion means, in plain words. */
const completionProblem = (err: unknown): string =>
  err instanceof UploadError && !err.retryable
    ? err.message
    : "確認できませんでした（時間をおいて再読み込み）";

/** Completion checks run at once when a page lists incomplete uploads. */
const CHECKS_AT_ONCE = 2;

/**
 * A hidden file or folder inside a picked folder (".DS_Store", ".git/…").
 * The picked folder itself (the first segment) counts whatever its name.
 */
const isHiddenPath = (path: string) =>
  path
    .split("/")
    .slice(1)
    .some((s) => s.startsWith("."));

const FolderUploadIcon = () => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    class="size-4"
  >
    <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4.09a1.5 1.5 0 0 1 1.06.44L9.7 5.5h6.8A1.5 1.5 0 0 1 18 7v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 15.5v-10Zm8.53 3.22a.75.75 0 0 0-1.06 0l-2 2a.75.75 0 1 0 1.06 1.06l.72-.72v2.69a.75.75 0 0 0 1.5 0v-2.69l.72.72a.75.75 0 1 0 1.06-1.06l-2-2Z" />
  </svg>
);

/**
 * "Upload folder": a folder picker (webkitdirectory). Its files keep their
 * path inside the picked folder, so its subfolders are created under the
 * open one. Hidden until the browser is known to support it: iOS Safari
 * has the attribute but cannot pick folders, so it is left out there.
 */
export const UploadFolderButton = component$<{
  uploader: Uploader;
  dir: string;
}>(({ uploader, dir }) => {
  const supported = useSignal(false);
  /** The check ran (for tests: hidden on purpose, not just not yet). */
  const checked = useSignal(false);
  // On document ready: the label starts hidden, so the default strategy
  // (when it becomes visible) would never run.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    () => {
      const ios =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      supported.value =
        !ios && "webkitdirectory" in document.createElement("input");
      checked.value = true;
    },
    { strategy: "document-ready" },
  );
  return (
    <label
      data-testid="upload-folder"
      data-checked={checked.value ? "" : undefined}
      class={[
        buttonSecondary,
        "min-w-fit cursor-pointer whitespace-nowrap has-focus-visible:outline-2 has-focus-visible:outline-sky-500 max-sm:flex-1",
        !supported.value && "hidden!",
      ]}
    >
      <FolderUploadIcon />
      Upload folder
      <input
        type="file"
        multiple
        // Not in Qwik's JSX types.
        {...{ webkitdirectory: true }}
        aria-label="Upload a folder"
        data-testid="upload-folder-input"
        class="sr-only"
        onChange$={(_, el) => {
          const files = Array.from(el.files ?? [])
            .filter((f) => !isHiddenPath(f.webkitRelativePath || f.name))
            .map((f): PickedFile => ({
              name: f.name,
              relativePath: f.webkitRelativePath || f.name,
              size: f.size,
              type: f.type,
              blob: f,
            }));
          el.value = "";
          if (files.length > 0) void uploader.add(dir, files);
        }}
      />
    </label>
  );
});

/**
 * Drop files or folders anywhere on the wrapped area to upload them into
 * `dir`, or onto a folder in it (a `[data-drop]` element: a folder tile,
 * a tree folder, a breadcrumb) to upload them into that folder, which is
 * then marked like a move's target (`data-drop-over`). Native listeners
 * (attached once visible) because the drop's DataTransfer is only
 * readable during the event, before any lazily loaded handler could run.
 */
export const DropZone = component$<{
  uploader: Uploader;
  dir: string;
  /** Uploads are configured; otherwise it is a plain wrapper. */
  enabled: boolean;
  /** Something dropped could not be taken (unreadable, too many). */
  onProblem$: QRL<(message: string) => void>;
}>(({ uploader, dir, enabled, onProblem$ }) => {
  const ref = useSignal<HTMLElement>();
  const over = useSignal(false);
  /** The folder the drag is over, or null for the open folder. */
  const folder = useSignal<string | null>(null);
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const el = ref.value;
    if (!el || !enabled) return;
    let depth = 0;
    // A drag that started in this page (e.g. a thumbnail) is not an upload,
    // even though Chromium lists "Files" for a dragged image.
    let internal = false;
    const hasFiles = (e: DragEvent) =>
      !internal && Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const dragStart = () => (internal = true);
    const dragEnd = () => (internal = false);
    // Files dropped next to the zone would make the browser open them and
    // leave the admin.
    const swallow = (e: DragEvent) => {
      if (hasFiles(e) && !el.contains(e.target as Node)) e.preventDefault();
    };
    // The folder under the pointer, if any, marked like a move's target.
    let marked: HTMLElement | null = null;
    const mark = (t: HTMLElement | null) => {
      if (t === marked) return;
      marked?.removeAttribute("data-drop-over");
      t?.setAttribute("data-drop-over", "");
      marked = t;
      folder.value = t?.dataset.drop ?? null;
    };
    // A folder stays marked for a moment after the pointer leaves it, so
    // crossing the gap between two tiles does not flash the overlay; a
    // drop goes where the mark is.
    let lastHit = 0;
    const folderAt = (e: DragEvent) => {
      const t = (e.target as Element | null)?.closest?.<HTMLElement>(
        "[data-drop]",
      );
      if (t && el.contains(t)) {
        lastHit = e.timeStamp;
        return t;
      }
      return e.timeStamp - lastHit < 200 ? marked : null;
    };
    const reset = () => {
      depth = 0;
      over.value = false;
      mark(null);
    };
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      // No move is under way: forget one whose dragend never came, so the
      // folders' move handlers (file-browser.tsx) leave this drop alone.
      delete document.body.dataset.dragItems;
      delete document.body.dataset.dragFrom;
      depth++;
      over.value = true;
      mark(folderAt(e));
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) reset();
    };
    const dragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      mark(folderAt(e));
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const target = folderAt(e)?.dataset.drop || el.dataset.dir || "/";
      reset();
      // Read everything now: the DataTransfer is emptied after the event.
      const entries: EntryLike[] = [];
      const loose: File[] = [];
      for (const item of Array.from(e.dataTransfer?.items ?? [])) {
        if (item.kind !== "file") continue;
        const entry = item.webkitGetAsEntry?.() as EntryLike | null;
        if (entry) entries.push(entry);
        else {
          const f = item.getAsFile();
          if (f) loose.push(f);
        }
      }
      void collectDropped(entries).then(
        ({ files: dropped, failed, truncated }) => {
          const files = [
            ...loose.map((f) => ({ file: f, relativePath: f.name })),
            ...dropped,
          ].map(({ file, relativePath }): PickedFile => ({
            name: file.name,
            relativePath,
            size: file.size,
            type: file.type,
            blob: file,
          }));
          if (files.length > 0) void uploader.add(target, files);
          if (failed.length > 0) {
            void onProblem$(
              `読み込めなかったものを飛ばしました: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? ` ほか ${failed.length - 3} 件` : ""}`,
            );
          } else if (truncated) {
            void onProblem$(
              `一度に ${MAX_DROPPED_FILES} 件までです。残りはもう一度ドロップしてください`,
            );
          }
        },
      );
    };
    el.addEventListener("dragenter", enter);
    el.addEventListener("dragleave", leave);
    el.addEventListener("dragover", dragOver);
    el.addEventListener("drop", drop);
    document.addEventListener("dragstart", dragStart);
    document.addEventListener("dragend", dragEnd);
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    cleanup(() => {
      mark(null);
      el.removeEventListener("dragenter", enter);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("dragover", dragOver);
      el.removeEventListener("drop", drop);
      document.removeEventListener("dragstart", dragStart);
      document.removeEventListener("dragend", dragEnd);
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    });
  });
  return (
    <div ref={ref} data-dir={dir} data-testid="drop-zone" class="relative">
      <Slot />
      {/* Over a folder, that folder is marked instead (the overlay would
          cover it). */}
      {over.value && folder.value === null && (
        <div
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 z-20 rounded-xl border-2 border-dashed border-sky-500 bg-sky-50/80 text-base font-semibold text-sky-800 dark:bg-sky-950/70 dark:text-sky-200"
        >
          {/* Sticky: stays in view over a long folder. */}
          <p class="sticky top-1/2 py-24 text-center">
            ここにドロップして {dir} にアップロード
          </p>
        </div>
      )}
    </div>
  );
});

/**
 * Uploads in this folder that never completed (their rows reserve the
 * path, but they are not photos). Each is checked again on its own once
 * per page view (the completion, POST /api/upload/<id>): when the PUT went
 * through but the check did not, that registers it without uploading
 * again. Only the ones that still fail stay, with the reason, and can be
 * uploaded again (the same file resumes the row) or deleted.
 */
export const IncompleteUploads = component$<{
  rows: IncompleteUpload[];
  uploader: Uploader;
  /** Delete one (the page's action; it reloads the data). */
  onDelete$: QRL<(id: number) => Promise<unknown>>;
}>((props) => {
  const busy = useSignal<number | null>(null);
  /** Rows already checked in this page view, with the reason they failed. */
  const problems = useSignal<Record<number, string>>({});
  /** Rows being checked. */
  const checking = useSignal<number[]>([]);
  // Document-ready: the section renders nothing until there are rows, so
  // there may be no element to become visible.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    async ({ track }) => {
      const rows = track(() => props.rows);
      const inPanel = new Set(props.uploader.items.value.map((i) => i.mediaId));
      const todo = rows
        .map((r) => r.id)
        .filter(
          (id) =>
            !(id in problems.value) &&
            !checking.value.includes(id) &&
            !inPanel.has(id),
        );
      if (todo.length === 0) return;
      checking.value = [...checking.value, ...todo];
      let ready = 0;
      const queue = [...todo];
      const worker = async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          try {
            await completeUploadRequest(id);
            ready++;
          } catch (err) {
            problems.value = {
              ...problems.value,
              [id]: completionProblem(err),
            };
          }
          checking.value = checking.value.filter((x) => x !== id);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CHECKS_AT_ONCE, todo.length) }, worker),
      );
      if (ready > 0) await props.uploader.refresh();
    },
    { strategy: "document-ready" },
  );
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
      <ul class="divide-y divide-amber-200 dark:divide-amber-900">
        {rows.map((r) => (
          <li
            key={r.id}
            data-testid="incomplete-row"
            class="flex flex-wrap items-center gap-x-3 py-1.5"
          >
            <span class="min-w-0 flex-1 truncate" title={r.path}>
              {r.path.slice(r.path.lastIndexOf("/") + 1)}
            </span>
            {r.size !== null && (
              <span class={["shrink-0 text-xs tabular-nums", muted]}>
                {formatUploadSize(r.size)}
              </span>
            )}
            <label
              class={[
                "inline-flex h-11 shrink-0 cursor-pointer items-center rounded-lg px-2 font-medium text-sky-700 has-focus-visible:outline-2 has-focus-visible:outline-sky-500 sm:h-auto dark:text-sky-400",
                checking.value.includes(r.id) &&
                  "pointer-events-none opacity-60",
              ]}
            >
              アップロードし直す
              <input
                type="file"
                accept={UPLOAD_ACCEPT}
                aria-label={`${r.path} をアップロードし直す`}
                class="sr-only"
                onChange$={(_, el) => {
                  const f = el.files?.[0];
                  el.value = "";
                  if (!f) return;
                  // Checked afresh if it comes back here.
                  const rest = { ...problems.value };
                  delete rest[r.id];
                  problems.value = rest;
                  // Under the row's own name: the same file resumes it.
                  const name = r.path.slice(r.path.lastIndexOf("/") + 1);
                  void props.uploader.add(dirOf(r.path), [
                    {
                      name: f.name,
                      relativePath: name,
                      size: f.size,
                      type: f.type,
                      blob: f,
                    },
                  ]);
                }}
              />
            </label>
            <button
              type="button"
              disabled={busy.value !== null || checking.value.includes(r.id)}
              aria-label={`${r.path} の未完了のアップロードを削除`}
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
            <p
              data-testid="incomplete-reason"
              class="basis-full text-xs text-amber-900/80 dark:text-amber-200/80"
            >
              {checking.value.includes(r.id)
                ? "確認中…"
                : (problems.value[r.id] ?? "")}
            </p>
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
              {list.some(
                (i) =>
                  i.status === "done" &&
                  i.applied.some((a) => a.field === "visibility"),
              )
                ? `${uploadedIds.length} 枚を追加しました。`
                : `${uploadedIds.length} 枚は非公開で追加されました。`}
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
                <span class="min-w-0 flex-1" title={it.file || it.name}>
                  <span class="block truncate font-medium">{it.name}</span>
                  {/* Where it goes (a drop on a folder picks another one). */}
                  {it.file && (
                    <span
                      data-testid="upload-dest"
                      class={["block truncate text-xs", muted]}
                    >
                      {dirOf(it.file)} へ
                    </span>
                  )}
                </span>
                <span class={["shrink-0 text-xs tabular-nums", muted]}>
                  {formatUploadSize(it.size)}
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
              {it.applied.length > 0 && it.status !== "skipped" && (
                <ul
                  aria-label={`${it.name} にルールで付いたもの`}
                  data-testid="upload-applied"
                  class="flex flex-wrap gap-1"
                >
                  {it.applied.map((a) => (
                    <li
                      key={`${a.field}:${a.value}`}
                      data-field={a.field}
                      class={[tagChip, "max-w-full"]}
                    >
                      <span class="truncate">
                        <span class="font-medium">{a.value}</span>
                        <span class={muted}> ← {a.rule}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  },
);
