import { $, component$, sync$, type QRL } from "@builder.io/qwik";

import type { PhotoInfo } from "./photo-info";

export type TagLink = { tag: string; href: string };

/** A click meant for a new tab or window. */
const isModified = (e: MouseEvent) =>
  e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;

const LINK =
  "text-white underline decoration-white/40 underline-offset-2 hover:decoration-white";

interface PhotoInfoListProps {
  info: PhotoInfo;
  /** Each tag of the photo with the gallery URL filtered by it. */
  tagLinks: TagLink[];
  /**
   * Filter in place on a plain click (the overlay); without it the tags
   * are plain links (the photo page).
   */
  onTag$?: QRL<(tag: string) => void>;
  /** Two columns where there is room (the overlay's sheet stays low). */
  columns?: boolean;
}

/**
 * A photo's metadata as a description list, exactly as photoInfo() gives
 * it (only what the API returned): the overlay's info panel and the photo
 * page show the same list.
 */
export const PhotoInfoList = component$<PhotoInfoListProps>((props) => {
  const i = props.info;
  return (
    <dl
      class={[
        "grid gap-y-3 [&_dd]:break-words [&_dt]:text-xs [&_dt]:text-white/60",
        props.columns && "sm:grid-cols-2 sm:gap-x-6",
      ]}
    >
      {i.taken && (
        <div data-testid="info-taken">
          <dt>撮影日時</dt>
          <dd>
            <time dateTime={i.taken.datetime}>{i.taken.text}</time>
          </dd>
        </div>
      )}
      {(i.camera || i.body || i.lens) && (
        <div data-testid="info-camera">
          <dt>カメラ</dt>
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
          {i.body && <dd class="text-white/80">{i.body}</dd>}
          {i.lens && (
            <dd data-testid="info-lens" class="text-white/80">
              {i.lens}
            </dd>
          )}
        </div>
      )}
      {i.exposure && (
        <div data-testid="info-exposure">
          <dt>撮影設定</dt>
          <dd class="tabular-nums">{i.exposure}</dd>
        </div>
      )}
      {i.world && (
        <div data-testid="info-world">
          <dt>ワールド</dt>
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
        </div>
      )}
      {i.location && (
        <div data-testid="info-location">
          <dt>撮影場所</dt>
          <dd>
            {/* Plain <a>: see the note in components/layout/header.tsx. */}
            <a href={i.location.href} class={[LINK, "tabular-nums"]}>
              {i.location.label}
            </a>
          </dd>
        </div>
      )}
      {i.tags.length > 0 && (
        <div data-testid="info-tags">
          <dt>タグ</dt>
          <dd class="mt-1 flex flex-wrap gap-1.5">
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
                class="rounded-full border border-white/30 px-2.5 py-0.5 text-white hover:border-white/70"
              >
                {tag}
              </a>
            ))}
          </dd>
        </div>
      )}
      {i.file && (
        <div data-testid="info-file">
          <dt>ファイル名</dt>
          <dd class="font-mono text-xs text-white/80">{i.file}</dd>
        </div>
      )}
    </dl>
  );
});
