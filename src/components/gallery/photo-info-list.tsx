import {
  $,
  component$,
  Fragment,
  Slot,
  sync$,
  type QRL,
} from "@builder.io/qwik";

import type { PhotoInfo } from "./photo-info";

export type TagLink = { tag: string; href: string };

/** A click meant for a new tab or window. */
const isModified = (e: MouseEvent) =>
  e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;

// `!`: the site's unlayered `a { color }` would win otherwise. White text
// with a quiet underline, so the links do not outshine the photo.
const LINK =
  "!text-white underline decoration-white/30 underline-offset-[0.2em] hover:decoration-white";

/** A line under a row's main value. */
const DETAIL = "mt-0.5 text-sm text-white/65";

/** 24×24 stroke icons, one per kind of row. */
const ICON = {
  calendar: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  // An aperture.
  exposure:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM14.31 8l5.74 9.94M9.69 8h11.48M7.38 12l5.74-9.94M9.69 16 3.95 6.06M14.31 16H2.83M16.62 12l-5.74 9.94",
  // A scanner's frame.
  scan: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10",
  world:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20",
  place:
    "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  tag: "M3 3h8l10 10-8 8L3 11zM7.5 7.5h.01",
  file: "M14 3H6v18h12V7zM14 3v4h4",
} as const;

/**
 * One row: the kind's icon (its name for screen readers and as a tooltip)
 * and the values beside it.
 */
const Row = component$<{ icon: keyof typeof ICON; label: string; id: string }>(
  (props) => (
    <div
      data-testid={props.id}
      class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3"
    >
      <dt title={props.label} class="pt-px text-white/45">
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d={ICON[props.icon]} />
        </svg>
        <span class="sr-only">{props.label}</span>
      </dt>
      <Slot />
    </div>
  ),
);

interface PhotoInfoListProps {
  info: PhotoInfo;
  /** Each tag of the photo with the gallery URL filtered by it. */
  tagLinks: TagLink[];
  /**
   * Filter in place on a plain click (the overlay); without it the tags
   * are plain links (the photo page).
   */
  onTag$?: QRL<(tag: string) => void>;
}

/**
 * A photo's metadata as a description list, exactly as photoInfo() gives
 * it (only what the API returned): the overlay's info panel and the photo
 * page show the same list. One row per kind, marked by an icon, with the
 * main value first and its details under it.
 */
export const PhotoInfoList = component$<PhotoInfoListProps>((props) => {
  const i = props.info;
  return (
    <dl class="grid gap-y-4 text-[0.9375rem] leading-snug text-white [&_dd]:break-words">
      {i.taken && (
        <Row icon="calendar" label="撮影日時" id="info-taken">
          <dd class="tabular-nums">
            <time dateTime={i.taken.datetime}>{i.taken.text}</time>
          </dd>
        </Row>
      )}
      {(i.camera || i.body || i.lens) && (
        <Row icon="camera" label="カメラ" id="info-camera">
          {i.camera && (
            <dd>
              {i.camera.href ? (
                <a href={i.camera.href} class={LINK}>
                  {i.camera.label}
                </a>
              ) : (
                i.camera.label
              )}
            </dd>
          )}
          {/* Under the camera's name, or on their own (the photo page
              shows the camera in a card). */}
          {i.body && (
            <dd class={["col-start-2", i.camera && DETAIL]}>{i.body}</dd>
          )}
          {i.lens && (
            <dd
              data-testid="info-lens"
              class={["col-start-2", (i.camera || i.body) && DETAIL]}
            >
              {i.lens}
            </dd>
          )}
        </Row>
      )}
      {i.exposure && (
        <Row icon="exposure" label="撮影設定" id="info-exposure">
          {/* Each value apart, like a camera's own readout. */}
          <dd class="flex flex-wrap gap-x-3.5 gap-y-0.5 tabular-nums">
            {i.exposure.map((part, n) => (
              <Fragment key={part}>
                {/* Read apart, too. */}
                {n > 0 && <span class="sr-only">, </span>}
                <span data-testid="info-exposure-value">{part}</span>
              </Fragment>
            ))}
          </dd>
        </Row>
      )}
      {i.digitizer && (
        <Row icon="scan" label="スキャン機材" id="info-digitizer">
          <dd>
            {i.digitizer.href ? (
              <a href={i.digitizer.href} class={LINK}>
                {i.digitizer.label}
              </a>
            ) : (
              i.digitizer.label
            )}
          </dd>
          {i.digitized && (
            <dd
              data-testid="info-digitized"
              class={["col-start-2 tabular-nums", DETAIL]}
            >
              <span class="sr-only">スキャン日時 </span>
              <time dateTime={i.digitized.datetime}>{i.digitized.text}</time>
            </dd>
          )}
        </Row>
      )}
      {!i.digitizer && i.digitized && (
        <Row icon="scan" label="スキャン日時" id="info-digitized">
          <dd class="tabular-nums">
            <time dateTime={i.digitized.datetime}>{i.digitized.text}</time>
          </dd>
        </Row>
      )}
      {i.world && (
        <Row icon="world" label="ワールド" id="info-world">
          <dd>
            {i.world.href ? (
              <a
                href={i.world.href}
                target="_blank"
                rel="noopener noreferrer"
                class={LINK}
              >
                {i.world.name}
              </a>
            ) : (
              i.world.name
            )}
          </dd>
        </Row>
      )}
      {i.location && (
        <Row icon="place" label="撮影場所" id="info-location">
          <dd>
            {/* Plain <a>: see the note in components/layout/header.tsx. */}
            <a href={i.location.href} class={[LINK, "tabular-nums"]}>
              {i.location.label}
            </a>
          </dd>
        </Row>
      )}
      {i.tags.length > 0 && (
        <Row icon="tag" label="タグ" id="info-tags">
          <dd class="-mt-0.5 flex flex-wrap gap-1.5">
            {props.tagLinks.map(({ tag, href }) => (
              <a
                key={tag}
                href={href}
                data-testid="info-tag"
                // A plain click filters in place; a modified one (new tab
                // or window) is left to the browser.
                onClick$={
                  props.onTag$ && [
                    // sync$ is serialized as source: no outside names
                    // (the same test as isModified).
                    sync$((e: MouseEvent) => {
                      if (
                        e.button === 0 &&
                        !e.ctrlKey &&
                        !e.metaKey &&
                        !e.shiftKey &&
                        !e.altKey
                      )
                        e.preventDefault();
                    }),
                    $((event: MouseEvent) => {
                      if (!isModified(event)) props.onTag$?.(tag);
                    }),
                  ]
                }
                class="rounded-full bg-white/[0.07] px-2.5 py-1 text-[0.8125rem] leading-none !text-white/90 ring-1 ring-white/15 ring-inset hover:bg-white/15 hover:!text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              >
                {tag}
              </a>
            ))}
          </dd>
        </Row>
      )}
      {i.tagFields.map((g) => (
        // A tag's fields under its name: 「フィルム」 銘柄 Portra 400 …
        <div
          key={g.tag}
          data-testid="info-tag-fields"
          class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3"
        >
          <dt class="col-start-2 text-sm text-white/55">{g.tag}</dt>
          <dd class="col-start-2">
            <dl class="mt-1 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1">
              {g.fields.map((f) => (
                <div key={f.label} class="contents">
                  <dt class="text-sm text-white/55">{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </dd>
        </div>
      ))}
      {i.file && (
        <Row icon="file" label="ファイル名" id="info-file">
          <dd class="pt-0.5 font-mono text-xs text-white/65">{i.file}</dd>
        </Row>
      )}
    </dl>
  );
});
