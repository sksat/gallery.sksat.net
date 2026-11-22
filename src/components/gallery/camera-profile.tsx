import { component$, useSignal } from "@builder.io/qwik";

import { formatDateKey } from "@shared/calendar/calendar";

import { SiteNav } from "../layout/site-nav";
import { Manufacturer } from "./camera-header";
import {
  CAMERA_KIND_LABELS,
  CAMERA_LIST_HREF,
  type CameraFacts,
} from "./cameras";
import { GRID_CANDIDATES, imageUrl, srcSet, type PresetName } from "./images";
import { galleryUrl } from "./logic";
import { PhotoOverlay } from "./photo-overlay";
import { DEFAULT_TAG_MODE } from "./tags";
import type { CameraImageJSON, CameraJSON } from "./types";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

// The main picture is at most 448 × 336 CSS px.
const MAIN_CANDIDATES: [PresetName, string][] = [
  ["h480", "1x"],
  ["w1200", "2x"],
];

const alt = (camera: CameraJSON, img: CameraImageJSON) =>
  img.caption ? `${camera.name}: ${img.caption}` : camera.name;

/** "2023年12月2日 – 2024年3月5日", or the one date. */
const period = (first: string, last: string) =>
  first === last
    ? formatDateKey(first)
    : `${formatDateKey(first)} – ${formatDateKey(last)}`;

// Plain <a>s: see the note in components/layout/header.tsx.
const BackLinks = component$(() => (
  <div class="flex flex-wrap items-center gap-x-3">
    <nav aria-label="戻る" class="flex gap-4 text-sm">
      <a
        href={CAMERA_LIST_HREF}
        class="inline-flex min-h-11 items-center opacity-80 hover:opacity-100 sm:min-h-8"
      >
        ← カメラ一覧
      </a>
      <a
        href="/"
        class="inline-flex min-h-11 items-center opacity-80 hover:opacity-100 sm:min-h-8"
      >
        すべての写真
      </a>
    </nav>
    <SiteNav />
  </div>
));

/**
 * The camera a camera page (/camera/<slug>/) is about: its pictures (one
 * large, the others as thumbnails that bring it up; the large one opens in
 * the photo overlay), its name and maker, description, and a sheet of
 * what it is and what was taken with it. `taggedTags` are the camera's
 * tags some public photo has: they link to the gallery filtered by them.
 */
export const CameraProfile = component$<{
  camera: CameraJSON;
  facts: CameraFacts;
  taggedTags: string[];
}>(({ camera, facts, taggedTags }) => {
  const shown = useSignal(0);
  const opened = useSignal<string | null>(null);
  const main = camera.images.at(shown.value) ?? camera.images.at(0);
  const pictures = camera.images.length > 0;

  const rows: { label: string; value: string }[] = [];
  if (camera.kind)
    rows.push({ label: "種類", value: CAMERA_KIND_LABELS[camera.kind] });
  if (camera.model && camera.model !== camera.name)
    rows.push({ label: "機種", value: camera.model });
  if (facts.count > 0) rows.push({ label: "写真", value: `${facts.count} 枚` });
  if (facts.first !== null && facts.last !== null)
    rows.push({
      label: facts.first === facts.last ? "撮影日" : "撮影期間",
      value: period(facts.first, facts.last),
    });
  if (facts.digitized > 0)
    rows.push({ label: "スキャン", value: `${facts.digitized} 枚` });

  return (
    <section
      data-testid="camera-header"
      aria-labelledby="camera-name"
      class="px-1"
    >
      <BackLinks />
      <div
        class={[
          "mt-3 grid gap-x-10 gap-y-6",
          pictures && "md:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]",
        ]}
      >
        {main && (
          <div class="flex flex-col gap-2">
            <button
              type="button"
              data-testid="camera-image"
              class="block cursor-zoom-in overflow-hidden rounded bg-white/5"
              onClick$={() => (opened.value = main.file)}
            >
              <img
                key={main.file}
                src={imageUrl(S3_BASE, main.file, IMAGE_BASE, "h480")}
                srcset={srcSet(S3_BASE, main.file, IMAGE_BASE, MAIN_CANDIDATES)}
                alt={alt(camera, main)}
                // A fixed 4:3 box (the picture is letterboxed in it), so
                // nothing shifts when it loads or another is chosen.
                width={448}
                height={336}
                class="aspect-[4/3] h-auto w-full object-contain"
              />
            </button>
            {main.caption && <p class="text-sm opacity-70">{main.caption}</p>}
            {camera.images.length > 1 && (
              <ul class="flex flex-wrap gap-2" aria-label="カメラの画像">
                {camera.images.map((img, i) => (
                  <li key={img.file}>
                    <button
                      type="button"
                      data-testid="camera-thumb"
                      aria-pressed={img === main}
                      class={[
                        "block overflow-hidden rounded border-2 transition-colors",
                        img === main
                          ? "border-[var(--color-accent)]"
                          : "border-transparent opacity-80 hover:opacity-100",
                      ]}
                      onClick$={() => (shown.value = i)}
                    >
                      <img
                        src={imageUrl(S3_BASE, img.file, IMAGE_BASE, "h240")}
                        srcset={srcSet(
                          S3_BASE,
                          img.file,
                          IMAGE_BASE,
                          GRID_CANDIDATES,
                        )}
                        alt={alt(camera, img)}
                        loading="lazy"
                        width={80}
                        height={60}
                        class="h-15 w-20 object-cover"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div class="max-w-2xl min-w-0">
          <h1
            id="camera-name"
            class="text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            {camera.name}
          </h1>
          {camera.manufacturer && (
            <p data-testid="camera-maker" class="mt-1 text-lg opacity-80">
              <Manufacturer camera={camera} />
              {camera.manufacturerUrl && <span aria-hidden="true"> ↗</span>}
            </p>
          )}
          {camera.description && (
            <p class="mt-4 leading-relaxed whitespace-pre-line opacity-90">
              {camera.description}
            </p>
          )}
          {(rows.length > 0 || camera.tags.length > 0) && (
            <dl class="mt-5 text-sm" data-testid="camera-facts">
              {rows.map(({ label, value }) => (
                <div
                  key={label}
                  class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 border-t border-white/10 py-2"
                >
                  <dt class="opacity-60">{label}</dt>
                  <dd class="tabular-nums">{value}</dd>
                </div>
              ))}
              {camera.tags.length > 0 && (
                <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 border-t border-white/10 py-2">
                  <dt class="py-0.5 opacity-60">タグ</dt>
                  <dd>
                    <ul class="flex flex-wrap gap-1.5">
                      {camera.tags.map((tag) => (
                        <li key={tag}>
                          {taggedTags.includes(tag) ? (
                            <a
                              href={galleryUrl({
                                tags: [tag],
                                mode: DEFAULT_TAG_MODE,
                              })}
                              class="inline-block rounded-full border border-white/30 px-2.5 py-0.5 text-[var(--color-text)] hover:border-white/70"
                            >
                              {tag}
                            </a>
                          ) : (
                            <span class="inline-block rounded-full border border-white/15 px-2.5 py-0.5">
                              {tag}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          )}
          {camera.productUrl && (
            <p class="mt-3 text-sm">
              <a
                href={camera.productUrl}
                rel="noopener noreferrer"
                target="_blank"
                class="underline-offset-4 hover:underline"
              >
                製品ページ<span aria-hidden="true"> ↗</span>
              </a>
            </p>
          )}
        </div>
      </div>
      {opened.value && (
        <PhotoOverlay
          key={opened.value}
          src={opened.value}
          onClose$={() => (opened.value = null)}
          // The page URL stays /camera/<slug>/; there is no photo to link.
        />
      )}
    </section>
  );
});
