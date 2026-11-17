import { component$ } from "@builder.io/qwik";
import {
  Form,
  Link,
  routeAction$,
  routeLoader$,
  useLocation,
  zod$,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { CameraFields, cameraFormSchema } from "~/components/camera-fields";
import { MissingBindingError } from "~/components/missing-binding-error";
import { StatePanel } from "~/components/state-panel";
import { buttonPrimary, card, link, muted } from "~/components/ui";
import { getCamera, SlugConflictError, updateCamera } from "~/lib/db";
import { getDB } from "~/lib/env";
import { formatJst } from "~/lib/format";
import type { CameraRow } from "~/lib/types";
import { validateCamera } from "~/lib/validate";

type CameraLoaderResult =
  | { kind: "ok"; camera: CameraRow }
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
    const camera = await getCamera(db, id);
    if (!camera) {
      status(404);
      return { kind: "not-found" };
    }
    return { kind: "ok", camera };
  },
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

  const { camera } = data.value;
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
