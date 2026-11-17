import { component$, useSignal, useTask$ } from "@builder.io/qwik";
import {
  Form,
  Link,
  routeAction$,
  zod$,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { CameraFields, cameraFormSchema } from "~/components/camera-fields";
import { SubmitButton } from "~/components/submit-button";
import { Toast, type ToastState } from "~/components/toast";
import { backLink, buttonPrimary, card } from "~/components/ui";
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
      console.error("/camera/new action: getDB failed:", err);
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
    throw redirect(302, `/camera/${id}/?created=1`);
  },
  zod$(cameraFormSchema),
);

export default component$(() => {
  const action = useCreateCamera();
  const toast = useSignal<ToastState | null>(null);
  // Success redirects to the new camera; only failures land here.
  useTask$(({ track }) => {
    const v = track(() => action.value);
    if (v?.failed) {
      toast.value = {
        tone: "error",
        message: `Create failed: ${v.message ?? "unknown error"}`,
      };
    }
  });

  return (
    <div class="mx-auto max-w-3xl space-y-6">
      <div>
        <nav aria-label="Breadcrumb" class="text-sm">
          <Link href="/camera/" class={backLink}>
            ← Cameras
          </Link>
        </nav>
        <h1 class="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          New camera
        </h1>
      </div>

      <Form
        action={action}
        aria-busy={action.isRunning}
        class={[card, "space-y-6 p-5"]}
      >
        <CameraFields />
        <div class="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <SubmitButton
            running={action.isRunning}
            pendingLabel="作成中…"
            class={buttonPrimary}
          >
            Create
          </SubmitButton>
        </div>
      </Form>
      <Toast toast={toast} />
    </div>
  );
});

export const head: DocumentHead = {
  title: "New camera — Admin",
};
