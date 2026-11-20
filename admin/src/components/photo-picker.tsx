import {
  $,
  component$,
  useSignal,
  useTask$,
  useVisibleTask$,
  type QRL,
} from "@builder.io/qwik";
import { server$ } from "@builder.io/qwik-city";
import { listPickerPhotos, type PickerPhoto } from "~/lib/db";
import { getDB } from "~/lib/env";
import { formatJst } from "~/lib/format";
import { MAX_IMAGE_FILE_LEN } from "~/lib/validate";
import { isVisibility } from "~/lib/types";
import { Spinner } from "./submit-button";
import { Thumb } from "./thumb";
import { buttonPrimary, buttonSecondary, card, field, muted } from "./ui";
import { VisibilityBadge } from "./visibility-badge";

// The camera page's 写真から選ぶ: photos of the library to add as the
// camera's pictures. It opens on the photos taken with the camera (the
// page has them already: no request), and すべての写真 pages through the
// library by folder (`loadPage`, a range of the path index). Only public
// and unlisted photos can be picked: the public site shows a picture only
// while its photo may be opened, so a private one would be a picture
// nobody sees. Photos that are pictures already show as added.

type Props = {
  /** The camera's own photos, newest first. */
  cameraPhotos: PickerPhoto[];
  /** Photos that are pictures of the camera already. */
  added: number[];
  imageBase: string | null;
  /** Adds the photos; true when it went through (the picker then closes). */
  onAdd$: QRL<(ids: number[]) => Promise<boolean>>;
  onClose$: QRL<() => void>;
};

/**
 * One page of the library under `dir`, after the path `after`. A server$
 * (not an action, after which every loader of the page would run again).
 */
const loadPage = server$(async function (dir: unknown, after: unknown) {
  if (
    typeof dir !== "string" ||
    !dir.startsWith("/") ||
    dir.length > MAX_IMAGE_FILE_LEN ||
    typeof after !== "string" ||
    after.length > MAX_IMAGE_FILE_LEN + 50
  ) {
    throw new Error("invalid folder");
  }
  return listPickerPhotos(getDB(this.platform), dir, after);
});

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** "/a/b/" from what was typed ("a/b", "/a/b", ""): "/" for everything. */
const folderOf = (typed: string) => {
  const t = typed.trim().replace(/^\/+|\/+$/g, "");
  return t === "" ? "/" : `/${t}/`;
};

const pickable = (p: PickerPhoto) =>
  p.visibility === "public" || p.visibility === "unlisted";

export const PhotoPicker = component$<Props>(
  ({ cameraPhotos, added, imageBase, onAdd$, onClose$ }) => {
    const ref = useSignal<HTMLDialogElement>();
    useVisibleTask$(() => {
      ref.value?.showModal();
    });
    const scope = useSignal<"camera" | "all">(
      cameraPhotos.length > 0 ? "camera" : "all",
    );
    const folder = useSignal("");
    const picked = useSignal<number[]>([]);
    const adding = useSignal(false);
    /** すべての写真: the pages loaded so far. */
    const library = useSignal<PickerPhoto[]>([]);
    const more = useSignal(false);
    const loading = useSignal(false);
    const failed = useSignal(false);

    const load = $(async (reset: boolean) => {
      loading.value = true;
      failed.value = false;
      const dir = folderOf(folder.value);
      const after = reset ? "" : (library.value.at(-1)?.path ?? "");
      const page = await loadPage(dir, after).catch(() => null);
      loading.value = false;
      // Typed on meanwhile: a newer load will answer.
      if (folderOf(folder.value) !== dir) return;
      if (!page) {
        failed.value = true;
        return;
      }
      library.value = reset ? page.photos : [...library.value, ...page.photos];
      more.value = page.more;
    });

    // すべての写真: the first page, again shortly after the folder changes.
    const loadedDir = useSignal<string | null>(null);
    useTask$(({ track, cleanup }) => {
      const dir = folderOf(track(() => folder.value));
      if (track(() => scope.value) !== "all" || loadedDir.value === dir) {
        return;
      }
      const t = setTimeout(
        () => {
          loadedDir.value = dir;
          void load(true);
        },
        loadedDir.value === null ? 0 : 300,
      );
      cleanup(() => clearTimeout(t));
    });

    const addedSet = new Set(added);
    const pickedSet = new Set(picked.value);
    const dir = folderOf(folder.value);
    const shown =
      scope.value === "camera"
        ? cameraPhotos.filter((p) => dir === "/" || p.path.startsWith(dir))
        : library.value;
    const titleId = "photo-picker-title";

    return (
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClose$={onClose$}
        onClick$={(ev, el) => {
          if (ev.target === el) el.close();
        }}
        class={[
          "m-auto w-[min(56rem,calc(100vw-2rem))] max-w-none bg-transparent p-0 text-inherit backdrop:bg-black/40",
          "max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:m-0 max-sm:max-h-[90dvh] max-sm:w-full",
        ]}
      >
        <div
          data-testid="photo-picker"
          class={[
            card,
            "flex max-h-[85dvh] flex-col gap-3 p-4 max-sm:max-h-[90dvh] max-sm:rounded-b-none max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]",
          ]}
        >
          <h2
            id={titleId}
            tabIndex={-1}
            autofocus
            class="text-base font-semibold outline-none"
          >
            写真から選ぶ
          </h2>
          <div class="flex flex-wrap items-center gap-2">
            <div
              role="radiogroup"
              aria-label="どの写真から"
              class="inline-flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700"
            >
              {(
                [
                  ["camera", `このカメラ (${cameraPhotos.length})`],
                  ["all", "すべての写真"],
                ] as const
              ).map(([key, text]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={scope.value === key}
                  onClick$={() => (scope.value = key)}
                  class={[
                    "h-10 rounded-md px-3 text-sm font-medium sm:h-9",
                    scope.value === key
                      ? "bg-sky-600 text-white"
                      : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                  ]}
                >
                  {text}
                </button>
              ))}
            </div>
            <form preventdefault:submit class="min-w-48 flex-1">
              <label for="photo-picker-folder" class="sr-only">
                フォルダ
              </label>
              <input
                id="photo-picker-folder"
                type="search"
                placeholder="フォルダ（例: /VRChat/2026-11）"
                value={folder.value}
                autoCapitalize="off"
                autoCorrect="off"
                spellcheck={false}
                enterKeyHint="search"
                onInput$={(_, el) => (folder.value = el.value)}
                class={field}
              />
            </form>
          </div>
          {shown.some((p) => !pickable(p)) && (
            <p class={["text-xs", muted]}>非公開の写真は選べません</p>
          )}

          <div class="-mx-1 min-h-40 flex-1 overflow-y-auto px-1">
            {shown.length === 0 ? (
              <p class={["py-8 text-center text-sm", muted]}>
                {loading.value
                  ? "読み込み中…"
                  : failed.value
                    ? "読み込めませんでした"
                    : "写真がありません"}
              </p>
            ) : (
              <ul class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {shown.map((p) => {
                  const isAdded = addedSet.has(p.id);
                  const can = pickable(p) && !isAdded;
                  const on = isAdded || pickedSet.has(p.id);
                  return (
                    <li
                      key={p.id}
                      data-testid="picker-photo"
                      class={[
                        "relative overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800",
                        on && can && "ring-2 ring-sky-500",
                        !can && "opacity-60",
                      ]}
                    >
                      <label
                        class={[
                          "block",
                          can ? "cursor-pointer" : "cursor-not-allowed",
                        ]}
                        title={p.path}
                      >
                        <span class="relative block">
                          <Thumb
                            file={p.file}
                            platform={p.platform}
                            imageBase={imageBase}
                            variant="list"
                            class="w-full"
                          />
                          {isVisibility(p.visibility) && (
                            <VisibilityBadge
                              visibility={p.visibility}
                              compact
                              class="absolute top-1.5 left-1.5 shadow-sm"
                            />
                          )}
                          <span class="absolute top-0 right-0 flex size-11 items-center justify-center sm:size-9">
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={!can}
                              aria-label={`${nameOf(p.path)} を選ぶ`}
                              onChange$={(_, el) => {
                                picked.value = el.checked
                                  ? [...picked.value, p.id]
                                  : picked.value.filter((id) => id !== p.id);
                              }}
                              class="size-5 accent-sky-600"
                            />
                          </span>
                        </span>
                        <span class="block truncate px-2 pt-1 text-xs font-medium">
                          {nameOf(p.path)}
                        </span>
                        <span
                          class={[
                            "block truncate px-2 pb-1 text-xs tabular-nums",
                            muted,
                          ]}
                        >
                          {isAdded
                            ? "追加済み"
                            : (formatJst(p.timestamp) ?? "—")}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {scope.value === "all" && more.value && (
              <div class="mt-3 flex justify-center">
                <button
                  type="button"
                  disabled={loading.value}
                  onClick$={() => load(false)}
                  class={buttonSecondary}
                >
                  {loading.value ? <Spinner /> : "もっと見る"}
                </button>
              </div>
            )}
          </div>

          <div class="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <button
              type="button"
              onClick$={() => ref.value?.close()}
              class={buttonSecondary}
            >
              キャンセル
            </button>
            <button
              type="button"
              disabled={picked.value.length === 0 || adding.value}
              onClick$={async () => {
                adding.value = true;
                const ok = await onAdd$(picked.value);
                adding.value = false;
                if (ok) ref.value?.close();
              }}
              class={buttonPrimary}
            >
              {adding.value ? <Spinner /> : null}
              {picked.value.length > 0
                ? `${picked.value.length} 枚を追加`
                : "追加"}
            </button>
          </div>
        </div>
      </dialog>
    );
  },
);
