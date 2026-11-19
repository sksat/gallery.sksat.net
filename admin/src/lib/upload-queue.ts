// The upload queue behind the Files view's upload panel: plain TypeScript
// with every side effect injected (hashing, the admin API, the PUT to the
// bucket, sleeping), so the state machine is covered by Vitest
// (upload-queue.spec.ts) and the component only renders snapshots.
//
// Per file: queued → preparing (SHA-256, taken-at) → uploading (init, then
// the PUT with progress) → completing → done. Or skipped (not an image /
// already uploaded) or failed (with a reason; retry() queues it again).
// A failed PUT or complete is retried automatically with backoff, each
// time with a fresh init, which resumes the same `uploading` row and signs
// a new URL (so an expired URL is not a dead end).

import type { TakenAtSource } from "./metadata-source";
import type { FileHints, StoredMeta } from "./photo-meta";
import { checkUploadLimits, uploadTarget } from "./upload";
import type { AppliedChip } from "./upload-rules";

export type UploadStatus =
  | "queued"
  | "preparing"
  | "uploading"
  | "completing"
  | "done"
  | "skipped"
  | "failed";

/** What the panel renders for one file. */
export type UploadItem = {
  key: number;
  /** As picked (relative path for a folder upload). */
  name: string;
  /** Bucket path, or "" when it could not be built. */
  file: string;
  size: number;
  status: UploadStatus;
  /** Bytes sent by the current attempt. */
  loaded: number;
  /** Why it was skipped or failed. */
  message: string | null;
  /** The media row, once known. */
  mediaId: number | null;
  /** PUT/complete attempts so far (resets on retry()). */
  attempts: number;
  /** What the upload rules set on its row ("VRChat ← /VRChat/ フォルダ"). */
  applied: AppliedChip[];
};

/** A picked file (File, or a stand-in in tests). */
export type UploadSource = {
  name: string;
  /** "Folder/a.png" for a folder upload, else the name. */
  relativePath: string;
  size: number;
  type: string;
};

export type Prepared = {
  sha256: string;
  contentType: string;
  timestamp: string | null;
  /** Where `timestamp` came from (taken-at.ts). */
  timestampSource?: Exclude<TakenAtSource, "manual">;
  /** PHOTO_META_PARSER_DATE of the parser that read `meta`. */
  parserDate?: string;
  /** Metadata read from the file (photo-meta.ts), when there is any. */
  meta?: StoredMeta;
  /** From the header (image-size.ts); null when it could not be read. */
  width?: number | null;
  height?: number | null;
  /** What the upload rules look at besides `meta`. */
  hints?: FileHints;
};

export type InitResult =
  | {
      status: "upload";
      id: number;
      /** Where it goes (a numbered name if the path was taken). */
      file: string;
      url: string;
      headers: Record<string, string>;
      /** What the upload rules set (new rows only). */
      applied?: AppliedChip[];
    }
  /** The same photo (by SHA-256) is already uploaded, at `file`. */
  | { status: "exists"; id: number; file: string };

/** Thrown by the injected calls; `retryable` failures are tried again. */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export type QueueDeps<S extends UploadSource> = {
  /** Hash and inspect the file; may reject it (UploadError). */
  prepare(source: S): Promise<Prepared>;
  init(req: Prepared & { file: string; size: number }): Promise<InitResult>;
  put(
    init: Extract<InitResult, { status: "upload" }>,
    source: S,
    onProgress: (loaded: number) => void,
  ): Promise<void>;
  complete(id: number): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** Called with a fresh snapshot after every change. */
  onChange(items: UploadItem[]): void;
  /** Files uploaded at once. */
  concurrency?: number;
  /** Tries per file before it is marked failed. */
  maxAttempts?: number;
  /** Wait before try `attempt` (2, 3, ...). */
  backoffMs?: (attempt: number) => number;
};

export const DEFAULT_CONCURRENCY = 3;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const defaultBackoff = (attempt: number): number =>
  1000 * 2 ** (attempt - 2);

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const isRetryable = (err: unknown): boolean =>
  !(err instanceof UploadError) || err.retryable;

export type UploadQueue<S extends UploadSource> = {
  /** Queue files for the folder `dir`. */
  add(dir: string, sources: readonly S[]): void;
  /** Queue a failed file again. */
  retry(key: number): void;
  /** Queue every failed file again. */
  retryFailed(): void;
  /**
   * Drop every row that is not in flight (done, skipped and failed): a
   * failed upload is listed in its folder as incomplete instead.
   */
  clearFinished(): void;
  items(): UploadItem[];
};

export const createUploadQueue = <S extends UploadSource>(
  deps: QueueDeps<S>,
): UploadQueue<S> => {
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoff = deps.backoffMs ?? defaultBackoff;
  type Entry = {
    item: UploadItem;
    source: S;
    /** The path asked for (item.file becomes where it went). */
    target: string;
    /** The row whose file is in the bucket: a retry only completes it. */
    stored: number | null;
    /** Said when the server put it elsewhere (a numbered name, a resume). */
    note: string | null;
  };
  const entries: Entry[] = [];
  let nextKey = 1;
  let active = 0;
  /** The last prepare() started; the next one waits for it. */
  let preparing: Promise<unknown> = Promise.resolve();

  const snapshot = () => entries.map((e) => ({ ...e.item }));
  const changed = () => deps.onChange(snapshot());
  const set = (item: UploadItem, patch: Partial<UploadItem>) => {
    Object.assign(item, patch);
    changed();
  };

  /** Run `step` until it succeeds, retrying while allowed. */
  const withRetry = async <T>(
    item: UploadItem,
    step: () => Promise<T>,
  ): Promise<T> => {
    for (;;) {
      item.attempts++;
      try {
        return await step();
      } catch (err) {
        if (!isRetryable(err) || item.attempts >= maxAttempts) throw err;
        set(item, { message: `再試行します: ${errorMessage(err)}` });
        await deps.sleep(backoff(item.attempts + 1));
      }
    }
  };

  /** Mark the stored file ready (the complete call, retried on its own). */
  const complete = async (entry: Entry, id: number): Promise<void> => {
    const { item } = entry;
    set(item, {
      status: "completing",
      loaded: item.size,
      message: entry.note,
      attempts: 0,
    });
    try {
      await withRetry(item, () => deps.complete(id));
    } catch (err) {
      // Not in the bucket after all, the wrong file, or the row is gone:
      // the next try uploads again. Only a check that could not be made
      // (retryable) keeps the complete-only path.
      if (!isRetryable(err)) entry.stored = null;
      throw err;
    }
    set(item, { status: "done", message: entry.note });
  };

  const upload = async (entry: Entry): Promise<void> => {
    const { item, source, target: requested } = entry;
    // Already in the bucket (the complete failed): don't upload it again.
    if (entry.stored !== null) return complete(entry, entry.stored);
    set(item, { status: "preparing", loaded: 0, message: null });
    // One file at a time: hashing reads the whole file into memory.
    const turn = preparing.then(() => deps.prepare(source));
    preparing = turn.catch(() => {});
    let prepared: Prepared;
    try {
      prepared = await turn;
    } catch (err) {
      // Not uploadable as it is (e.g. a renamed HEIC): retrying won't help.
      if (isRetryable(err)) throw err;
      set(item, { status: "skipped", message: errorMessage(err) });
      return;
    }
    // The media id once the file is in the bucket, null when skipped.
    const id = await withRetry(item, async (): Promise<number | null> => {
      set(item, { status: "uploading", loaded: 0 });
      const init = await deps.init({
        file: requested,
        size: item.size,
        ...prepared,
      });
      if (init.status === "exists") {
        set(item, {
          status: "skipped",
          mediaId: init.id,
          message:
            init.file === requested
              ? "アップロード済みです"
              : `同じ写真が ${init.file} にあります`,
        });
        return null;
      }
      entry.note =
        init.file === requested ? null : `${init.file} として登録します`;
      set(item, {
        mediaId: init.id,
        file: init.file,
        message: entry.note,
        // A resumed row keeps what its first init reported.
        ...(init.applied ? { applied: init.applied } : {}),
      });
      await deps.put(init, source, (loaded) =>
        set(item, { loaded: Math.min(loaded, item.size) }),
      );
      return init.id;
    });
    if (id === null) return;
    entry.stored = id;
    await complete(entry, id);
  };

  const pump = () => {
    while (active < concurrency) {
      const next = entries.find((e) => e.item.status === "queued");
      if (!next) return;
      active++;
      // Marked before the first await so the loop does not pick it again.
      next.item.status = "preparing";
      upload(next)
        .catch((err) =>
          set(next.item, { status: "failed", message: errorMessage(err) }),
        )
        .finally(() => {
          active--;
          pump();
        });
    }
  };

  return {
    add(dir, sources) {
      for (const source of sources) {
        const target = uploadTarget(dir, source.relativePath || source.name);
        // Too large to upload: refused before anything is read or sent.
        const refused = target.ok
          ? checkUploadLimits({ size: source.size })
          : target.error;
        const item: UploadItem = {
          key: nextKey++,
          name: source.relativePath || source.name,
          file: target.ok ? target.file : "",
          size: source.size,
          status: refused === null ? "queued" : "skipped",
          loaded: 0,
          message: refused,
          mediaId: null,
          attempts: 0,
          applied: [],
        };
        entries.push({
          item,
          source,
          target: item.file,
          stored: null,
          note: null,
        });
      }
      changed();
      pump();
    },
    retry(key) {
      const e = entries.find((x) => x.item.key === key);
      if (!e || e.item.status !== "failed") return;
      Object.assign(e.item, { status: "queued", attempts: 0, message: null });
      changed();
      pump();
    },
    retryFailed() {
      for (const e of entries) {
        if (e.item.status === "failed") {
          Object.assign(e.item, {
            status: "queued",
            attempts: 0,
            message: null,
          });
        }
      }
      changed();
      pump();
    },
    clearFinished() {
      for (let i = entries.length - 1; i >= 0; i--) {
        const s = entries[i].item.status;
        if (s === "done" || s === "skipped" || s === "failed") {
          entries.splice(i, 1);
        }
      }
      changed();
    },
    items: snapshot,
  };
};

/** Totals for the panel's header and overall bar. */
export const summarize = (items: readonly UploadItem[]) => {
  let bytes = 0;
  let sent = 0;
  const count = {
    queued: 0,
    preparing: 0,
    uploading: 0,
    completing: 0,
    done: 0,
    skipped: 0,
    failed: 0,
  } satisfies Record<UploadStatus, number>;
  for (const it of items) {
    count[it.status]++;
    if (it.status === "skipped") continue;
    bytes += it.size;
    sent += it.status === "done" ? it.size : it.loaded;
  }
  const active =
    count.queued + count.preparing + count.uploading + count.completing;
  return {
    count,
    /** Files still in flight or waiting. */
    active,
    /** 0..1 over the files that are not skipped. */
    progress: bytes === 0 ? 0 : sent / bytes,
  };
};
