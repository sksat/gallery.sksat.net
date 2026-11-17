import { $, component$, useSignal } from "@builder.io/qwik";
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
import { Thumb } from "~/components/thumb";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  field,
  label,
  link,
  muted,
} from "~/components/ui";

const legend = "text-sm font-semibold text-zinc-900 dark:text-zinc-100";
import {
  addCameraImage,
  DuplicateImageError,
  getCamera,
  listCameraImages,
  moveCameraImage,
  removeCameraImage,
  SlugConflictError,
  updateCamera,
  updateCameraImageCaption,
} from "~/lib/db";
import { getDB, getImageBase } from "~/lib/env";
import { formatJst } from "~/lib/format";
import type { CameraImageRow, CameraRow } from "~/lib/types";
import {
  MAX_IMAGE_CAPTION_LEN,
  MAX_IMAGE_FILE_LEN,
  validateCamera,
  validateCameraImage,
} from "~/lib/validate";

type CameraLoaderResult =
  | {
      kind: "ok";
      camera: CameraRow;
      images: CameraImageRow[];
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
      console.error("/cameras/[id] loader: getDB failed:", err);
      status(500);
      return { kind: "missing-binding" };
    }
    const [camera, images] = await Promise.all([
      getCamera(db, id),
      listCameraImages(db, id),
    ]);
    if (!camera) {
      status(404);
      return { kind: "not-found" };
    }
    return { kind: "ok", camera, images, imageBase: getImageBase(platform) };
  },
);

export const useAddCameraImage = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = parseId(params.id);
    if (id === null) return fail(400, { message: "invalid id" });
    const v = validateCameraImage(data);
    if (!v.ok) return fail(400, { message: v.error });
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/cameras/[id] add image: getDB failed:", err);
      return fail(500, { message: "D1 binding unavailable" });
    }
    if (!(await getCamera(db, id))) return fail(404, { message: "not found" });
    try {
      await addCameraImage(db, id, v.image);
    } catch (err) {
      if (err instanceof DuplicateImageError) {
        return fail(409, { message: `${v.image.file} is already added` });
      }
      throw err;
    }
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
      console.error("/cameras/[id] image op: getDB failed:", err);
      return fail(500, { message: "D1 binding unavailable" });
    }
    let done: boolean;
    if (data.op === "caption") {
      const v = validateCameraImage({ file: "/x.png", caption: data.caption });
      if (!v.ok) return fail(400, { message: v.error });
      done = await updateCameraImageCaption(db, id, imageId, v.image.caption);
    } else if (data.op === "remove") {
      done = await removeCameraImage(db, id, imageId);
    } else {
      // Already first/last is a no-op, not an error.
      done = await moveCameraImage(db, id, imageId, data.op);
    }
    if (!done) return fail(404, { message: "image not found" });
    return { ok: true };
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
      console.error("/cameras/[id] action: getDB failed:", err);
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
    return { ok: true, updated_at: updated.updated_at };
  },
  zod$(cameraFormSchema),
);

export default component$(() => {
  const data = useCamera();
  const action = useUpdateCamera();
  const addImage = useAddCameraImage();
  const imageOp = useCameraImageOp();
  const lastImageAction = useSignal<"add" | "op" | null>(null);
  const markOp = $(() => {
    lastImageAction.value = "op";
  });
  const loc = useLocation();

  if (data.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/cameras/" />;
  }
  if (data.value.kind === "bad-request") {
    return (
      <StatePanel
        tone="error"
        title="Invalid id"
        action={{ href: "/cameras/", label: "← Back to cameras" }}
      >
        <p>
          The id in the URL must be a positive integer, like{" "}
          <code>/cameras/1/</code>.
        </p>
      </StatePanel>
    );
  }
  if (data.value.kind === "not-found") {
    return (
      <StatePanel
        tone="error"
        title="Not found"
        action={{ href: "/cameras/", label: "← Back to cameras" }}
      >
        <p>No camera has this id.</p>
      </StatePanel>
    );
  }

  const { camera, images, imageBase } = data.value;
  // Fresh from /cameras/new/ (and not yet re-saved here).
  const created = loc.url.searchParams.has("created") && !action.value;

  return (
    <div class="mx-auto max-w-3xl space-y-6">
      <div>
        <nav aria-label="Breadcrumb" class="text-sm">
          <Link href="/cameras/" class={link}>
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

      <Form action={action} class={[card, "space-y-6 p-5"]}>
        <CameraFields values={camera} />
        <div class="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <button type="submit" class={buttonPrimary}>
            Save
          </button>
          <div role="status" aria-live="polite" class="text-sm">
            {created && (
              <p class="text-emerald-700 dark:text-emerald-400">
                Camera created.
              </p>
            )}
            {action.value?.ok && (
              <p class="text-emerald-700 dark:text-emerald-400">
                Saved at {formatJst(action.value.updated_at)} JST.
              </p>
            )}
          </div>
          {action.value?.failed && (
            <p role="alert" class="text-sm text-red-700 dark:text-red-400">
              Save failed: {action.value.message ?? "unknown error"}
            </p>
          )}
        </div>
      </Form>

      <section aria-labelledby="images-heading" class={[card, "space-y-5 p-5"]}>
        <div>
          <h2 id="images-heading" class={legend}>
            Images
          </h2>
          <p class={["mt-1 text-xs", muted]}>
            Pictures of the camera itself, shown on its public page in this
            order. There is no upload yet: put the file in the B2 bucket first,
            then add its path here.
          </p>
        </div>

        {images.length > 0 && (
          <ol class="divide-y divide-zinc-100 dark:divide-zinc-800">
            {images.map((img, i) => (
              <li
                key={img.id}
                data-testid="camera-image"
                class="flex flex-col gap-3 py-3 first:pt-0 sm:flex-row sm:items-start"
              >
                <Thumb
                  file={img.file}
                  world={null}
                  imageBase={imageBase}
                  variant="list"
                  class="w-40 rounded-md"
                />
                <div class="min-w-0 flex-1 space-y-2">
                  <code class="block text-xs break-all">{img.file}</code>
                  <Form action={imageOp} onSubmit$={markOp} class="flex gap-2">
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
                      class={field}
                    />
                    <button
                      type="submit"
                      aria-label={`Save caption of image ${i + 1}`}
                      class={buttonSecondary}
                    >
                      Save
                    </button>
                  </Form>
                </div>
                <div class="flex gap-1">
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
                    <Form key={op} action={imageOp} onSubmit$={markOp}>
                      <input type="hidden" name="image_id" value={img.id} />
                      <input type="hidden" name="op" value={op} />
                      <button
                        type="submit"
                        aria-label={aria}
                        disabled={disabled}
                        class={[
                          buttonSecondary,
                          "disabled:cursor-not-allowed disabled:opacity-40",
                        ]}
                      >
                        {text}
                      </button>
                    </Form>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}

        <Form
          action={addImage}
          onSubmit$={() => {
            lastImageAction.value = "add";
          }}
          // Clear the inputs only when the image was added; a rejected path
          // stays in the field to be fixed (spaReset would always clear).
          onSubmitCompleted$={(ev, form) => {
            const { value } = ev.detail as { value?: { ok?: boolean } };
            if (value?.ok) form.reset();
          }}
          class="grid gap-3 border-t border-zinc-200 pt-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end dark:border-zinc-800"
        >
          <div>
            <label for="new-image-file" class={label}>
              Image path
            </label>
            <input
              id="new-image-file"
              type="text"
              name="file"
              required
              placeholder="/cameras/name.png"
              maxLength={MAX_IMAGE_FILE_LEN}
              class={field}
            />
          </div>
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
          <button type="submit" class={buttonPrimary}>
            Add image
          </button>
        </Form>
        {/* Only the latest image action's error: an old failure must not
            linger after a later action succeeded. */}
        {lastImageAction.value === "add" && addImage.value?.failed && (
          <p role="alert" class="text-sm text-red-700 dark:text-red-400">
            Add failed: {addImage.value.message ?? "unknown error"}
          </p>
        )}
        {lastImageAction.value === "op" && imageOp.value?.failed && (
          <p role="alert" class="text-sm text-red-700 dark:text-red-400">
            Update failed: {imageOp.value.message ?? "unknown error"}
          </p>
        )}
      </section>
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
