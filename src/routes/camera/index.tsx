import { component$ } from "@builder.io/qwik";
import { routeLoader$, type DocumentHead } from "@builder.io/qwik-city";

import { CameraCard } from "~/components/gallery/camera-card";
import {
  cameraSummaries,
  type CameraSummary,
} from "~/components/gallery/cameras";
import { transformMediaInfo } from "~/components/gallery/types";
import { cameraListOgp, ogpHead, type Ogp } from "~/components/ogp";
import { useGalleryIndex } from "../layout";

type CameraList = { cameras: CameraSummary[]; ogp: Ogp };

/** Every camera that has public photos. */
export const useCameraList = routeLoader$<CameraList>(async (event) => {
  const { media, cameras } = await event.resolveValue(useGalleryIndex);
  return {
    cameras: cameraSummaries(media.map(transformMediaInfo), cameras),
    ogp: cameraListOgp(
      {
        s3Base: import.meta.env.VITE_S3_BASE_URL,
        imageBase: import.meta.env.VITE_IMAGE_BASE_URL,
      },
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
