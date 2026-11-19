import { $, component$, sync$, useSignal, useTask$ } from "@builder.io/qwik";
import {
  Form,
  Link,
  routeAction$,
  routeLoader$,
  useLocation,
  z,
  zod$,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { CameraFields, cameraFormSchema } from "~/components/camera-fields";
import { MissingBindingError } from "~/components/missing-binding-error";
import { StatePanel } from "~/components/state-panel";
import { Spinner, SubmitButton } from "~/components/submit-button";
import { Thumb } from "~/components/thumb";
import { Toast, type ToastState } from "~/components/toast";
import {
  backLink,
  buttonPrimary,
  buttonSecondary,
  card,
  field,
  label,
  muted,
} from "~/components/ui";

const legend = "text-sm font-semibold text-zinc-900 dark:text-zinc-100";
import {
  addCameraImage,
  DuplicateImageError,
  getCamera,
  listCameraImages,
  MAX_BULK_IDS,
  moveCameraImage,
  removeCameraImage,
  restoreCameraImage,
  SlugConflictError,
  updateCamera,
  updateCameraImageCaption,
} from "~/lib/db";
import {
  listCameraPhotos,
  removeCameraFrom,
  restoreCameras,
  type CameraPhoto,
  type PreviousCamera,
} from "~/lib/db-photo-bulk";
import {
  addCameraTag,
  listCameraTags,
  removeCameraTag,
  setCameraTagPropagate,
  type CameraTagRow,
} from "~/lib/db-camera-tag";
import { getDB, getImageBase } from "~/lib/env";
import { contentChanged } from "~/lib/last-good";
import { inChunks } from "~/lib/selection";
import { CameraPhotos } from "~/components/camera-photos";
import { formatJst } from "~/lib/format";
import type { CameraImageRow, CameraRow } from "~/lib/types";
import {
  cameraImageDir,
  cameraImagePathLengthError,
  MAX_IMAGE_CAPTION_LEN,
  MAX_IMAGE_FILE_LEN,
  resolveCameraImagePath,
  validateCamera,
  validateCameraImage,
} from "~/lib/validate";

type CameraLoaderResult =
  | {
      kind: "ok";
      camera: CameraRow;
      images: CameraImageRow[];
      /** The photos taken with it, newest first. */
      photos: CameraPhoto[];
      /** The camera's tags (0011). */
      tags: CameraTagRow[];
      /** Every tag's name, to pick from. */
      tagNames: string[];
      /** Image Worker base URL, or null for placeholder tiles. */
      imageBase: string | null;
    }
  | { kind: "missing-binding" }
  | { kind: "bad-request" }
  | { kind: "not-found" };

const parseId = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const useCamera = routeLoader$<CameraLoaderResult>(
  async ({ platform, params, status }) => {
    const id = parseId(params.id);
    if (id === null) {
      status(400);
      return { kind: "bad-request" };
    }
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/camera/[id]loader: getDB failed:", err);
      status(500);
      return { kind: "missing-binding" };
    }
    const [camera, images, photos, tags, tagNames] = await Promise.all([
      getCamera(db, id),
      listCameraImages(db, id),
      listCameraPhotos(db, id),
      listCameraTags(db, id),
      db
        .prepare("SELECT name FROM tag ORDER BY name")
        .all<{ name: string }>()
        .then((r) => (r.results ?? []).map((t) => t.name)),
    ]);
    if (!camera) {
      status(404);
      return { kind: "not-found" };
    }
    return {
      kind: "ok",
      camera,
      images,
      photos,
      tags,
      tagNames,
      imageBase: getImageBase(platform),
    };
  },
);

/**
 * 写真 → カメラを外す: this camera off the picked photos (one chunk of at
 * most MAX_BULK_IDS; only photos that have it). Returns what changed, for
 * 元に戻す.
 */
export const useRemoveCameraPhotos = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = parseId(params.id);
    if (id === null) return fail(400, { message: "invalid id" });
    return {
      ok: true as const,
      previous: await removeCameraFrom(getDB(platform), id, data.ids),
    };
  },
  zod$({
    ids: z.array(z.number().int().positive()).min(1).max(MAX_BULK_IDS),
  }),
);

/** Undo of useRemoveCameraPhotos. */
export const useRestoreCameraPhotos = routeAction$(
  async (data, { platform }) => {
    await restoreCameras(getDB(platform), data.previous);
    return { ok: true as const };
  },
  zod$({
    previous: z
      .array(
        z.object({
          id: z.number().int().positive(),
          camera_id: z.number().int().positive().nullable(),
          camera_source: z.enum(["manual", "file"]).nullable(),
        }),
      )
      .max(MAX_BULK_IDS),
  }),
);

/**
 * The camera's tags (0011): add one (a new tag starts private), take one
 * off, pass one on to its photos or not, and put a removed one back.
 */
export const useCameraTagOp = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = parseId(params.id);
    if (id === null) return fail(400, { message: "invalid id" });
    const db = getDB(platform);
    const tag = data.tag.trim();
    if (tag.length === 0 || tag.length > 200) {
      return fail(400, { message: "タグは 1〜200 文字です" });
    }
    // A photo's tags are typed comma-separated: a comma could never be
    // one of them.
    if (tag.includes(",")) {
      return fail(400, { message: "タグに , は使えません" });
    }
    if (!(await getCamera(db, id))) return fail(404, { message: "not found" });
    switch (data.op) {
      case "add":
      case "restore": {
        const r = await addCameraTag(
          db,
          id,
          tag,
          data.propagate !== "0",
          data.op === "restore" ? data.position : undefined,
        );
        if (!r.added)
          return fail(409, { message: `『${tag}』はもう付いています` });
        return { ok: true as const, op: data.op, tag, newTag: r.newTag };
      }
      case "remove": {
        const removed = await removeCameraTag(db, id, tag);
        if (!removed) return fail(404, { message: "付いていないタグです" });
        return { ok: true as const, op: data.op, tag, removed };
      }
      case "propagate": {
        const on = data.propagate === "1";
        if (!(await setCameraTagPropagate(db, id, tag, on))) {
          return fail(404, { message: "付いていないタグです" });
        }
        return { ok: true as const, op: data.op, tag, propagate: on };
      }
    }
  },
  zod$({
    op: z.enum(["add", "remove", "propagate", "restore"]),
    tag: z.string().max(400),
    propagate: z.enum(["0", "1"]).optional(),
    position: z.coerce.number().int().min(0).max(10_000).optional(),
  }),
);

export const useAddCameraImage = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = parseId(params.id);
    if (id === null) return fail(400, { message: "invalid id" });
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/camera/[id]add image: getDB failed:", err);
      return fail(500, { message: "D1 binding unavailable" });
    }
    const camera = await getCamera(db, id);
    if (!camera) return fail(404, { message: "not found" });
    // A bare file name is in the camera's own folder (and counts it in its
    // length).
    const tooLong = cameraImagePathLengthError(data.file, camera.slug);
    if (tooLong) return fail(400, { message: tooLong });
    const v = validateCameraImage({
      file: resolveCameraImagePath(data.file, camera.slug),
      caption: data.caption,
    });
    if (!v.ok) return fail(400, { message: v.error });
    try {
      await addCameraImage(db, id, v.image);
    } catch (err) {
      if (err instanceof DuplicateImageError) {
        return fail(409, { message: `${v.image.file} is already added` });
      }
      throw err;
    }
    await contentChanged(db);
    return { ok: true };
  },
  zod$({
    file: z.string().max(MAX_IMAGE_FILE_LEN + 50),
    caption: z
      .string()
      .max(MAX_IMAGE_CAPTION_LEN + 50)
      .default(""),
  }),
);

/** Move / remove / re-caption one picture of this camera. */
export const useCameraImageOp = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = parseId(params.id);
    const imageId = parseId(data.image_id);
    if (id === null || imageId === null) {
      return fail(400, { message: "invalid id" });
    }
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/camera/[id]image op: getDB failed:", err);
      return fail(500, { message: "D1 binding unavailable" });
    }
    let done: boolean;
    if (data.op === "caption") {
      const v = validateCameraImage({ file: "/x.png", caption: data.caption });
      if (!v.ok) return fail(400, { message: v.error });
      done = await updateCameraImageCaption(db, id, imageId, v.image.caption);
    } else if (data.op === "remove") {
      const removed = await removeCameraImage(db, id, imageId);
      if (!removed) return fail(404, { message: "image not found" });
      await contentChanged(db);
      // What 「元に戻す」 puts back.
      return { ok: true, op: data.op, removed };
    } else {
      // Already first/last is a no-op, not an error.
      done = await moveCameraImage(db, id, imageId, data.op);
    }
    if (!done) return fail(404, { message: "image not found" });
    await contentChanged(db);
    return { ok: true, op: data.op };
  },
  zod$({
    image_id: z.string().max(20),
    op: z.enum(["up", "down", "remove", "caption"]),
    caption: z
      .string()
      .max(MAX_IMAGE_CAPTION_LEN + 50)
      .default(""),
  }),
);

/** Undo of a removal: the picture back at its old place. */
export const useRestoreCameraImage = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = parseId(params.id);
    if (id === null) return fail(400, { message: "invalid id" });
    const v = validateCameraImage({
      file: data.file,
      caption: data.caption ?? "",
    });
    if (!v.ok) return fail(400, { message: v.error });
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/camera/[id]restore image: getDB failed:", err);
      return fail(500, { message: "D1 binding unavailable" });
    }
    if (!(await getCamera(db, id))) return fail(404, { message: "not found" });
    try {
      await restoreCameraImage(db, id, v.image, data.index);
    } catch (err) {
      if (err instanceof DuplicateImageError) {
        return fail(409, { message: `${v.image.file} is already added` });
      }
      throw err;
    }
    await contentChanged(db);
    return { ok: true };
  },
  zod$({
    file: z.string().max(MAX_IMAGE_FILE_LEN + 50),
    caption: z
      .string()
      .max(MAX_IMAGE_CAPTION_LEN + 50)
      .nullable(),
    index: z.number().int().min(0).max(10_000),
  }),
);

/**
 * The new picture's path. Its own component so that showing the length
 * error re-renders only this field, not the page (whose caption inputs
 * would get their saved values back).
 */
const ImagePathField = component$<{ slug: string }>(({ slug }) => {
  const error = useSignal<string | null>(null);
  return (
    <div>
      <label for="new-image-file" class={label}>
        Image path
      </label>
      <input
        id="new-image-file"
        type="text"
        name="file"
        required
        placeholder="front.png"
        autoCapitalize="off"
        autoCorrect="off"
        spellcheck={false}
        enterKeyHint="next"
        aria-describedby="new-image-file-help new-image-file-error"
        aria-invalid={error.value ? "true" : undefined}
        // The length counts the folder a bare name goes in; the browser
        // then refuses to submit with this message.
        onInput$={(_, el) => {
          const e = cameraImagePathLengthError(el.value, slug);
          el.setCustomValidity(e ?? "");
          error.value = e;
        }}
        class={field}
      />
      <p id="new-image-file-help" class={["mt-1 text-xs", muted]}>
        A file name is looked up in <code>{cameraImageDir(slug)}</code>; start
        with <code>/</code> for anywhere else.
      </p>
      <p
        id="new-image-file-error"
        data-testid="image-path-error"
        class="mt-1 text-xs text-red-700 empty:hidden dark:text-red-400"
      >
        {error.value ?? ""}
      </p>
    </div>
  );
});

const IMAGE_OP_DONE = {
  up: "Image moved up.",
  down: "Image moved down.",
  remove: "Image removed.",
  caption: "Caption saved.",
} as const;

export const useUpdateCamera = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = parseId(params.id);
    if (id === null) {
      return fail(400, { message: "invalid id" });
    }
    const v = validateCamera(data);
    if (!v.ok) {
      return fail(400, { message: v.error });
    }
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/camera/[id]action: getDB failed:", err);
      return fail(500, { message: "D1 binding unavailable" });
    }
    let updated: CameraRow | null;
    try {
      updated = await updateCamera(db, id, v.camera);
    } catch (err) {
      if (err instanceof SlugConflictError) {
        return fail(409, { message: `slug “${v.camera.slug}” is taken` });
      }
      throw err;
    }
    if (!updated) {
      return fail(404, { message: "not found" });
    }
    await contentChanged(db);
    return { ok: true, updated_at: updated.updated_at };
  },
  zod$(cameraFormSchema),
);

export default component$(() => {
  const data = useCamera();
  const action = useUpdateCamera();
  const addImage = useAddCameraImage();
  const imageOp = useCameraImageOp();
  const loc = useLocation();
  // Which image form (`<image id>:<op>`) submitted last, so only its button
  // shows the spinner: every image form shares the imageOp action.
  const busyKey = useSignal("");
  // Fresh from /camera/new/.
  const toast = useSignal<ToastState | null>(
    loc.url.searchParams.has("created")
      ? { tone: "success", message: "Camera created." }
      : null,
  );
  // Each action reports through the one toast, so an old failure never
  // lingers after a later action succeeded.
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
  useTask$(({ track }) => {
    const v = track(() => addImage.value);
    if (!v) return;
    toast.value = v.failed
      ? {
          tone: "error",
          message: `Add failed: ${v.message ?? "unknown error"}`,
        }
      : { tone: "success", message: "Image added." };
  });
  /** What 元に戻す puts back after カメラを外す (photos). */
  const photoUndo = useSignal<PreviousCamera[] | null>(null);
  const tagOp = useCameraTagOp();
  /** The last change to the camera's tags, as the op that undoes it. */
  const tagUndo = useSignal<{
    op: "remove" | "restore" | "propagate";
    tag: string;
    propagate?: "0" | "1";
    position?: number;
  } | null>(null);
  /** Whether the running tag op is an undo (no new undo for it). */
  const undoingTag = useSignal(false);
  /** The last removed picture, for 「元に戻す」. */
  const removed = useSignal<{
    file: string;
    caption: string | null;
    index: number;
  } | null>(null);
  useTask$(({ track }) => {
    const v = track(() => imageOp.value);
    if (!v) return;
    if (v.failed) {
      toast.value = {
        tone: "error",
        message: `Update failed: ${v.message ?? "unknown error"}`,
      };
      return;
    }
    if (v.op === "remove") {
      removed.value = v.removed ?? null;
      photoUndo.value = null;
      tagUndo.value = null;
    } else if (toast.value?.actionLabel) {
      // E.g. a caption saved on blur by the tap on Remove, landing after
      // it: keep the undo in view.
      return;
    }
    toast.value = {
      tone: "success",
      message: IMAGE_OP_DONE[v.op],
      actionLabel: v.removed ? "元に戻す" : undefined,
    };
  });
  const restoreImage = useRestoreCameraImage();
  useTask$(({ track }) => {
    const v = track(() => restoreImage.value);
    if (!v) return;
    toast.value = v.failed
      ? {
          tone: "error",
          message: `Undo failed: ${v.message ?? "unknown error"}`,
        }
      : { tone: "success", message: "元に戻しました。" };
  });
  const removePhotos = useRemoveCameraPhotos();
  const restorePhotos = useRestoreCameraPhotos();
  /** カメラを外す on photos `ids`: in chunks; true when all went through. */
  const removeCamera = $(async (ids: number[]): Promise<boolean> => {
    const previous: PreviousCamera[] = [];
    let error: string | null = null;
    for (const chunk of inChunks(ids, MAX_BULK_IDS)) {
      const r = await removePhotos.submit({ ids: chunk }).catch(() => null);
      if (!r || r.value.failed) {
        error =
          (r && "message" in r.value ? String(r.value.message) : "") ||
          "失敗しました";
        break;
      }
      previous.push(...r.value.previous);
    }
    removed.value = null;
    tagUndo.value = null;
    photoUndo.value = previous.length > 0 ? previous : null;
    const what = `${previous.length} 枚からカメラを外しました。`;
    toast.value = error
      ? {
          tone: "error",
          message: `${what} 残りは失敗: ${error}`,
          actionLabel: photoUndo.value ? "元に戻す" : undefined,
        }
      : {
          tone: "success",
          message: what,
          actionLabel: photoUndo.value ? "元に戻す" : undefined,
        };
    return error === null;
  });
  useTask$(({ track }) => {
    const v = track(() => tagOp.value);
    if (!v) return;
    const wasUndo = undoingTag.value;
    undoingTag.value = false;
    if (v.failed) {
      // A failed undo stays available to try again.
      toast.value = {
        tone: "error",
        message: wasUndo
          ? `元に戻せませんでした: ${v.message ?? ""}`
          : (v.message ?? "変更できませんでした"),
        actionLabel: wasUndo && tagUndo.value ? "元に戻す" : undefined,
      };
      return;
    }
    if (wasUndo) {
      tagUndo.value = null;
      toast.value = { tone: "success", message: "元に戻しました。" };
      return;
    }
    removed.value = null;
    photoUndo.value = null;
    if (v.op === "add") {
      tagUndo.value = { op: "remove", tag: v.tag };
    } else if (v.op === "remove") {
      tagUndo.value = {
        op: "restore",
        tag: v.tag,
        propagate: v.removed.propagate ? "1" : "0",
        position: v.removed.position,
      };
    } else if (v.op === "propagate") {
      tagUndo.value = {
        op: "propagate",
        tag: v.tag,
        propagate: v.propagate ? "0" : "1",
      };
    }
    toast.value = {
      tone: "success",
      message:
        v.op === "add"
          ? `『${v.tag}』を付けました。` +
            (v.newTag ? "新しいタグは非公開です。" : "")
          : v.op === "remove"
            ? `『${v.tag}』を外しました。`
            : v.op === "propagate"
              ? v.propagate
                ? `『${v.tag}』をこのカメラの写真にも付けます。`
                : `『${v.tag}』をこのカメラの写真には付けません。`
              : "元に戻しました。",
      actionLabel: v.op === "restore" ? undefined : "元に戻す",
    };
  });
  const undoRemove = $(async () => {
    const t = tagUndo.value;
    if (t) {
      // Kept until it goes through (the task clears it then).
      undoingTag.value = true;
      await tagOp.submit(t);
      return;
    }
    const photos = photoUndo.value;
    if (photos) {
      photoUndo.value = null;
      const chunks = inChunks(photos, MAX_BULK_IDS);
      for (const [i, previous] of chunks.entries()) {
        const r = await restorePhotos.submit({ previous }).catch(() => null);
        if (!r || r.value.failed) {
          photoUndo.value = chunks.slice(i).flat();
          toast.value = {
            tone: "error",
            message: "元に戻せませんでした",
            actionLabel: "元に戻す",
          };
          return;
        }
      }
      toast.value = { tone: "success", message: "元に戻しました。" };
      return;
    }
    const r = removed.value;
    if (!r) return;
    removed.value = null;
    await restoreImage.submit(r);
  });
  // Phones: ↑ / ↓ only while reordering (sm and up: always).
  const ordering = useSignal(false);

  if (data.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/camera/" />;
  }
  if (data.value.kind === "bad-request") {
    return (
      <StatePanel
        tone="error"
        title="Invalid id"
        action={{ href: "/camera/", label: "← Back to cameras" }}
      >
        <p>
          The id in the URL must be a positive integer, like{" "}
          <code>/camera/1/</code>.
        </p>
      </StatePanel>
    );
  }
  if (data.value.kind === "not-found") {
    return (
      <StatePanel
        tone="error"
        title="Not found"
        action={{ href: "/camera/", label: "← Back to cameras" }}
      >
        <p>No camera has this id.</p>
      </StatePanel>
    );
  }

  const { camera, images, photos, imageBase, tags, tagNames } = data.value;
  const opRunning = (key: string) => imageOp.isRunning && busyKey.value === key;

  return (
    <div class="mx-auto max-w-3xl space-y-6">
      <div>
        <nav aria-label="Breadcrumb" class="text-sm">
          <Link prefetch="js" href="/camera/" class={backLink}>
            ← Cameras
          </Link>
        </nav>
        <h1 class="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          Edit camera
        </h1>
        <p class={["mt-1 text-sm", muted]}>
          Last updated{" "}
          <span class="tabular-nums" title={camera.updated_at}>
            {formatJst(camera.updated_at)}
          </span>{" "}
          JST
        </p>
      </div>

      <Form
        action={action}
        aria-busy={action.isRunning}
        class={[card, "space-y-6 p-5"]}
      >
        <CameraFields values={camera} />
        <div class="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <SubmitButton
            running={action.isRunning}
            pendingLabel="保存中…"
            class={buttonPrimary}
          >
            Save
          </SubmitButton>
        </div>
      </Form>

      <section
        aria-labelledby="tags-heading"
        data-testid="camera-tags"
        class={[card, "space-y-4 p-5"]}
      >
        <h2 id="tags-heading" class={legend}>
          タグ
        </h2>
        {tags.length > 0 && (
          <ul class="divide-y divide-zinc-100 dark:divide-zinc-800">
            {tags.map((t) => (
              <li
                key={t.tag}
                data-testid="camera-tag"
                class="flex flex-wrap items-center gap-x-3 py-1.5"
              >
                <span class="flex min-w-0 flex-1 items-center gap-1 font-medium">
                  {!t.public && (
                    <span aria-hidden="true" title="非公開のタグ">
                      🔒
                    </span>
                  )}
                  <span class="truncate">{t.tag}</span>
                  <span class="sr-only">
                    （{t.public ? "公開" : "非公開"}）
                  </span>
                </span>
                {/* A switch: does every photo with this camera get it? */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={t.propagate}
                  disabled={tagOp.isRunning}
                  onClick$={() =>
                    tagOp.submit({
                      op: "propagate",
                      tag: t.tag,
                      propagate: t.propagate ? "0" : "1",
                    })
                  }
                  class="flex h-11 items-center gap-2 text-sm sm:h-9"
                >
                  <span
                    class={[
                      "relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors",
                      t.propagate
                        ? "bg-sky-600"
                        : "bg-zinc-300 dark:bg-zinc-700",
                    ]}
                  >
                    <span
                      class={[
                        "absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform",
                        t.propagate ? "translate-x-4.5" : "translate-x-0.5",
                      ]}
                    />
                  </span>
                  写真にも付ける
                </button>
                <button
                  type="button"
                  aria-label={`${t.tag}を外す`}
                  disabled={tagOp.isRunning}
                  onClick$={() => tagOp.submit({ op: "remove", tag: t.tag })}
                  class="inline-flex size-11 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 sm:size-9 dark:hover:bg-zinc-800"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <Form
          action={tagOp}
          aria-busy={tagOp.isRunning}
          onSubmitCompleted$={(ev, form) => {
            const { value } = ev.detail as { value?: { ok?: boolean } };
            if (value?.ok) form.reset();
          }}
          class="flex items-end gap-2"
        >
          <input type="hidden" name="op" value="add" />
          <div class="min-w-0 flex-1">
            <label for="camera-tag-new" class={label}>
              タグを付ける
            </label>
            <input
              id="camera-tag-new"
              name="tag"
              required
              maxLength={200}
              // (Qwik's input type has no `list`; the browser does.)
              {...{ list: "camera-tag-names" }}
              autoCapitalize="off"
              autoCorrect="off"
              spellcheck={false}
              enterKeyHint="done"
              class={field}
            />
            <datalist id="camera-tag-names">
              {tagNames
                .filter((n) => !tags.some((t) => t.tag === n))
                .map((n) => (
                  <option key={n} value={n} />
                ))}
            </datalist>
          </div>
          <SubmitButton running={tagOp.isRunning} class={buttonSecondary}>
            付ける
          </SubmitButton>
        </Form>
      </section>

      <section aria-labelledby="images-heading" class={[card, "space-y-5 p-5"]}>
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 id="images-heading" class={legend}>
              Images
            </h2>
            <p class={["mt-1 text-xs", muted]}>
              Pictures of the camera itself, shown on its public page in this
              order. There is no upload yet: put the file in the B2 bucket
              first, then add its path here. Captions save when you leave the
              field.
            </p>
          </div>
          {images.length > 1 && (
            <button
              type="button"
              onClick$={() => (ordering.value = !ordering.value)}
              class={[buttonSecondary, "shrink-0 sm:hidden"]}
            >
              {ordering.value ? "完了" : "並べ替え"}
            </button>
          )}
        </div>

        {images.length > 0 && (
          <ol class="divide-y divide-zinc-100 dark:divide-zinc-800">
            {images.map((img, i) => (
              <li
                key={img.id}
                data-testid="camera-image"
                class="flex flex-wrap gap-3 py-3 first:pt-0 sm:flex-nowrap sm:items-start"
              >
                <Thumb
                  file={img.file}
                  platform={null}
                  imageBase={imageBase}
                  variant="list"
                  class="w-24 rounded-md sm:w-40"
                />
                <div class="min-w-0 flex-1 space-y-2">
                  <code class="block text-xs break-all">{img.file}</code>
                  {/* Saved when it changes (on leaving the field, or Enter). */}
                  <Form
                    action={imageOp}
                    onSubmit$={() => {
                      busyKey.value = `${img.id}:caption`;
                    }}
                    aria-busy={opRunning(`${img.id}:caption`)}
                    class="relative"
                  >
                    <input type="hidden" name="image_id" value={img.id} />
                    <input type="hidden" name="op" value="caption" />
                    <label for={`image-caption-${img.id}`} class="sr-only">
                      Caption of image {i + 1}
                    </label>
                    <input
                      id={`image-caption-${img.id}`}
                      type="text"
                      name="caption"
                      value={img.caption ?? ""}
                      placeholder="Caption (optional)"
                      maxLength={MAX_IMAGE_CAPTION_LEN}
                      enterKeyHint="done"
                      onChange$={(_, el) => el.form?.requestSubmit()}
                      // Enter: no implicit submit on top of the change
                      // event's (one save); leave the field instead.
                      onKeyDown$={[
                        sync$((e: KeyboardEvent) => {
                          if (e.key === "Enter") e.preventDefault();
                        }),
                        $((e: KeyboardEvent, el: HTMLInputElement) => {
                          if (e.key === "Enter") el.blur();
                        }),
                      ]}
                      class={[field, "pr-9"]}
                    />
                    {opRunning(`${img.id}:caption`) && (
                      <span class="absolute inset-y-0 right-3 grid place-items-center text-zinc-400">
                        <Spinner />
                      </span>
                    )}
                  </Form>
                </div>
                <div class="flex w-full justify-end gap-1 sm:w-auto">
                  {(
                    [
                      ["up", "↑", `Move image ${i + 1} up`, i === 0],
                      [
                        "down",
                        "↓",
                        `Move image ${i + 1} down`,
                        i === images.length - 1,
                      ],
                      ["remove", "Remove", `Remove image ${i + 1}`, false],
                    ] as const
                  ).map(([op, text, aria, disabled]) => (
                    <Form
                      key={op}
                      action={imageOp}
                      onSubmit$={() => {
                        busyKey.value = `${img.id}:${op}`;
                      }}
                      aria-busy={opRunning(`${img.id}:${op}`)}
                      class={
                        op !== "remove" && !ordering.value
                          ? "max-sm:hidden"
                          : undefined
                      }
                    >
                      <input type="hidden" name="image_id" value={img.id} />
                      <input type="hidden" name="op" value={op} />
                      <SubmitButton
                        running={opRunning(`${img.id}:${op}`)}
                        aria-label={aria}
                        disabled={disabled}
                        class={[
                          buttonSecondary,
                          "disabled:cursor-not-allowed disabled:opacity-40",
                        ]}
                      >
                        {text}
                      </SubmitButton>
                    </Form>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}

        <Form
          action={addImage}
          aria-busy={addImage.isRunning}
          // Clear the inputs only when the image was added; a rejected path
          // stays in the field to be fixed (spaReset would always clear).
          onSubmitCompleted$={(ev, form) => {
            const { value } = ev.detail as { value?: { ok?: boolean } };
            if (value?.ok) form.reset();
          }}
          class="grid gap-3 border-t border-zinc-200 pt-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end dark:border-zinc-800"
        >
          <ImagePathField slug={camera.slug} />
          <div>
            <label for="new-image-caption" class={label}>
              Caption
            </label>
            <input
              id="new-image-caption"
              type="text"
              name="caption"
              placeholder="(optional)"
              maxLength={MAX_IMAGE_CAPTION_LEN}
              class={field}
            />
          </div>
          <SubmitButton
            running={addImage.isRunning}
            pendingLabel="追加中…"
            class={buttonPrimary}
          >
            Add image
          </SubmitButton>
        </Form>
      </section>
      <CameraPhotos
        photos={photos}
        imageBase={imageBase}
        busy={removePhotos.isRunning}
        onRemove$={removeCamera}
      />
      <Toast toast={toast} onAction$={undoRemove} />
    </div>
  );
});

export const head: DocumentHead = ({ resolveValue }) => {
  const result = resolveValue(useCamera);
  if (result.kind === "ok") {
    return { title: `Edit ${result.camera.name} — Admin` };
  }
  if (result.kind === "missing-binding") {
    return { title: "Configuration error — Admin" };
  }
  if (result.kind === "bad-request") {
    return { title: "Invalid id — Admin" };
  }
  return { title: "Not found — Admin" };
};
