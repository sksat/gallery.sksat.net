import { component$ } from "@builder.io/qwik";
import { routeLoader$, type DocumentHead } from "@builder.io/qwik-city";

import { CameraCard } from "~/components/gallery/camera-card";
import {
  cameraSummaries,
  parseCameras,
  type CameraSummary,
} from "~/components/gallery/cameras";
import {
  transformMediaInfo,
  type MediaInfoJSON,
} from "~/components/gallery/types";
import { cameraListOgp, ogpHead, type Ogp } from "~/components/ogp";

type CameraList = { cameras: CameraSummary[]; ogp: Ogp };

/** Every camera that has photos, from cameras.json (or media.json alone). */
export const useCameraList = routeLoader$<CameraList>(async (event) => {
  const base = import.meta.env.VITE_S3_BASE_URL;
  // A 500 rather than an empty list: the layout lets responses be served
  // stale for a week, which must not pin a transient outage as "no cameras".
  let media: MediaInfoJSON[];
  const camerasReq = fetch(base + "/cameras.json").catch(() => null);
  try {
    const mediaRes = await fetch(base + "/media.json");
    if (!mediaRes.ok) throw new Error(`media.json: ${mediaRes.status}`);
    media = await mediaRes.json();
  } catch (error) {
    console.error("Failed to load media.json for the camera list:", error);
    throw event.error(500, "Failed to fetch media index");
  }
  // Optional: before the admin publishes it, media.json alone is enough.
  const camerasRes = await camerasReq;
  const cameras = camerasRes?.ok
    ? parseCameras(await camerasRes.json().catch(() => null))
    : null;
  return {
    cameras: cameraSummaries(media.map(transformMediaInfo), cameras),
    ogp: cameraListOgp(
      { s3Base: base, imageBase: import.meta.env.VITE_IMAGE_BASE_URL },
      media,
    ),
  };
});

export default component$(() => {
  const list = useCameraList();
  return (
    <div class="px-2 py-3 sm:px-3">
      <div class="mb-4 px-1">
        {/* Plain <a>: see the note in components/layout/header.tsx. */}
        <a href="/" class="text-sm opacity-80 hover:opacity-100">
          ← すべての写真
        </a>
        <h1 class="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          カメラ
        </h1>
      </div>
      {list.value.cameras.length === 0 ? (
        <p class="px-1 opacity-80">カメラの情報がまだありません。</p>
      ) : (
        <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {list.value.cameras.map((summary) => (
            <CameraCard key={summary.camera.slug} summary={summary} />
          ))}
        </ul>
      )}
    </div>
  );
});

export const head: DocumentHead = ({ resolveValue }) =>
  ogpHead(resolveValue(useCameraList).ogp);
