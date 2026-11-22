import { $, component$, Slot, sync$, type QRL } from "@builder.io/qwik";

import { splitTaken, type ExposureSpec, type PhotoInfo } from "./photo-info";

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
      <dt title={props.label} class="pt-px text-white/45">
        <Icon icon={props.icon} />
        <span class="sr-only">{props.label}</span>
      </dt>
      <Slot />
    </div>
  ),
);

interface PhotoTitleProps {
  info: PhotoInfo;
  /** The heading's level: 1 on the photo page, 2 in the overlay. */
  level: 1 | 2;
  id: string;
}

/**
 * The photo's title block: its date as the heading (the time set lighter),
 * and where it was taken under it: the VRChat world, or the place on the
 * map. Without a public date the heading is for screen readers only.
 */
export const PhotoTitle = component$<PhotoTitleProps>((props) => {
  const { taken, world, location } = props.info;
  const page = props.level === 1;
  const parts = taken ? splitTaken(taken.text) : null;
  // `!`: the site's unlayered h2 rule would win otherwise.
  const headingClass = [
    "!m-0 leading-none !font-semibold tracking-tight tabular-nums",
    page ? "!text-4xl sm:!text-5xl" : "!text-[1.75rem]",
    taken ? "" : "sr-only",
  ];
  const heading =
    taken && parts ? (
      <time dateTime={taken.datetime}>
        {parts.date}
        {parts.time && " "}
        {parts.time && (
          <span
            class={[
              "font-normal text-white/55",
              page ? "ml-1.5 text-[0.6em]" : "ml-1 text-[0.65em]",
            ]}
          >
            {parts.time}
          </span>
        )}
      </time>
    ) : (
      "写真"
    );
  const H = page ? "h1" : "h2";
  return (
    <div class="flex flex-col gap-3">
      <H
        id={props.id}
        data-testid={taken ? "info-taken" : undefined}
        class={headingClass}
      >
        {heading}
      </H>
      {(world || location) && (
        <dl
          class={[
            "flex flex-wrap gap-x-5 gap-y-1.5",
            page ? "text-lg" : "text-[0.9375rem]",
          ]}
        >
          {world && (
            <div data-testid="info-world" class="flex items-center gap-2">
              <dt title="ワールド" class="text-white/45">
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
              <dt title="撮影場所" class="text-white/45">
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
  <dl
    data-testid="info-exposure"
    aria-label="撮影設定"
    class="grid divide-x divide-white/10 overflow-hidden rounded-xl bg-white/[0.06] ring-1 ring-white/10 ring-inset"
    style={{
      gridTemplateColumns: `repeat(${props.specs.length}, minmax(0, 1fr))`,
    }}
  >
    {props.specs.map((s) => (
      <div
        key={s.label}
        class={[
          "flex flex-col gap-1",
          props.large ? "px-4 py-3" : "px-2.5 py-2",
        ]}
      >
        <dt class="text-[0.6875rem] leading-none text-white/50">{s.label}</dt>
        <dd
          data-testid="info-exposure-value"
          class={[
            "leading-tight font-semibold whitespace-nowrap tabular-nums",
            props.large ? "text-xl" : "text-[0.9375rem]",
          ]}
        >
          {s.value}
        </dd>
      </div>
    ))}
  </dl>
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
    <dl class="grid gap-y-4 text-[0.9375rem] leading-snug text-white [&_dd]:break-words">
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
