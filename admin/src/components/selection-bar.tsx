import {
  $,
  component$,
  useSignal,
  useVisibleTask$,
  type QRL,
  type Signal,
} from "@builder.io/qwik";
import type { InfoEdit } from "~/lib/bulk-info";
import type { LevelChange } from "~/lib/bulk-metadata";
import { isWithin, type FolderNode } from "~/lib/folders";
import type { MetadataLevels } from "~/lib/metadata";
import { exposing, previewOf } from "~/lib/review-pending";
import type { CameraChoice } from "~/lib/db-photo-bulk";
import {
  sharedCamera,
  sharedPlatform,
  sharedVisibility,
  visibilityPending,
} from "~/lib/selection";
import { formatDecimalBytes } from "~/lib/storage";
import {
  isPlatform,
  PLATFORMS,
  VISIBILITIES,
  type MediaPlatform,
  type Visibility,
} from "~/lib/types";
import { BulkInfoDialog } from "./bulk-info-dialog";
import { BulkMetadataDialog } from "./bulk-metadata-dialog";
import { ChoicePicker } from "./choice-picker";
import { ContextMenu } from "./context-menu";
import type { FileTile } from "./file-browser";
import { Thumb } from "./thumb";
import { buttonPrimary, buttonSecondary, field, label, muted } from "./ui";
import {
  VISIBILITY_LABELS_JA,
  VISIBILITY_STYLE,
  VisibilityIcon,
} from "./visibility-style";

// What can be done with the Files view's selection: 移動 (a folder picker
// in a dialog, optionally into a new folder there), the visibility of the
// selected photos (one button per level, in its own look; making photos
// public or unlisted first shows them as thumbnails, as the viewer's 反映
// does), 情報 (a menu: カメラ and プラットフォーム in choice-picker.tsx,
// タグと撮影データ in bulk-info-dialog.tsx, 公開する情報 in
// bulk-metadata-dialog.tsx), ゴミ箱へ, and clearing it.
// Every change can be undone from the page's toast. A bar fixed at the
// bottom on phones (replacing the tab bar, data-bottom-bar), sticky above
// the grid from sm up.

export type SelectionAction =
  | { kind: "move"; dest: string; name: string }
  | { kind: "visibility"; visibility: Visibility }
  | { kind: "metadata"; levels: LevelChange }
  | { kind: "rename"; name: string }
  | { kind: "camera"; cameraId: number | null; cameraName: string | null }
  | { kind: "platform"; platform: MediaPlatform }
  | { kind: "info"; edit: InfoEdit }
  | { kind: "trash" }
  | { kind: "clear" };

/** Asked of the bar from elsewhere (the context menu). */
export type BarCommand =
  | { kind: "move" }
  | { kind: "metadata" }
  | { kind: "info" }
  | { kind: "camera" }
  | { kind: "platform" }
  | { kind: "visibility"; visibility: Visibility };

type Props = {
  count: number;
  /** The selected photos (folders' contents not included). */
  photos: FileTile[];
  bytes: number;
  /** Folders being moved: they and their insides are not destinations. */
  folders: string[];
  /** The open folder (moving there does nothing). */
  dir: string;
  tree: FolderNode;
  imageBase: string | null;
  siteDefaults: MetadataLevels;
  /** Registered cameras (the camera picker). */
  cameras: CameraChoice[];
  /** A chunked action under way: photos done of total. */
  progress: { done: number; total: number } | null;
  busy: Signal<boolean>;
  /** Set to open the move dialog, the metadata sheet or a visibility. */
  command: Signal<BarCommand | null>;
  /** Rename the one selected item. */
  onRename$: QRL<() => void>;
  /** Resolves true when the action went through. */
  onAction$: QRL<(a: SelectionAction) => Promise<boolean>>;
};

const flatten = (node: FolderNode, depth = 0): [FolderNode, number][] => [
  [node, depth],
  ...node.children.flatMap((c) => flatten(c, depth + 1)),
];

const Icon = ({ d, class: cls = "size-4" }: { d: string; class?: string }) => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    class={["shrink-0", cls]}
  >
    <path fill-rule="evenodd" clip-rule="evenodd" d={d} />
  </svg>
);

/** Pencil (名前を変更). */
const RENAME_ICON =
  "M13.59 3.59a2 2 0 0 1 2.82 2.82l-8.5 8.5a1 1 0 0 1-.46.26l-3.2.8a.5.5 0 0 1-.6-.6l.8-3.2a1 1 0 0 1 .26-.46l8.88-8.12Z";
/** Folder with an arrow (移動). */
const MOVE_ICON =
  "M2 5.5A1.5 1.5 0 0 1 3.5 4h4.09a1.5 1.5 0 0 1 1.06.44L9.7 5.5h6.8A1.5 1.5 0 0 1 18 7v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 15.5v-10Zm8.47 3.22a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1 0 1.06l-2 2a.75.75 0 1 1-1.06-1.06l.72-.72H7a.75.75 0 0 1 0-1.5h4.19l-.72-.72a.75.75 0 0 1 0-1.06Z";
/** The camera picker's key for a shared camera ("none" for none). */
const keyOf = (c: number | null | undefined): string | undefined =>
  c === undefined ? undefined : c === null ? "none" : String(c);

/** Sliders (情報: camera, platform, what is public). */
const INFO_ICON =
  "M3.75 5a.75.75 0 0 0 0 1.5h1.4a2.5 2.5 0 0 0 4.7 0h6.4a.75.75 0 0 0 0-1.5h-6.4a2.5 2.5 0 0 0-4.7 0h-1.4Zm0 8.5a.75.75 0 0 0 0 1.5h6.4a2.5 2.5 0 0 0 4.7 0h1.4a.75.75 0 0 0 0-1.5h-1.4a2.5 2.5 0 0 0-4.7 0h-6.4ZM7.5 6.75a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm5 8.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z";
/** Bin (ゴミ箱へ). */
const TRASH_ICON =
  "M8.75 2.5A1.75 1.75 0 0 0 7 4.25V5H4a.75.75 0 0 0 0 1.5h.3l.8 9.6A2 2 0 0 0 7.1 18h5.8a2 2 0 0 0 2-1.9l.8-9.6h.3a.75.75 0 0 0 0-1.5h-3v-.75A1.75 1.75 0 0 0 11.25 2.5h-2.5ZM11.5 5v-.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25V5h3Z";
/** ✕ (選択解除). */
const CLEAR_ICON =
  "M5.22 5.22a.75.75 0 0 1 1.06 0L10 8.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L11.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 0 1 0-1.06Z";

export const SelectionBar = component$<Props>(
  ({
    count,
    photos,
    bytes,
    folders,
    dir,
    tree,
    imageBase,
    siteDefaults,
    cameras,
    progress,
    busy,
    command,
    onRename$,
    onAction$,
  }) => {
    const dialog = useSignal<HTMLDialogElement>();
    const metadataOpen = useSignal(false);
    const infoOpen = useSignal(false);
    /** The 情報 menu (at its button), and the picker it opened. */
    const infoMenu = useSignal<{
      x: number;
      y: number;
      above: number;
    } | null>(null);
    const picker = useSignal<"camera" | "platform" | null>(null);
    const dest = useSignal(dir);
    /** A level waiting for a look at what becomes visible. */
    const confirming = useSignal<Visibility | null>(null);

    const destinations = flatten(tree).filter(
      ([node]) => !folders.some((f) => isWithin(node.path, f)),
    );
    const current = sharedVisibility(photos);
    const visible = confirming.value
      ? exposing(visibilityPending(photos, confirming.value))
      : [];
    const preview = previewOf(visible);

    const submitMove = $(async (form: HTMLFormElement) => {
      const data = new FormData(form);
      // Kept open on a failure (the toast says why), with what was typed.
      const ok = await onAction$({
        kind: "move",
        dest: String(data.get("dest") ?? "/"),
        name: String(data.get("name") ?? ""),
      });
      if (ok) dialog.value?.close();
    });
    const pickVisibility = $(async (v: Visibility) => {
      const pending = visibilityPending(photos, v);
      if (Object.keys(pending).length === 0) return;
      if (exposing(pending).length > 0 && confirming.value !== v) {
        confirming.value = v;
        return;
      }
      confirming.value = null;
      await onAction$({ kind: "visibility", visibility: v });
    });
    const openMove = $(() => {
      dest.value = dir;
      dialog.value?.showModal();
    });
    // From the context menu. After render: the bar may have just appeared
    // (a right click selects first), and its dialog with it.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(async ({ track }) => {
      const c = track(() => command.value);
      if (!c) return;
      command.value = null;
      if (c.kind === "move") await openMove();
      else if (c.kind === "metadata") metadataOpen.value = true;
      else if (c.kind === "info") infoOpen.value = true;
      else if (c.kind === "camera" || c.kind === "platform") {
        picker.value = c.kind;
      } else await pickVisibility(c.visibility);
    });

    const action =
      "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:h-9";
    // Phones: icon over a short label, as in a bottom toolbar.
    const tool = `${action} max-sm:h-12 max-sm:flex-col max-sm:gap-0.5 max-sm:px-0.5 max-sm:text-[0.6875rem]`;
    const quiet = `${action} text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800`;
    const quietTool = `${tool} text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800`;

    return (
      <div
        data-bottom-bar
        role="region"
        aria-label="選択した項目"
        data-testid="selection-bar"
        class={[
          // Phones: the count, then (one item) rename and ×.
          count === 1 ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]",
          "z-30 grid items-center gap-2 border-zinc-200 bg-white/95 backdrop-blur sm:flex sm:flex-wrap sm:gap-1 dark:border-zinc-800 dark:bg-zinc-900/95",
          "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:border-t max-sm:pt-2 max-sm:pr-[max(1rem,env(safe-area-inset-right))] max-sm:pb-[calc(0.5rem+env(safe-area-inset-bottom))] max-sm:pl-[max(1rem,env(safe-area-inset-left))] max-sm:shadow-[0_-4px_12px_rgb(0_0_0/0.06)]",
          // After the grid, held at the viewport's bottom while it scrolls.
          "sm:sticky sm:bottom-4 sm:rounded-xl sm:border sm:p-2 sm:shadow-lg",
        ]}
      >
        {/* (Gone if the selection changed and nothing would show.) */}
        {confirming.value && visible.length > 0 && (
          // The photos that would become visible to others, before they do.
          <div
            data-testid="visibility-confirm"
            role="group"
            aria-label={`${VISIBILITY_LABELS_JA[confirming.value]}にする写真`}
            class="col-span-full flex w-full min-w-0 flex-wrap items-end gap-2 border-b border-zinc-200 pb-2 sm:flex-nowrap dark:border-zinc-800"
          >
            {/* Rows that scroll within a height of their own, so the
                buttons stay on screen; past PREVIEW_MAX a "+N". */}
            <ul class="flex max-h-[min(7.5rem,25dvh)] min-w-0 flex-1 basis-full flex-wrap content-start gap-1.5 overflow-y-auto overscroll-contain sm:basis-0">
              {preview.shown.map(([id, item]) => (
                <li key={id} class="relative shrink-0">
                  <Thumb
                    file={item.file}
                    platform={null}
                    imageBase={imageBase}
                    variant="list"
                    class="h-12 rounded-md"
                  />
                  <span
                    class={[
                      "absolute right-0.5 bottom-0.5 rounded-full p-0.5 ring-1 ring-inset",
                      VISIBILITY_STYLE[item.to].badge,
                    ]}
                  >
                    <VisibilityIcon visibility={item.to} class="size-3" />
                  </span>
                </li>
              ))}
              {preview.more > 0 && (
                <li
                  data-testid="visibility-confirm-more"
                  class="flex h-12 items-center rounded-md bg-zinc-100 px-3 text-sm font-semibold tabular-nums dark:bg-zinc-800"
                >
                  <span class="sr-only">ほか </span>+{preview.more}
                  <span class="sr-only"> 枚</span>
                </li>
              )}
            </ul>
            <span class="flex shrink-0 gap-2 max-sm:w-full">
              <button
                type="button"
                onClick$={() => (confirming.value = null)}
                class={[buttonSecondary, "max-sm:flex-1"]}
              >
                戻る
              </button>
              <button
                type="button"
                disabled={busy.value}
                onClick$={() => pickVisibility(confirming.value!)}
                class={[
                  "inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold shadow-sm ring-2 ring-inset disabled:opacity-60 max-sm:flex-1 sm:h-10",
                  VISIBILITY_STYLE[confirming.value].selected,
                ]}
              >
                <VisibilityIcon visibility={confirming.value} />
                {visible.length} 枚を{VISIBILITY_LABELS_JA[confirming.value]}
              </button>
            </span>
          </div>
        )}
        <p
          class="text-sm font-semibold tabular-nums sm:mr-auto"
          data-testid="selection-summary"
          aria-live="polite"
        >
          {count} 件選択
          <span class={["ml-2 font-normal", muted]}>
            {formatDecimalBytes(bytes)}
          </span>
          {progress && (
            // A large selection goes in chunks: how far it got.
            <span
              data-testid="selection-progress"
              class="ml-3 inline-flex items-center gap-2 font-normal"
            >
              <progress
                max={progress.total}
                value={progress.done}
                class="h-1.5 w-20 overflow-hidden rounded-full accent-sky-600"
              />
              <span class={muted}>
                {progress.done} / {progress.total}
              </span>
            </span>
          )}
        </p>
        {count === 1 && (
          // Touch screens (no menu there: a long press selects); with a mouse,
          // F2 or the context menu.
          <button
            type="button"
            disabled={busy.value}
            aria-label="名前を変更"
            onClick$={onRename$}
            class={[quiet, "[@media(hover:hover)_and_(pointer:fine)]:hidden"]}
          >
            <Icon d={RENAME_ICON} class="size-5" />
          </button>
        )}
        <button
          type="button"
          aria-label="選択解除"
          title="選択解除 (Esc)"
          onClick$={() => onAction$({ kind: "clear" })}
          class={[
            quiet,
            // From sm: a round × on the bar's corner, out of the row.
            "sm:absolute sm:-top-3 sm:-right-3 sm:size-8 sm:min-w-0 sm:rounded-full sm:border sm:border-zinc-200 sm:bg-white sm:p-0 sm:shadow dark:sm:border-zinc-700 dark:sm:bg-zinc-900",
          ]}
        >
          <Icon d={CLEAR_ICON} class="size-5" />
        </button>
        <div
          role="group"
          aria-label="公開範囲"
          class="col-span-full grid grid-cols-3 gap-0.5 rounded-lg border border-zinc-300 p-0.5 sm:flex dark:border-zinc-700"
        >
          {[...VISIBILITIES].reverse().map((v) => (
            <button
              key={v}
              type="button"
              disabled={busy.value || photos.length === 0}
              aria-pressed={current === v}
              onClick$={() => pickVisibility(v)}
              class={[
                "inline-flex h-11 items-center justify-center gap-1 rounded-md px-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:px-1.5",
                current === v || confirming.value === v
                  ? [VISIBILITY_STYLE[v].selected, "ring-2 ring-inset"]
                  : [
                      VISIBILITY_STYLE[v].accent,
                      "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                    ],
              ]}
            >
              <VisibilityIcon visibility={v} />
              {VISIBILITY_LABELS_JA[v]}
            </button>
          ))}
        </div>
        <div class="col-span-full grid grid-cols-3 gap-1 sm:contents">
          <button
            type="button"
            disabled={busy.value}
            onClick$={openMove}
            class={quietTool}
          >
            <Icon d={MOVE_ICON} />
            移動…
          </button>
          <button
            type="button"
            disabled={busy.value || photos.length === 0}
            aria-haspopup="menu"
            aria-expanded={infoMenu.value !== null}
            // The photos' information: camera, platform, what is public.
            onClick$={(_, el) => {
              const r = el.getBoundingClientRect();
              infoMenu.value = { x: r.left, y: r.bottom + 4, above: r.top };
            }}
            class={quietTool}
          >
            <Icon d={INFO_ICON} />
            情報…
          </button>
          <button
            type="button"
            disabled={busy.value}
            title="ゴミ箱へ (Delete)"
            onClick$={() => onAction$({ kind: "trash" })}
            class={[
              tool,
              "text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40",
            ]}
          >
            <Icon d={TRASH_ICON} />
            ゴミ箱へ
          </button>
        </div>

        {infoMenu.value && (
          <ContextMenu
            x={infoMenu.value.x}
            y={infoMenu.value.y}
            above={infoMenu.value.above}
            label="情報"
            items={[
              { kind: "item", id: "camera", label: "カメラ…" },
              { kind: "item", id: "platform", label: "プラットフォーム…" },
              { kind: "item", id: "info", label: "タグと撮影データ…" },
              { kind: "item", id: "metadata", label: "公開する情報…" },
            ]}
            onClose$={() => (infoMenu.value = null)}
            onPick$={(id) => {
              if (id === "metadata") metadataOpen.value = true;
              else if (id === "info") infoOpen.value = true;
              else picker.value = id as "camera" | "platform";
            }}
          />
        )}
        {picker.value === "camera" && (
          <ChoicePicker
            title="カメラ"
            testId="camera-picker"
            choices={[
              { key: "none", label: "なし", image: "none" },
              ...cameras.map((c) => ({
                key: String(c.id),
                label: c.name,
                image: c.image,
              })),
            ]}
            shared={keyOf(sharedCamera(photos))}
            count={photos.length}
            imageBase={imageBase}
            busy={busy}
            onClose$={() => (picker.value = null)}
            onPick$={async (key) => {
              const cam = cameras.find((c) => String(c.id) === key);
              const ok = await onAction$({
                kind: "camera",
                cameraId: cam?.id ?? null,
                cameraName: cam?.name ?? null,
              });
              if (ok) picker.value = null;
            }}
          />
        )}
        {picker.value === "platform" && (
          <ChoicePicker
            title="プラットフォーム"
            testId="platform-picker"
            choices={PLATFORMS.map((p) => ({
              key: p,
              label: p,
              image: "badge",
            }))}
            shared={sharedPlatform(photos)}
            count={photos.length}
            imageBase={imageBase}
            busy={busy}
            onClose$={() => (picker.value = null)}
            onPick$={async (key) => {
              if (!isPlatform(key)) return;
              const ok = await onAction$({ kind: "platform", platform: key });
              if (ok) picker.value = null;
            }}
          />
        )}
        {infoOpen.value && (
          <BulkInfoDialog
            ids={photos.map((p) => p.id)}
            platforms={photos.map((p) => p.platform)}
            busy={busy}
            onClose$={() => (infoOpen.value = false)}
            onApply$={async (edit) => {
              if (await onAction$({ kind: "info", edit })) {
                infoOpen.value = false;
              }
            }}
          />
        )}
        {metadataOpen.value && (
          <BulkMetadataDialog
            photos={photos}
            siteDefaults={siteDefaults}
            busy={busy}
            onClose$={() => (metadataOpen.value = false)}
            onApply$={async (levels) => {
              if (await onAction$({ kind: "metadata", levels })) {
                metadataOpen.value = false;
              }
            }}
          />
        )}

        <dialog
          ref={dialog}
          aria-labelledby="move-title"
          class="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <form
            preventdefault:submit
            onSubmit$={(_, form) => submitMove(form)}
            class="space-y-4 p-4"
          >
            <h2 id="move-title" class="text-base font-semibold">
              {count} 件を移動
            </h2>
            <fieldset>
              <legend class={label}>移動先</legend>
              <ul
                class="max-h-72 space-y-0.5 overflow-y-auto rounded-lg border border-zinc-200 p-1 dark:border-zinc-800"
                data-testid="move-destinations"
              >
                {destinations.map(([node, depth]) => (
                  <li key={node.path}>
                    <label
                      class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm has-checked:bg-sky-100 sm:min-h-9 dark:has-checked:bg-sky-950"
                      style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
                    >
                      <input
                        type="radio"
                        name="dest"
                        value={node.path}
                        checked={dest.value === node.path}
                        onChange$={() => (dest.value = node.path)}
                      />
                      <span class="truncate">{node.name || "All files"}</span>
                      {node.path === dir && (
                        <span class={["text-xs", muted]}>(いまの場所)</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            <div>
              <label for="move-new-folder" class={label}>
                その中に新しいフォルダを作る (任意)
              </label>
              <input
                id="move-new-folder"
                name="name"
                maxLength={64}
                pattern={"\\s*[A-Za-z0-9_\\-][A-Za-z0-9._\\-]*\\s*"}
                title="英数字と . _ - (先頭に . は不可)"
                autoCapitalize="off"
                autoCorrect="off"
                spellcheck={false}
                class={field}
              />
            </div>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                onClick$={() => dialog.value?.close()}
                class={buttonSecondary}
              >
                やめる
              </button>
              <button type="submit" disabled={busy.value} class={buttonPrimary}>
                {busy.value ? "移動中…" : "ここへ移動"}
              </button>
            </div>
          </form>
        </dialog>
      </div>
    );
  },
);
