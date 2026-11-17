import { component$ } from "@builder.io/qwik";
import {
  Form,
  Link,
  routeAction$,
  routeLoader$,
  zod$,
  z,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { MissingBindingError } from "~/components/missing-binding-error";
import { StatePanel } from "~/components/state-panel";
import {
  buttonPrimary,
  card,
  field,
  label,
  link,
  muted,
  worldBadge,
} from "~/components/ui";
import { getMedia, updateMedia } from "~/lib/db";
import { getDB } from "~/lib/env";
import { formatJst, splitPath } from "~/lib/format";
import type { MediaRow } from "~/lib/types";
import { parseTagsInput, validatePatch } from "~/lib/validate";

type MediaLoaderResult =
  | { kind: "ok"; row: MediaRow }
  | { kind: "missing-binding" }
  | { kind: "bad-request" }
  | { kind: "not-found" };

export const useMedia = routeLoader$<MediaLoaderResult>(
  async ({ platform, params, status }) => {
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
    const row = await getMedia(db, id);
    if (!row) {
      status(404);
      return { kind: "not-found" };
    }
    return { kind: "ok", row };
  },
);

export const useUpdateMedia = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return fail(400, { message: "invalid id" });
    }
    // Route the form data through the same validator the API uses so the
    // empty-string→null + paired-camera contract has a single source of truth.
    const v = validatePatch({
      world: data.world,
      camera_make: data.camera_make,
      camera_model: data.camera_model,
      tags: parseTagsInput(data.tags ?? ""),
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
    const updated = await updateMedia(db, id, v.patch);
    if (!updated) {
      return fail(404, { message: "not found" });
    }
    return { ok: true, updated_at: updated.updated_at };
  },
  zod$({
    world: z.enum(["Real", "VRChat"]),
    camera_make: z.string().max(200).default(""),
    camera_model: z.string().max(200).default(""),
    tags: z.string().max(2000).default(""),
  }),
);

export default component$(() => {
  const media = useMedia();
  const action = useUpdateMedia();

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

  const row = media.value.row;
  const { dir, base } = splitPath(row.file);
  const legend = "text-sm font-semibold text-zinc-900 dark:text-zinc-100";

  return (
    <div class="mx-auto max-w-3xl space-y-6">
      <div>
        <nav aria-label="Breadcrumb" class="text-sm">
          <Link href="/media/" class={link}>
            ← Media
          </Link>
        </nav>
        <div class="mt-2 flex flex-wrap items-center gap-3">
          <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
            Edit #{row.id}
          </h1>
          <span class={worldBadge(row.world)}>{row.world}</span>
        </div>
      </div>

      <dl
        class={[
          card,
          "grid gap-x-4 gap-y-1 p-5 text-sm sm:grid-cols-[8rem_1fr] sm:gap-y-4 [&>dd]:mb-3 sm:[&>dd]:mb-0 [&>dd:last-child]:mb-0",
        ]}
      >
        <dt class={["font-medium", muted]}>File</dt>
        <dd class="min-w-0" title={row.file}>
          <span class="block font-medium break-all">{base}</span>
          <span class={["block text-xs break-all", muted]}>{dir}</span>
        </dd>
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
        <dt class={["font-medium", muted]}>Last updated</dt>
        <dd title={row.updated_at} class="tabular-nums">
          {formatJst(row.updated_at)}{" "}
          <span class={["text-xs", muted]}>JST</span>
        </dd>
      </dl>

      <Form action={action} class={[card, "space-y-6 p-5"]}>
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
          <p class={["text-xs", muted]}>
            Set both or leave both empty for no camera.
          </p>
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label for="edit-camera-make" class={label}>
                Camera make
              </label>
              <input
                id="edit-camera-make"
                type="text"
                name="camera_make"
                value={row.camera_make ?? ""}
                placeholder="(empty for none)"
                maxLength={200}
                class={field}
              />
            </div>
            <div>
              <label for="edit-camera-model" class={label}>
                Camera model
              </label>
              <input
                id="edit-camera-model"
                type="text"
                name="camera_model"
                value={row.camera_model ?? ""}
                placeholder="(empty for none)"
                maxLength={200}
                class={field}
              />
            </div>
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
              class={field}
            />
            <p id="edit-tags-help" class={["mt-1 text-xs", muted]}>
              e.g. <code>VRChat, night</code>. Saved to D1 immediately; publish
              from the dashboard to update the public gallery.
            </p>
          </div>
        </fieldset>

        <div class="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <button type="submit" class={buttonPrimary}>
            Save
          </button>
          <div role="status" aria-live="polite" class="text-sm">
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
