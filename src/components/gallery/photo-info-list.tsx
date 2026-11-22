import { $, component$, Slot, sync$, type QRL } from "@builder.io/qwik";

import { splitTaken, type ExposureSpec, type PhotoInfo } from "./photo-info";
import type { TakenAt } from "./taken";

export type TagLink = { tag: string; href: string };

/** A click meant for a new tab or window. */
const isModified = (e: MouseEvent) =>
  e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;

// The site's link colour, underlined, so a link never reads as a plain
// value. `!`: the site's unlayered `a { color }` would win otherwise.
const LINK =
  "!text-(--color-accent) !underline decoration-(--color-accent)/40 underline-offset-[0.2em] hover:decoration-(--color-accent)";

/** After an off-site link's text: it leaves the gallery (a new tab). */
const External = component$(() => (
  <>
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class="ml-1 inline-block align-[-0.05em]"
    >
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
    <span class="sr-only">（外部サイト）</span>
  </>
));

/** A line under a row's main value. */
const DETAIL = "mt-0.5 text-sm text-white/65";

/** 24×24 stroke icons, one per kind of row. */
const ICON = {
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

const Icon = component$<{ icon: keyof typeof ICON; size?: number }>(
  ({ icon, size = 18 }) => (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={ICON[icon]} />
    </svg>
  ),
);

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
      <dt title={props.label} class="pt-px text-white/55">
        <Icon icon={props.icon} />
        <span class="sr-only">{props.label}</span>
      </dt>
      <Slot />
    </div>
  ),
);

/**
 * When a photo was taken, as the overlay and the photo page show it above
 * the photo: the date, and the time (at its public precision) lighter.
 */
export const TakenText = component$<{ taken: TakenAt }>(({ taken }) => {
  const { date, time } = splitTaken(taken.text);
  return (
    <time dateTime={taken.datetime}>
      {date}
      {time && " "}
      {time && <span class="ml-[0.2em] font-normal text-white/60">{time}</span>}
    </time>
  );
});

interface PhotoTitleProps {
  info: PhotoInfo;
  /** Larger, on the photo page. */
  large?: boolean;
  /** A heading (for screen readers) with this id: the overlay's info. */
  headingId?: string;
}

/**
 * Where the photo was taken, at the head of its info: the VRChat world (a
 * link to its page), or the place on the map. Its date is above the photo
 * (TakenText).
 */
export const PhotoTitle = component$<PhotoTitleProps>((props) => {
  const { world, location } = props.info;
  const page = props.large === true;
  return (
    <div class="flex flex-col gap-3 empty:hidden">
      {props.headingId && (
        // `!`: the site's unlayered h2 rule would win otherwise.
        <h2 id={props.headingId} class="sr-only !m-0">
          写真の情報
        </h2>
      )}
      {(world || location) && (
        <dl
          class={[
            "flex flex-wrap gap-x-5 gap-y-1.5",
            page ? "text-lg" : "text-[0.9375rem]",
          ]}
        >
          {world && (
            <div data-testid="info-world" class="flex items-center gap-2">
              <dt title="ワールド" class="text-white/55">
                <Icon icon="world" size={page ? 20 : 17} />
                <span class="sr-only">ワールド</span>
              </dt>
              <dd>
                {world.href ? (
                  <a
                    href={world.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    class={LINK}
                  >
                    {world.name}
                    <External />
                  </a>
                ) : (
                  world.name
                )}
              </dd>
            </div>
          )}
          {location && (
            <div data-testid="info-location" class="flex items-center gap-2">
              <dt title="撮影場所" class="text-white/55">
                <Icon icon="place" size={page ? 20 : 17} />
                <span class="sr-only">撮影場所</span>
              </dt>
              <dd>
                {/* Plain <a>: see the note in components/layout/header.tsx. */}
                <a href={location.href} class={[LINK, "tabular-nums"]}>
                  {location.label}
                </a>
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
});

/**
 * How the photo was exposed, as a camera's readout: one cell per setting,
 * its value large and its name small above it.
 */
export const ExposureSpecs = component$<{
  specs: ExposureSpec[];
  /** Larger, on the photo page. */
  large?: boolean;
}>((props) => (
  <div
    data-testid="info-exposure"
    class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-3"
  >
    <span title="撮影設定" class="text-white/55">
      <Icon icon="exposure" />
    </span>
    {/* One line, the values apart by thin rules, as a camera shows them;
        their names for screen readers. */}
    <dl
      aria-label="撮影設定"
      class={[
        "flex flex-wrap items-center gap-y-1 leading-snug tabular-nums",
        props.large ? "text-lg" : "text-[0.9375rem]",
      ]}
    >
      {props.specs.map((s, n) => (
        <div
          key={s.label}
          class={[
            "flex items-center whitespace-nowrap",
            n > 0 &&
              "before:mx-2.5 before:h-[0.9em] before:w-px before:bg-white/25 before:content-['']",
          ]}
        >
          <dt class="sr-only">{s.label}</dt>
          <dd data-testid="info-exposure-value">{s.value}</dd>
        </div>
      ))}
    </dl>
  </div>
));

interface PhotoInfoListProps {
  info: PhotoInfo;
  /** Each tag of the photo with the gallery URL filtered by it. */
  tagLinks: TagLink[];
  /**
   * Filter in place on a plain click (the overlay); without it the tags
   * are plain links (the photo page).
   */
  onTag$?: QRL<(tag: string) => void>;
  /** Its rows side by side on wide screens (the overlay's strip). */
  inline?: boolean;
}

/**
 * The rest of a photo's metadata, after its title and exposure, as a
 * description list, exactly as photoInfo() gives it (only what the API
 * returned): the camera, what it was scanned with, its tags and their
 * fields, and its file name. One row per kind, marked by an icon, with
 * the main value first and its details under it. The overlay's info and
 * the photo page show the same list.
 */
export const PhotoInfoList = component$<PhotoInfoListProps>((props) => {
  const i = props.info;
  return (
    <dl
      class={[
        "grid gap-y-4 text-[0.9375rem] leading-snug text-white [&_dd]:break-words",
        props.inline &&
          "lg:flex lg:flex-wrap lg:items-start lg:gap-x-8 lg:gap-y-3 lg:[&>*]:max-w-80",
      ]}
    >
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
                class="rounded-full bg-white/[0.07] px-3 py-1.5 text-[0.8125rem] leading-none !text-white/90 ring-1 ring-white/15 ring-inset hover:bg-white/15 hover:!text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
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
