import { component$ } from "@builder.io/qwik";
import { formatDuration } from "@shared/video/format";
import {
  LIST_CANDIDATES,
  dimensionsFromFile,
  fileExtension,
  imageUrl,
  srcSet,
  THUMB_EXACT,
} from "~/lib/images";
import { platformOf } from "~/lib/platform";
import type { MediaPlatform, ThumbVideo } from "~/lib/types";
import { usePlatformList } from "~/routes/layout";
import { ProgressivePreview } from "./preview";

// Photo thumbnail (the /thumb route), in a fixed 16:9 box so rows and the
// preview never jump while images load. Without a thumbnail base (E2E/VRT,
// THUMBNAILS off, or no image Worker binding) the same box shows a deterministic
// placeholder: platform-tinted tile with the file extension. The originals
// are never requested.

type Props = {
  file: string;
  /** Tints the placeholder; null = neutral. */
  platform: MediaPlatform | null;
  imageBase: string | null;
  /**
   * "list": h240/h480 by density; "preview": the list thumbnail first, then
   * w1200/w1920 by width with a progress bar (see ProgressivePreview).
   */
  variant: "list" | "preview";
  /**
   * `file` itself (a camera picture), not the file its photo shows: its
   * object may also be a photo's original. List variant only.
   */
  exact?: boolean;
  /**
   * The w1200 preset instead of h240/h480 (list variant): when the resize
   * fails, it comes back as the file itself (the camera page's few
   * pictures, still shown while transformations are used up).
   */
  large?: boolean;
  /** Box size/rounding; the aspect ratio is fixed here. */
  class?: string;
  /**
   * A video (thumbVideo(row)): a play mark with its length over the
   * thumbnail, which /thumb makes from its poster (none: the extension).
   */
  video?: ThumbVideo | null;
};

/** The play mark and length over a video's thumbnail. */
export const VideoBadge = component$<{
  durationMs: number | null;
  size: "list" | "preview";
}>(({ durationMs, size }) => (
  <span
    data-testid="video-badge"
    class={[
      "pointer-events-none absolute right-1 bottom-1 flex items-center gap-1 rounded bg-black/70 font-medium text-white tabular-nums",
      size === "preview" ? "px-2 py-1 text-sm" : "px-1 py-0.5 text-[10px]",
    ]}
  >
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      class={size === "preview" ? "h-4 w-4" : "h-3 w-3"}
      fill="currentColor"
    >
      <path d="M4 2.5v11l9-5.5z" />
    </svg>
    <span class="sr-only">動画</span>
    {durationMs !== null && <span>{formatDuration(durationMs)}</span>}
  </span>
));

export const Thumb = component$<Props>(
  ({
    file,
    platform,
    imageBase,
    variant,
    exact,
    large,
    class: boxClass,
    video,
  }) => {
    const box = ["relative aspect-video shrink-0 overflow-hidden", boxClass];
    const badge = video ? (
      <VideoBadge durationMs={video.durationMs} size={variant} />
    ) : null;
    const ext = (
      <span
        class={[
          "font-semibold tracking-wider",
          variant === "preview" ? "text-sm" : "text-[10px]",
        ]}
      >
        {fileExtension(file) || "IMG"}
      </span>
    );
    // Read during every render, so the list always reaches the browser.
    const platforms = usePlatformList().value;
    const kind =
      platform === null ? null : platformOf(platforms, platform).kind;
    const tint =
      kind === "virtual"
        ? "bg-violet-100 text-violet-500 dark:bg-violet-950 dark:text-violet-300"
        : kind === "real"
          ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300"
          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
    if (!imageBase) {
      return (
        <div
          class={[box, "grid place-items-center", tint]}
          data-testid="thumb-placeholder"
          aria-hidden="true"
        >
          <span class="flex flex-col items-center gap-1 text-center">
            {ext}
            {variant === "preview" && (
              <span class="text-xs opacity-80">
                Preview off (thumbnails are not enabled)
              </span>
            )}
          </span>
          {badge}
        </div>
      );
    }
    if (variant === "preview") {
      if (badge) {
        return (
          <div class={box}>
            <ProgressivePreview
              file={file}
              imageBase={imageBase}
              placeholder={fileExtension(file) || "IMG"}
              class="absolute inset-0"
            />
            {badge}
          </div>
        );
      }
      return (
        <ProgressivePreview
          file={file}
          imageBase={imageBase}
          class={[box, tint]}
          placeholder={fileExtension(file) || "IMG"}
        />
      );
    }
    // A photo's thumbnail is of the file it shows (the route resolves it);
    // a camera picture's is of its own object.
    const objectFile = exact ? `${file}?${THUMB_EXACT}` : file;
    return (
      // If the image fails (resizing refused, e.g. the monthly
      // transformations used up; Worker error, offline), it hides itself
      // and the tile is the placeholder above (tint and file extension)
      // instead of a broken-image icon.
      <div class={[box, "grid place-items-center", tint]}>
        <img
          onError$={(_, el) => {
            el.hidden = true;
          }}
          src={imageUrl(imageBase, objectFile, large ? "w1200" : "h240")}
          srcset={
            large ? undefined : srcSet(imageBase, objectFile, LIST_CANDIDATES)
          }
          {...dimensionsFromFile(file)}
          // Decorative (the file name is right next to it).
          alt=""
          loading="lazy"
          decoding="async"
          class="peer absolute inset-0 h-full w-full object-cover"
        />
        <span
          aria-hidden="true"
          data-testid="thumb-failed"
          class="hidden peer-[[hidden]]:inline"
        >
          {ext}
        </span>
        {badge}
      </div>
    );
  },
);
