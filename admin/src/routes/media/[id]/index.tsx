import { component$, useSignal, useTask$ } from "@builder.io/qwik";
import {
  Form,
  Link,
  routeAction$,
  routeLoader$,
  useLocation,
  usePreventNavigate$,
  zod$,
  z,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { MissingBindingError } from "~/components/missing-binding-error";
import { StatePanel } from "~/components/state-panel";
import { SubmitButton } from "~/components/submit-button";
import { Toast, type ToastState } from "~/components/toast";
import {
  backLink,
  buttonPrimary,
  card,
  field,
  label,
  link,
  muted,
  VISIBILITY_LABELS,
  visibilityBadge,
  worldBadge,
} from "~/components/ui";
import {
  getCamera,
  getMedia,
  listCameras,
  MAX_BULK_IDS,
  updateMedia,
} from "~/lib/db";
import { Thumb } from "~/components/thumb";
import { getDB, getImageBase } from "~/lib/env";
import { imageUrl, PREVIEW_CANDIDATES, srcSet } from "~/lib/images";
import {
  formatJst,
  publicPhotoUrl,
  safeBackHref,
  splitPath,
} from "~/lib/format";
import { getNeighbors, parseListHref, type Neighbors } from "~/lib/neighbors";
import { VISIBILITIES, type MediaRow, type Visibility } from "~/lib/types";
import {
  parseCameraIdInput,
  parseTagsInput,
  validatePatch,
} from "~/lib/validate";

type CameraOption = { id: number; name: string; slug: string };

type MediaLoaderResult =
  | {
      kind: "ok";
      row: MediaRow;
      /** Previous / next in the list it was opened from; null if not in it. */
      neighbors: Neighbors | null;
      /** Options for the camera <select>, sorted by name. */
      cameras: CameraOption[];
      imageBase: string | null;
    }
  | { kind: "missing-binding" }
  | { kind: "bad-request" }
  | { kind: "not-found" };

export const useMedia = routeLoader$<MediaLoaderResult>(
  async ({ platform, params, query, status }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      status(400);
      return { kind: "bad-request" };
    }
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      // pnpm dev (vite-only) has no D1 binding. Render a generic message in
      // the UI; the verbose error stays in the worker logs only.
      console.error("/media/[id] loader: getDB failed:", err);
      status(500);
      return { kind: "missing-binding" };
    }
    // Step through the list this page was opened from (the whole list by
    // date without ?back=). The list pages by MAX_BULK_IDS.
    const list = parseListHref(safeBackHref(query.get("back")));
    const [row, cameras, neighbors] = await Promise.all([
      getMedia(db, id),
      listCameras(db),
      getNeighbors(db, list, id, MAX_BULK_IDS),
    ]);
    if (!row) {
      status(404);
      return { kind: "not-found" };
    }
    return {
      kind: "ok",
      row,
      neighbors,
      cameras: cameras.map(({ id, name, slug }) => ({ id, name, slug })),
      imageBase: getImageBase(platform),
    };
  },
);

export const useUpdateMedia = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return fail(400, { message: "invalid id" });
    }
    // Route the form data through the same validator the API uses so the
    // contract has a single source of truth. A malformed camera value
    // (undefined here) is passed through as-is for validatePatch to reject.
    const v = validatePatch({
      world: data.world,
      camera_id: parseCameraIdInput(data.camera_id),
      tags: parseTagsInput(data.tags ?? ""),
      visibility: data.visibility,
    });
    if (!v.ok) {
      return fail(400, { message: v.error });
    }
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/media/[id] action: getDB failed:", err);
      return fail(500, { message: "D1 binding unavailable" });
    }
    if (
      v.patch.camera_id != null &&
      !(await getCamera(db, v.patch.camera_id))
    ) {
      return fail(400, { message: "unknown camera" });
    }
    const updated = await updateMedia(db, id, v.patch);
    if (!updated) {
      return fail(404, { message: "not found" });
    }
    return { ok: true, updated_at: updated.updated_at };
  },
  zod$({
    world: z.enum(["Real", "VRChat"]),
    // Required (no default): a submission without the field must not
    // silently clear the photo's camera. "" = none.
    camera_id: z.string().max(20),
    tags: z.string().max(2000).default(""),
    // Required: a submission without it must not change who can see the
    // photo.
    visibility: z.enum(VISIBILITIES),
  }),
);

/** What each visibility means on the public site. */
const VISIBILITY_HELP: Record<Visibility, string> = {
  private: "Only in the admin. The public site answers 404.",
  unlisted: "Opens from its URL, but never shown in the gallery list.",
  public: "Listed in the gallery.",
};

const legend = "text-sm font-semibold text-zinc-900 dark:text-zinc-100";

/**
 * The editable fields. A component of its own so that the page re-rendering
 * (unsaved mark, busy state, folding) never re-applies the saved values'
 * `checked` / `selected` / `value` over what the user just picked; it
 * re-renders only when the row itself changes (saved, or another photo).
 */
const MediaFields = component$<{ row: MediaRow; cameras: CameraOption[] }>(
  ({ row, cameras }) => (
    <>
      <fieldset class="space-y-3">
        <legend class={legend}>Visibility</legend>
        <div class="grid gap-2 sm:grid-cols-3">
          {VISIBILITIES.map((v) => (
            <label
              key={v}
              class="flex cursor-pointer gap-2 rounded-lg border border-zinc-200 p-3 text-sm has-[:checked]:border-sky-500 has-[:checked]:bg-sky-50/60 dark:border-zinc-800 dark:has-[:checked]:bg-sky-950/30"
            >
              <input
                type="radio"
                name="visibility"
                value={v}
                checked={row.visibility === v}
                class="mt-0.5"
              />
              <span>
                <span class="block font-medium">{VISIBILITY_LABELS[v]}</span>
                <span class={["block text-xs", muted]}>
                  {VISIBILITY_HELP[v]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset class="space-y-3">
        <legend class={legend}>Category</legend>
        <div class="max-w-xs">
          <label for="edit-world" class={label}>
            World
          </label>
          <select id="edit-world" name="world" class={field}>
            <option value="Real" selected={row.world === "Real"}>
              Real
            </option>
            <option value="VRChat" selected={row.world === "VRChat"}>
              VRChat
            </option>
          </select>
        </div>
      </fieldset>

      <fieldset class="space-y-3">
        <legend class={legend}>Camera</legend>
        <div class="max-w-sm">
          {/* The fieldset legend already says "Camera". */}
          <label for="edit-camera" class="sr-only">
            Camera
          </label>
          <select
            id="edit-camera"
            name="camera_id"
            aria-describedby="edit-camera-help"
            class={field}
          >
            <option value="" selected={row.camera_id === null}>
              (none)
            </option>
            {cameras.map((c) => (
              <option
                key={c.id}
                value={String(c.id)}
                selected={row.camera_id === c.id}
              >
                {c.name}
              </option>
            ))}
          </select>
          <p id="edit-camera-help" class={["mt-1 text-xs", muted]}>
            Not listed?{" "}
            <Link href="/camera/new/" class={link}>
              Add a camera
            </Link>{" "}
            first.
          </p>
        </div>
      </fieldset>

      <fieldset class="space-y-3">
        <legend class={legend}>Tags</legend>
        <div>
          <label for="edit-tags" class={label}>
            Tags (comma-separated)
          </label>
          <input
            id="edit-tags"
            type="text"
            name="tags"
            value={row.tags.join(", ")}
            maxLength={2000}
            aria-describedby="edit-tags-help"
            autoCapitalize="off"
            autoCorrect="off"
            spellcheck={false}
            enterKeyHint="done"
            class={field}
          />
          <p id="edit-tags-help" class={["mt-1 text-xs", muted]}>
            e.g. <code>VRChat, night</code>. Saved to D1 immediately; the public
            gallery shows it within about a minute.
          </p>
        </div>
      </fieldset>
    </>
  ),
);

const UNSAVED_CONFIRM = "保存していない変更があります。破棄して移動しますか？";

const navButton =
  "inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 sm:h-10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";

export default component$(() => {
  const media = useMedia();
  const action = useUpdateMedia();
  // The list this page was opened from (view, folder, filter, page).
  const backHref = safeBackHref(useLocation().url.searchParams.get("back"));
  const toast = useSignal<ToastState | null>(null);
  useTask$(({ track }) => {
    const v = track(() => action.value);
    if (!v) return;
    toast.value = v.failed
      ? {
          tone: "error",
          message: `Save failed: ${v.message ?? "unknown error"}`,
        }
      : {
          tone: "success",
          message: `Saved at ${formatJst(v.updated_at)} JST.`,
        };
  });

  // Unsaved edits: shown next to Save, and leaving the page (prev/next,
  // back, reload, closing the tab) asks first.
  const dirty = useSignal(false);
  // Edits so far, and how many of them the running save sent: a change
  // typed while it is in flight keeps the form dirty.
  const edits = useSignal(0);
  const editsSent = useSignal(0);
  useTask$(({ track }) => {
    // Another photo (prev/next reuse this component): a fresh form.
    track(() => (media.value.kind === "ok" ? media.value.row.id : null));
    dirty.value = false;
  });
  usePreventNavigate$((url) => {
    // (The action's own reload does not navigate, so it never gets here.)
    if (!dirty.value) return false;
    // A link inside the app can ask; a browser navigation (reload, close)
    // only gets the browser's own dialog.
    return url ? !confirm(UNSAVED_CONFIRM) : true;
  });
  // Phones: File / Public URL / Last updated are folded away.
  const showMeta = useSignal(false);
  const fullscreen = useSignal<HTMLDialogElement>();

  if (media.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/media/" />;
  }
  if (media.value.kind === "bad-request") {
    return (
      <StatePanel
        tone="error"
        title="Invalid id"
        action={{ href: "/media/", label: "← Back to media" }}
      >
        <p>
          The id in the URL must be a positive integer, like{" "}
          <code>/media/12/</code>. Pick a photo from the list instead.
        </p>
      </StatePanel>
    );
  }
  if (media.value.kind === "not-found") {
    return (
      <StatePanel
        tone="error"
        title="Not found"
        action={{ href: "/media/", label: "← Back to media" }}
      >
        <p>
          No media row has this id. It may have been removed from D1, or the
          link is out of date.
        </p>
      </StatePanel>
    );
  }

  const { row, cameras, neighbors } = media.value;
  const { dir, base } = splitPath(row.file);
  const previewBase = media.value.imageBase;
  // Folded on phones unless opened ("max-sm": below sm only).
  const meta = showMeta.value ? "" : "max-sm:hidden";

  return (
    <div class="mx-auto max-w-3xl space-y-6">
      <div>
        <nav
          aria-label="Breadcrumb"
          class="flex items-center justify-between gap-3 text-sm"
        >
          <Link href={backHref} class={backLink}>
            ← Media
          </Link>
          {neighbors && (
            <span class={["tabular-nums", muted]} data-testid="position">
              {neighbors.pos} / {neighbors.total}
            </span>
          )}
        </nav>
        <div class="mt-2 flex flex-wrap items-center gap-3">
          <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
            Edit #{row.id}
          </h1>
          <span class={worldBadge(row.world)}>{row.world}</span>
          <span
            data-testid="visibility-badge"
            class={visibilityBadge(row.visibility)}
          >
            {VISIBILITY_LABELS[row.visibility]}
          </span>
        </div>
      </div>

      {previewBase ? (
        // A tap opens the photo full screen, where it can be pinch-zoomed.
        <button
          type="button"
          aria-label="写真を全画面で表示"
          onClick$={() => fullscreen.value?.showModal()}
          class="block w-full cursor-zoom-in rounded-xl"
        >
          <Thumb
            file={row.file}
            world={row.world}
            imageBase={previewBase}
            variant="preview"
            class="w-full rounded-xl border border-zinc-200 dark:border-zinc-800"
          />
        </button>
      ) : (
        <Thumb
          file={row.file}
          world={row.world}
          imageBase={null}
          variant="preview"
          class="w-full rounded-xl border border-zinc-200 dark:border-zinc-800"
        />
      )}
      {previewBase && (
        <dialog
          ref={fullscreen}
          aria-label={`Preview of ${row.file}`}
          // Tap anywhere (the photo included) to close.
          onClick$={() => fullscreen.value?.close()}
          class="m-0 h-dvh max-h-none w-screen max-w-none bg-black p-0 backdrop:bg-black"
        >
          {/* The same candidates as the preview, so the browser usually
              reuses the file it already has (no extra transform). */}
          <img
            src={imageUrl(previewBase, row.file, "w1200")}
            srcset={srcSet(previewBase, row.file, PREVIEW_CANDIDATES)}
            sizes="100vw"
            alt={`Preview of ${row.file}`}
            loading="lazy"
            class="h-full w-full object-contain"
          />
          <button
            type="button"
            aria-label="閉じる"
            class="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-2 grid size-11 place-items-center rounded-full bg-black/60 text-white"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </dialog>
      )}

      <div class={[card, "p-5 text-sm"]}>
        <dl
          id="media-meta"
          class="grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_1fr] sm:gap-y-4 [&>dd]:mb-3 sm:[&>dd]:mb-0 [&>dd:last-of-type]:mb-0"
        >
          <dt class={["font-medium", muted]}>Taken</dt>
          <dd title={row.timestamp ?? undefined} class="tabular-nums">
            {row.timestamp ? (
              <>
                {formatJst(row.timestamp)}{" "}
                <span class={["text-xs", muted]}>JST</span>
              </>
            ) : (
              <span class={muted}>(none)</span>
            )}
          </dd>
          <dt class={["font-medium", muted, meta]}>File</dt>
          <dd class={["min-w-0", meta]} title={row.file}>
            <span class="block font-medium break-all">{base}</span>
            <span class={["block text-xs break-all", muted]}>{dir}</span>
          </dd>
          <dt class={["font-medium", muted, meta]}>Public URL</dt>
          <dd class={["min-w-0 break-all", meta]}>
            {/* Private photos have no working public URL; show it as text. */}
            {row.visibility === "private" ? (
              <span data-testid="public-url" class={muted}>
                {publicPhotoUrl(row.public_id)}
              </span>
            ) : (
              <a
                data-testid="public-url"
                href={publicPhotoUrl(row.public_id)}
                target="_blank"
                rel="noopener"
                class={link}
              >
                {publicPhotoUrl(row.public_id)}
              </a>
            )}
          </dd>
          <dt class={["font-medium", muted, meta]}>Last updated</dt>
          <dd title={row.updated_at} class={["tabular-nums", meta]}>
            {formatJst(row.updated_at)}{" "}
            <span class={["text-xs", muted]}>JST</span>
          </dd>
        </dl>
        <button
          type="button"
          aria-expanded={showMeta.value}
          aria-controls="media-meta"
          onClick$={() => (showMeta.value = !showMeta.value)}
          class={[
            "-mx-2 mt-1 -mb-2 flex h-11 items-center gap-1 rounded-md px-2 text-left font-medium sm:hidden",
            muted,
          ]}
        >
          <span
            aria-hidden="true"
            class={["transition-transform", showMeta.value && "rotate-90"]}
          >
            ›
          </span>
          {showMeta.value ? "詳細を閉じる" : "ファイル・公開 URL・更新日時"}
        </button>
      </div>

      <Form
        // A fresh form (and dirty state) per photo when prev/next reuse
        // this component.
        key={row.id}
        action={action}
        aria-busy={action.isRunning}
        onInput$={() => {
          dirty.value = true;
          edits.value++;
        }}
        onChange$={() => {
          dirty.value = true;
          edits.value++;
        }}
        onSubmit$={() => {
          editsSent.value = edits.value;
        }}
        onSubmitCompleted$={(ev) => {
          const { value } = ev.detail as { value?: { ok?: boolean } };
          if (value?.ok && edits.value === editsSent.value) {
            dirty.value = false;
          }
        }}
        class={[card, "space-y-6 p-5"]}
      >
        <MediaFields row={row} cameras={cameras} />

        {/* Phones: fixed to the bottom of the screen, so Save and stepping
            through the list are always in reach. sm and up: the form's
            footer. */}
        <div
          data-bottom-bar="short"
          class="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-zinc-200 bg-white/95 pt-3 pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] shadow-[0_-4px_12px_rgb(0_0_0/0.06)] backdrop-blur sm:static sm:z-auto sm:gap-3 sm:bg-transparent sm:p-0 sm:pt-5 sm:shadow-none sm:backdrop-blur-none dark:border-zinc-800 dark:bg-zinc-900/95 sm:dark:bg-transparent"
        >
          {neighbors?.prev ? (
            <Link href={neighbors.prev} rel="prev" class={navButton}>
              ‹ 前へ
            </Link>
          ) : (
            // At the start of the list: a placeholder keeping the layout.
            <span aria-hidden="true" class={[navButton, "opacity-40"]}>
              ‹ 前へ
            </span>
          )}
          <SubmitButton
            running={action.isRunning}
            pendingLabel="保存中…"
            class={[buttonPrimary, "flex-1 sm:flex-none"]}
          >
            Save
          </SubmitButton>
          {dirty.value && (
            <span
              data-testid="dirty"
              class="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400"
            >
              <span
                aria-hidden="true"
                class="size-2 rounded-full bg-amber-500"
              />
              未保存
            </span>
          )}
          {neighbors?.next ? (
            <Link
              href={neighbors.next}
              rel="next"
              class={[navButton, "sm:ml-auto"]}
            >
              次へ ›
            </Link>
          ) : (
            <span
              aria-hidden="true"
              class={[navButton, "opacity-40 sm:ml-auto"]}
            >
              次へ ›
            </span>
          )}
        </div>
      </Form>
      <Toast toast={toast} />
    </div>
  );
});

export const head: DocumentHead = ({ resolveValue }) => {
  const result = resolveValue(useMedia);
  if (result.kind === "ok") {
    return { title: `Edit ${result.row.file} — Admin` };
  }
  if (result.kind === "missing-binding") {
    return { title: "Configuration error — Admin" };
  }
  if (result.kind === "bad-request") {
    return { title: "Invalid id — Admin" };
  }
  return { title: "Not found — Admin" };
};
