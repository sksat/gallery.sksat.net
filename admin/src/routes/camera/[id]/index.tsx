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
  PathBusyError,
  listCameraImages,
  MAX_BULK_IDS,
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
import {
  DropZone,
  UploadButton,
  UploadPanel,
  useUploader,
} from "~/components/uploader";
import { getUploadConfig } from "~/lib/b2";
import { deleteAllVersions, DeletePermissionError } from "~/lib/b2-delete";
import {
  dropIndex,
  moveToIndex,
  objectDeletable,
  orderAfter,
} from "~/lib/camera-image";
import {
  deleteCameraImageRow,
  getCameraImage,
  releasePictureName,
  reservePictureName,
  setCameraImageOrder,
  sharedCameraImages,
} from "~/lib/db-camera-image";
import { getObjectStat } from "~/lib/object-stat";
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
      /** In order: the first one is the default. */
      images: (CameraImageRow & {
        /** 削除 may delete its object too (objectDeletable). */
        deletable: boolean;
      })[];
      /** Pictures can be uploaded (the PUT and its check are set up). */
      uploadEnabled: boolean;
      /** Objects can be deleted from the bucket. */
      deleteEnabled: boolean;
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
  async ({ platform, params, status, url }) => {
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
    const [camera, images, shared, photos, tags, tagNames] = await Promise.all([
      getCamera(db, id),
      listCameraImages(db, id),
      sharedCameraImages(db, id),
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
    const config = getUploadConfig(platform);
    return {
      kind: "ok",
      camera,
      images: images.map((img) => ({
        ...img,
        deletable: objectDeletable(img.file, shared.has(img.id)),
      })),
      uploadEnabled:
        config !== null && getObjectStat(platform, url, null) !== null,
      deleteEnabled: config !== null,
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
      if (err instanceof PathBusyError) {
        return fail(409, {
          message: `${v.image.file} はアップロードか削除の途中です`,
        });
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

/**
 * The pictures in a new order (↑ / ↓, 既定にする, a drag, or 元に戻す):
 * every picture's id, the default first. Returns the order before.
 */
export const useCameraImageOrder = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = parseId(params.id);
    if (id === null) return fail(400, { message: "invalid id" });
    const r = await setCameraImageOrder(getDB(platform), id, data.order);
    if (r.kind === "stale") {
      return fail(409, {
        message: "画像が変わっています。再読み込みしてください",
      });
    }
    return { ok: true as const, previous: r.previous };
  },
  zod$({
    order: z.array(z.number().int().positive()).max(1000),
  }),
);

/** Reloads the page data (after uploads). */
export const useRefresh = routeAction$(() => ({ ok: true }));

/** Remove / delete / re-caption one picture of this camera. */
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
      // The picture and every version of its object, for good, when
      // nothing else uses that object.
      const config = getUploadConfig(platform);
      if (!config) {
        return fail(503, { message: "削除が設定されていません" });
      }
      const first = await getCameraImage(db, id, imageId);
      if (!first) return fail(404, { message: "image not found" });
      // Hold the path (no new picture can be added at it meanwhile,
      // addCameraImage), then make sure nothing else uses it. The claim's
      // token is this request's own, so a second 削除 of it at once (or
      // an upload) cannot take it too.
      const token = `delete:${crypto.randomUUID()}`;
      if (!(await reservePictureName(db, first.file, id, token, new Date()))) {
        return fail(409, {
          message: "アップロードか削除の途中のファイルです",
        });
      }
      const image = await getCameraImage(db, id, imageId);
      if (!image || !objectDeletable(image.file, image.shared)) {
        await releasePictureName(db, first.file);
        return fail(409, { message: "ほかでも使われているファイルです" });
      }
      try {
        await deleteAllVersions(config, image.file);
      } catch (err) {
        await releasePictureName(db, image.file);
        if (err instanceof DeletePermissionError) {
          return fail(403, { message: err.message });
        }
        throw err;
      }
      // With the claim's release and the content version (one batch).
      await deleteCameraImageRow(db, id, imageId, image.file, new Date());
      return { ok: true, op: data.op };
    }
    if (!done) return fail(404, { message: "image not found" });
    await contentChanged(db);
    return { ok: true, op: data.op };
  },
  zod$({
    image_id: z.string().max(20),
    op: z.enum(["remove", "caption", "delete"]),
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
      if (err instanceof PathBusyError) {
        return fail(409, {
          message: `${v.image.file} は削除されたか、アップロードの途中です`,
        });
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
        パス
      </label>
      <input
        id="new-image-file"
        type="text"
        name="file"
        required
        placeholder={`${cameraImageDir(slug)}front.png`}
        autoCapitalize="off"
        autoCorrect="off"
        spellcheck={false}
        enterKeyHint="next"
        aria-describedby="new-image-file-error"
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
  remove: "外しました。",
  delete: "削除しました。",
  caption: "キャプションを保存しました。",
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
          message: `追加できませんでした: ${v.message ?? "unknown error"}`,
        }
      : { tone: "success", message: "追加しました。" };
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
  /** The pictures' order before the last change of it, for 「元に戻す」. */
  const orderUndo = useSignal<number[] | null>(null);
  const orderAction = useCameraImageOrder();
  /** Put the pictures in `order`; an undo offers no undo of its own. */
  const reorder = $(async (order: number[], message: string, undo = false) => {
    const r = await orderAction.submit({ order }).catch(() => null);
    if (!r || r.value.failed) {
      toast.value = {
        tone: "error",
        message:
          (r && "message" in r.value ? String(r.value.message) : "") ||
          "並べ替えられませんでした",
        actionLabel: undo && orderUndo.value ? "元に戻す" : undefined,
      };
      return;
    }
    removed.value = null;
    photoUndo.value = null;
    tagUndo.value = null;
    orderUndo.value = undo ? null : (r.value.previous ?? null);
    toast.value = {
      tone: "success",
      message,
      actionLabel: undo ? undefined : "元に戻す",
    };
  });
  /** The picture being dragged to a new place, and where it would land. */
  const dragId = useSignal<number | null>(null);
  const dropAt = useSignal<{ index: number; after: boolean } | null>(null);
  const refresh = useRefresh();
  const uploader = useUploader(
    $(() => refresh.submit()),
    data.value.kind === "ok" ? data.value.camera.id : undefined,
  );
  useTask$(({ track }) => {
    const v = track(() => imageOp.value);
    if (!v) return;
    if (v.failed) {
      toast.value = {
        tone: "error",
        message: `変更できませんでした: ${v.message ?? "unknown error"}`,
      };
      return;
    }
    if (v.op === "remove" || v.op === "delete") {
      removed.value = v.removed ?? null;
      photoUndo.value = null;
      tagUndo.value = null;
      orderUndo.value = null;
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
    orderUndo.value = null;
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
    orderUndo.value = null;
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
    const order = orderUndo.value;
    if (order) {
      // Kept until it goes through (reorder clears it then).
      await reorder(order, "元に戻しました。", true);
      return;
    }
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

  const {
    camera,
    images,
    photos,
    imageBase,
    tags,
    tagNames,
    uploadEnabled,
    deleteEnabled,
  } = data.value;
  const opRunning = (key: string) => imageOp.isRunning && busyKey.value === key;
  const imageIds = images.map((img) => img.id);
  const orderBusy = orderAction.isRunning;

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

      <DropZone
        uploader={uploader}
        dir={cameraImageDir(camera.slug)}
        enabled={uploadEnabled}
        label="ここにドロップしてアップロード"
        onProblem$={(message) => {
          toast.value = { tone: "error", message };
        }}
      >
        <section
          aria-labelledby="images-heading"
          data-testid="camera-images"
          class={[card, "space-y-5 p-5"]}
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 id="images-heading" class={legend}>
              画像 ({images.length})
            </h2>
            <div class="flex gap-2">
              {images.length > 1 && (
                <button
                  type="button"
                  onClick$={() => (ordering.value = !ordering.value)}
                  class={[buttonSecondary, "shrink-0 sm:hidden"]}
                >
                  {ordering.value ? "完了" : "並べ替え"}
                </button>
              )}
              {uploadEnabled && (
                <UploadButton
                  uploader={uploader}
                  dir={cameraImageDir(camera.slug)}
                  label="アップロード"
                  class="shrink-0"
                />
              )}
            </div>
          </div>

          <UploadPanel uploader={uploader} />

          {images.length > 0 && (
            <ol class="divide-y divide-zinc-100 dark:divide-zinc-800">
              {images.map((img, i) => (
                <li
                  key={img.id}
                  data-testid="camera-image"
                  data-default={i === 0 ? "" : undefined}
                  // A picture dragged by its handle lands above or below the
                  // row under the pointer.
                  preventdefault:dragover
                  preventdefault:drop
                  onDragOver$={(e: DragEvent, el: HTMLElement) => {
                    if (dragId.value === null) return;
                    const r = el.getBoundingClientRect();
                    const after = e.clientY > r.top + r.height / 2;
                    if (
                      dropAt.value?.index !== i ||
                      dropAt.value.after !== after
                    ) {
                      dropAt.value = { index: i, after };
                    }
                  }}
                  data-index={i}
                  onDrop$={[
                    // Read during the event (the drag's data and its start,
                    // set synchronously there): the handler below may run
                    // after the dragend, and before any dragover one did.
                    sync$((e: DragEvent, row: HTMLElement) => {
                      const b = document.body.dataset;
                      const types = Array.from(e.dataTransfer?.types ?? []);
                      if (
                        !types.includes("application/x-camera-image") ||
                        !b.cameraImageDrag
                      ) {
                        return;
                      }
                      const r = row.getBoundingClientRect();
                      const after = e.clientY > r.top + r.height / 2;
                      b.cameraImageDrop = `${b.cameraImageDrag}:${row.dataset.index}:${after ? 1 : 0}`;
                    }),
                    $(() => {
                      const drop = document.body.dataset.cameraImageDrop;
                      delete document.body.dataset.cameraImageDrop;
                      dragId.value = null;
                      dropAt.value = null;
                      if (!drop) return;
                      const [id, over, after] = drop.split(":").map(Number);
                      if (!imageIds.includes(id)) return;
                      const order = moveToIndex(
                        imageIds,
                        id,
                        dropIndex(imageIds.indexOf(id), over, after === 1),
                      );
                      if (order) void reorder(order, "並べ替えました。");
                    }),
                  ]}
                  class={[
                    // Phones: the buttons in a row of their own; from sm
                    // up, under the path and caption.
                    "relative flex flex-wrap gap-3 py-3 first:pt-0 sm:grid sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:items-start",
                    dragId.value === img.id && "opacity-50",
                  ]}
                >
                  {dropAt.value?.index === i && dragId.value !== null && (
                    <span
                      aria-hidden="true"
                      class={[
                        "pointer-events-none absolute inset-x-0 h-0.5 rounded bg-sky-500",
                        dropAt.value.after ? "-bottom-px" : "-top-px",
                      ]}
                    />
                  )}
                  <span
                    draggable={true}
                    title="ドラッグして並べ替え"
                    aria-hidden="true"
                    data-image-id={img.id}
                    onDragStart$={[
                      sync$((e: DragEvent) => {
                        const dt = e.dataTransfer;
                        const handle = e.target as HTMLElement;
                        if (!dt) return;
                        dt.effectAllowed = "move";
                        dt.setData("application/x-camera-image", "1");
                        document.body.dataset.cameraImageDrag =
                          handle.dataset.imageId;
                        const row = handle.closest("li");
                        if (row) dt.setDragImage(row, 24, 24);
                      }),
                      $(() => {
                        dragId.value = img.id;
                      }),
                    ]}
                    onDragEnd$={[
                      sync$(() => {
                        delete document.body.dataset.cameraImageDrag;
                      }),
                      $(() => {
                        dragId.value = null;
                        dropAt.value = null;
                      }),
                    ]}
                    class="hidden w-5 shrink-0 cursor-grab place-items-center self-stretch text-zinc-400 hover:text-zinc-600 sm:row-span-2 sm:grid dark:hover:text-zinc-300"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" class="size-4">
                      <path d="M7 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm-1.5 7.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM16 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm-1.5 7.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM16 16a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
                    </svg>
                  </span>
                  <div class="relative shrink-0 sm:row-span-2">
                    <Thumb
                      file={img.file}
                      platform={null}
                      imageBase={imageBase}
                      variant="list"
                      exact
                      large
                      class="w-28 rounded-md sm:w-48"
                    />
                    {i === 0 && (
                      <span
                        data-testid="default-mark"
                        class="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded-full bg-sky-600 px-2 py-0.5 text-xs font-semibold text-white shadow"
                      >
                        <svg
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden="true"
                          class="size-3"
                        >
                          <path d="M10.87 2.6a.97.97 0 0 0-1.74 0L7.3 6.42l-4.2.6a.97.97 0 0 0-.54 1.66l3.04 2.97-.72 4.18a.97.97 0 0 0 1.41 1.02L10 14.88l3.76 1.97a.97.97 0 0 0 1.41-1.02l-.72-4.18 3.04-2.97a.97.97 0 0 0-.54-1.66l-4.2-.6-1.88-3.82Z" />
                        </svg>
                        既定
                      </span>
                    )}
                  </div>
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
                        画像 {i + 1} のキャプション
                      </label>
                      <input
                        id={`image-caption-${img.id}`}
                        type="text"
                        name="caption"
                        value={img.caption ?? ""}
                        placeholder="キャプション"
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
                  <div class="flex w-full flex-wrap justify-end gap-1 sm:col-start-3 sm:justify-start">
                    {i > 0 && (
                      <button
                        type="button"
                        disabled={orderBusy}
                        aria-label={`画像 ${i + 1} を既定にする`}
                        onClick$={() => {
                          const order = orderAfter(imageIds, img.id, "default");
                          if (order) void reorder(order, "既定にしました。");
                        }}
                        class={[buttonSecondary, "px-3"]}
                      >
                        既定にする
                      </button>
                    )}
                    {(
                      [
                        ["up", "↑", `画像 ${i + 1} を上へ`, i === 0],
                        [
                          "down",
                          "↓",
                          `画像 ${i + 1} を下へ`,
                          i === images.length - 1,
                        ],
                      ] as const
                    ).map(([op, text, aria, atEnd]) => (
                      <button
                        key={op}
                        type="button"
                        aria-label={aria}
                        disabled={atEnd || orderBusy}
                        onClick$={() => {
                          const order = orderAfter(imageIds, img.id, op);
                          if (order) void reorder(order, "並べ替えました。");
                        }}
                        class={[
                          buttonSecondary,
                          "px-3 disabled:cursor-not-allowed disabled:opacity-40",
                          !ordering.value && "max-sm:hidden",
                        ]}
                      >
                        {text}
                      </button>
                    ))}
                    <Form
                      action={imageOp}
                      onSubmit$={() => {
                        busyKey.value = `${img.id}:remove`;
                      }}
                      aria-busy={opRunning(`${img.id}:remove`)}
                    >
                      <input type="hidden" name="image_id" value={img.id} />
                      <input type="hidden" name="op" value="remove" />
                      <SubmitButton
                        running={opRunning(`${img.id}:remove`)}
                        aria-label={`画像 ${i + 1} を外す`}
                        class={[buttonSecondary, "px-3"]}
                      >
                        外す
                      </SubmitButton>
                    </Form>
                    {deleteEnabled && img.deletable && (
                      <button
                        type="button"
                        aria-label={`画像 ${i + 1} を削除`}
                        disabled={imageOp.isRunning}
                        onClick$={async () => {
                          const name = img.file.slice(
                            img.file.lastIndexOf("/") + 1,
                          );
                          if (
                            !confirm(
                              `${name} を削除します。ファイルも消え、元に戻せません。`,
                            )
                          ) {
                            return;
                          }
                          busyKey.value = `${img.id}:delete`;
                          await imageOp.submit({
                            image_id: String(img.id),
                            op: "delete",
                            caption: "",
                          });
                        }}
                        class={[
                          buttonSecondary,
                          "px-3 text-red-700! hover:bg-red-50! dark:text-red-400! dark:hover:bg-red-950/40!",
                        ]}
                      >
                        {opRunning(`${img.id}:delete`) ? <Spinner /> : "削除"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {/* A file already in the bucket, by its path. */}
          <details
            data-testid="add-by-path"
            open={!uploadEnabled}
            class="border-t border-zinc-200 pt-4 dark:border-zinc-800"
          >
            <summary class="flex min-h-11 cursor-pointer items-center text-sm font-medium text-zinc-700 sm:min-h-0 dark:text-zinc-300">
              パスで追加
            </summary>
            <Form
              action={addImage}
              aria-busy={addImage.isRunning}
              // Clear the inputs only when the image was added; a rejected
              // path stays in the field to be fixed (spaReset would always
              // clear).
              onSubmitCompleted$={(ev, form) => {
                const { value } = ev.detail as { value?: { ok?: boolean } };
                if (value?.ok) form.reset();
              }}
              class="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start"
            >
              <ImagePathField slug={camera.slug} />
              <div>
                <label for="new-image-caption" class={label}>
                  キャプション
                </label>
                <input
                  id="new-image-caption"
                  type="text"
                  name="caption"
                  maxLength={MAX_IMAGE_CAPTION_LEN}
                  class={field}
                />
              </div>
              <SubmitButton
                running={addImage.isRunning}
                pendingLabel="追加中…"
                class={[buttonSecondary, "sm:mt-6"]}
              >
                追加
              </SubmitButton>
            </Form>
          </details>
        </section>
      </DropZone>
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
