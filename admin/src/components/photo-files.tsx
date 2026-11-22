import { $, component$, useSignal, type QRL } from "@builder.io/qwik";
import type { PhotoFile } from "~/lib/db-retouch";
import { formatJst } from "~/lib/format";
import type { MediaPlatform } from "~/lib/types";
import { formatUploadSize, UPLOAD_ACCEPT } from "~/lib/upload";
import type { PickedFile } from "~/lib/upload-client";
import { summaryView } from "~/lib/xmp-summary";
import { Thumb } from "./thumb";
import { buttonSecondary, card, muted } from "./ui";
import { UploadPanel, type Uploader } from "./uploader";

// The edit page's ファイル: the photo's original and its retouched versions,
// which one the public site shows (a radio per file), adding one (a file
// picker, or a drop anywhere on the page) and removing one (to the trash).

const nameOf = (key: string) => key.slice(key.lastIndexOf("/") + 1);

type Props = {
  files: PhotoFile[];
  /** Edit uploads of the photo that never completed. */
  incomplete: { id: number; key: string; size: number | null }[];
  /** The photo's original key: the shown file's thumbnail is the photo's. */
  photoFile: string;
  platform: MediaPlatform;
  imageBase: string | null;
  uploader: Uploader;
  /** The photo's folder (where a new file goes). */
  dir: string;
  /** Uploads are configured. */
  canUpload: boolean;
  onShow$: QRL<(fileId: number) => Promise<unknown>>;
  onTrash$: QRL<(fileId: number) => Promise<unknown>>;
  onDeleteIncomplete$: QRL<(fileId: number) => Promise<unknown>>;
};

export const PhotoFiles = component$<Props>((props) => {
  const busy = useSignal<number | null>(null);
  const run = $(
    async (id: number, f: QRL<(id: number) => Promise<unknown>>) => {
      busy.value = id;
      try {
        await f(id);
      } finally {
        busy.value = null;
      }
    },
  );
  return (
    <section
      aria-labelledby="photo-files-title"
      data-testid="photo-files"
      class={[card, "space-y-4 p-4 sm:p-6"]}
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="photo-files-title" class="text-sm font-semibold">
          ファイル
        </h2>
        {props.canUpload && (
          <label
            class={[
              buttonSecondary,
              "cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-sky-500",
            ]}
          >
            レタッチ版を追加
            <input
              type="file"
              multiple
              accept={UPLOAD_ACCEPT}
              data-testid="edit-upload-input"
              class="sr-only"
              onChange$={(_, el) => {
                const picked = Array.from(el.files ?? []).map(
                  (f): PickedFile => ({
                    name: f.name,
                    relativePath: f.name,
                    size: f.size,
                    type: f.type,
                    blob: f,
                  }),
                );
                el.value = "";
                if (picked.length > 0)
                  void props.uploader.add(props.dir, picked);
              }}
            />
          </label>
        )}
      </div>
      <fieldset>
        <legend class="sr-only">公開サイトに表示するファイル</legend>
        <ul class="divide-y divide-zinc-100 dark:divide-zinc-800">
          {props.files.map((f) => {
            const view = summaryView(f.xmpSummary);
            const name = nameOf(f.key);
            return (
              <li
                key={f.id}
                data-testid="photo-file"
                data-shown={f.shown ? "" : undefined}
                class="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                <Thumb
                  file={f.shown ? props.photoFile : f.thumbKey}
                  exact={!f.shown}
                  platform={props.platform}
                  imageBase={props.imageBase}
                  variant="list"
                  class="w-28 rounded-md sm:w-36"
                />
                <div class="min-w-0 flex-1 space-y-1 text-sm">
                  <p class="font-medium break-all">{name}</p>
                  <p class={["text-xs", muted]}>
                    {[
                      f.role === "original" ? "元のファイル" : "レタッチ版",
                      f.creatorTool,
                      f.size !== null ? formatUploadSize(f.size) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    {f.addedAt && (
                      <>
                        {" · "}
                        <span data-testid="file-added" class="tabular-nums">
                          {formatJst(f.addedAt)}
                        </span>
                      </>
                    )}
                  </p>
                  {view && (
                    <details class="text-xs">
                      <summary class={["cursor-pointer", muted]}>
                        現像の記録
                      </summary>
                      {view.settings.length > 0 && (
                        <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
                          {view.settings.map(([k, v]) => (
                            <div key={k} class="contents">
                              <dt class={muted}>{k}</dt>
                              <dd class="tabular-nums">{v}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {view.moreSettings > 0 && (
                        <p class={muted}>ほか {view.moreSettings} 項目</p>
                      )}
                      {view.history.length > 0 && (
                        <ol class="mt-1 space-y-0.5">
                          {view.earlierSteps > 0 && (
                            <li class={muted}>… {view.earlierSteps} 件</li>
                          )}
                          {view.history.map((h, i) => (
                            <li key={i}>
                              {[h.when, h.action, h.agent]
                                .filter(Boolean)
                                .join(" ")}
                            </li>
                          ))}
                        </ol>
                      )}
                    </details>
                  )}
                </div>
                <div class="flex w-full items-center gap-2 sm:w-auto sm:flex-col sm:items-end">
                  <label class="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-0">
                    <input
                      type="radio"
                      name="shown-file"
                      checked={f.shown}
                      disabled={busy.value !== null}
                      aria-label={`${name} を公開サイトに表示`}
                      onChange$={() => run(f.id, props.onShow$)}
                      class="size-4 accent-sky-600"
                    />
                    公開サイトに表示
                  </label>
                  {f.role === "edit" && !f.shown && (
                    <button
                      type="button"
                      disabled={busy.value !== null}
                      aria-label={`${name} をゴミ箱へ`}
                      onClick$={() => run(f.id, props.onTrash$)}
                      class="ml-auto h-11 rounded-lg px-2 text-sm font-medium text-red-700 disabled:opacity-60 sm:ml-0 sm:h-auto dark:text-red-400"
                    >
                      ゴミ箱へ
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </fieldset>
      {props.incomplete.length > 0 && (
        <ul
          aria-label="未完了のアップロード"
          class="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {props.incomplete.map((u) => (
            <li
              key={u.id}
              data-testid="incomplete-edit"
              class="flex items-center gap-3"
            >
              <span class="min-w-0 flex-1 truncate">{nameOf(u.key)}</span>
              {u.size !== null && (
                <span class="shrink-0 text-xs tabular-nums">
                  {formatUploadSize(u.size)}
                </span>
              )}
              <span class="shrink-0 text-xs">未完了</span>
              <button
                type="button"
                disabled={busy.value !== null}
                aria-label={`${nameOf(u.key)} の未完了のアップロードを削除`}
                onClick$={() => run(u.id, props.onDeleteIncomplete$)}
                class="h-11 shrink-0 rounded-lg px-2 font-medium text-red-700 disabled:opacity-60 sm:h-auto dark:text-red-400"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
      <UploadPanel uploader={props.uploader} />
    </section>
  );
});
