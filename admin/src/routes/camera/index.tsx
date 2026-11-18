import { component$ } from "@builder.io/qwik";
import { Link, routeLoader$, type DocumentHead } from "@builder.io/qwik-city";
import { CAMERA_KIND_LABELS } from "~/components/camera-fields";
import { MissingBindingError } from "~/components/missing-binding-error";
import { StatePanel } from "~/components/state-panel";
import { buttonPrimary, card, kindBadge, muted } from "~/components/ui";
import { listCameras, type CameraListItem } from "~/lib/db";
import { getDB } from "~/lib/env";

type CameraListResult =
  { kind: "ok"; cameras: CameraListItem[] } | { kind: "missing-binding" };

export const useCameraList = routeLoader$<CameraListResult>(
  async ({ platform, status }) => {
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/camera loader: getDB failed:", err);
      status(500);
      return { kind: "missing-binding" };
    }
    return { kind: "ok", cameras: await listCameras(db) };
  },
);

const manufacturerModel = (c: CameraListItem): string | null =>
  [c.manufacturer, c.model].filter(Boolean).join(" ") || null;

export default component$(() => {
  const data = useCameraList();
  if (data.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/" />;
  }
  const { cameras } = data.value;

  return (
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
          Cameras <span class={["font-normal", muted]}>({cameras.length})</span>
        </h1>
        <Link prefetch="js" href="/camera/new/" class={buttonPrimary}>
          New camera
        </Link>
      </div>

      {cameras.length === 0 ? (
        <StatePanel
          tone="empty"
          level={2}
          title="No cameras yet"
          action={{ href: "/camera/new/", label: "Add the first camera" }}
        >
          <p>
            Register a camera here, then pick it on each photo&apos;s edit page.
          </p>
        </StatePanel>
      ) : (
        <ul class={[card, "divide-y divide-zinc-100 dark:divide-zinc-800"]}>
          {cameras.map((c) => (
            <li key={c.id}>
              <Link
                prefetch="js"
                href={`/camera/${c.id}/`}
                class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-sky-50/60 sm:px-5 dark:hover:bg-sky-950/30"
              >
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate font-medium">{c.name}</span>
                  <span class={["truncate text-xs", muted]}>
                    <code>{c.slug}</code>
                    {manufacturerModel(c) && <> · {manufacturerModel(c)}</>}
                  </span>
                </span>
                {c.kind && (
                  <span class={kindBadge}>{CAMERA_KIND_LABELS[c.kind]}</span>
                )}
                <span
                  class={["w-20 text-right text-sm tabular-nums", muted]}
                  data-testid="camera-photo-count"
                >
                  {c.photo_count} {c.photo_count === 1 ? "photo" : "photos"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

export const head: DocumentHead = {
  title: "Cameras — Admin",
};
