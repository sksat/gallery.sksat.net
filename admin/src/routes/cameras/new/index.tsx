import { component$ } from "@builder.io/qwik";
import {
  Form,
  Link,
  routeAction$,
  zod$,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { CameraFields, cameraFormSchema } from "~/components/camera-fields";
import { buttonPrimary, card, link } from "~/components/ui";
import { createCamera, SlugConflictError } from "~/lib/db";
import { getDB } from "~/lib/env";
import { validateCamera } from "~/lib/validate";

export const useCreateCamera = routeAction$(
  async (data, { platform, fail, redirect }) => {
    const v = validateCamera(data);
    if (!v.ok) {
      return fail(400, { message: v.error });
    }
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/cameras/new action: getDB failed:", err);
      return fail(500, { message: "D1 binding unavailable" });
    }
    let id: number;
    try {
      id = (await createCamera(db, v.camera)).id;
    } catch (err) {
      if (err instanceof SlugConflictError) {
        return fail(409, { message: `slug “${v.camera.slug}” is taken` });
      }
      throw err;
    }
    throw redirect(302, `/cameras/${id}/?created=1`);
  },
  zod$(cameraFormSchema),
);

export default component$(() => {
  const action = useCreateCamera();

  return (
    <div class="mx-auto max-w-3xl space-y-6">
      <div>
        <nav aria-label="Breadcrumb" class="text-sm">
          <Link href="/cameras/" class={link}>
            ← Cameras
          </Link>
        </nav>
        <h1 class="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          New camera
        </h1>
      </div>

      <Form action={action} class={[card, "space-y-6 p-5"]}>
        <CameraFields />
        <div class="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <button type="submit" class={buttonPrimary}>
            Create
          </button>
          {action.value?.failed && (
            <p role="alert" class="text-sm text-red-700 dark:text-red-400">
              Create failed: {action.value.message ?? "unknown error"}
            </p>
          )}
        </div>
      </Form>
    </div>
  );
});

export const head: DocumentHead = {
  title: "New camera — Admin",
};
