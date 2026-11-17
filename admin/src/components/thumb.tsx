import { component$ } from "@builder.io/qwik";
import {
  LIST_CANDIDATES,
  dimensionsFromFile,
  fileExtension,
  imageUrl,
  srcSet,
} from "~/lib/images";
import type { MediaWorld } from "~/lib/types";
import { ProgressivePreview } from "./preview";

// Photo thumbnail from the image Worker, in a fixed 16:9 box so rows and
// the preview never jump while images load. Without an image base URL
// (E2E/VRT, or IMAGE_BASE_URL unset) the same box shows a deterministic
// placeholder: world-tinted tile with the file extension. The originals
// are never requested.

type Props = {
  file: string;
  world: MediaWorld;
  imageBase: string | null;
  /**
   * "list": h240/h480 by density; "preview": the list thumbnail first, then
   * w1200/w1920 by width with a progress bar (see ProgressivePreview).
   */
  variant: "list" | "preview";
  /** Box size/rounding; the aspect ratio is fixed here. */
  class?: string;
};

export const Thumb = component$<Props>(
  ({ file, world, imageBase, variant, class: boxClass }) => {
    const box = ["relative aspect-video shrink-0 overflow-hidden", boxClass];
    if (!imageBase) {
      return (
        <div
          class={[
            box,
            "grid place-items-center",
            world === "VRChat"
              ? "bg-violet-100 text-violet-500 dark:bg-violet-950 dark:text-violet-300"
              : "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300",
          ]}
          data-testid="thumb-placeholder"
          aria-hidden="true"
        >
          <span class="flex flex-col items-center gap-1 text-center">
            <span
              class={[
                "font-semibold tracking-wider",
                variant === "preview" ? "text-sm" : "text-[10px]",
              ]}
            >
              {fileExtension(file) || "IMG"}
            </span>
            {variant === "preview" && (
              <span class="text-xs opacity-80">
                Preview off (IMAGE_BASE_URL is not set)
              </span>
            )}
          </span>
        </div>
      );
    }
    if (variant === "preview") {
      return (
        <ProgressivePreview file={file} imageBase={imageBase} class={box} />
      );
    }
    return (
      <div class={[box, "bg-zinc-100 dark:bg-zinc-800"]}>
        <img
          src={imageUrl(imageBase, file, "h240")}
          srcset={srcSet(imageBase, file, LIST_CANDIDATES)}
          {...dimensionsFromFile(file)}
          // Decorative (the file name is right next to it).
          alt=""
          loading="lazy"
          decoding="async"
          class="absolute inset-0 h-full w-full object-cover"
        />
      </div>
    );
  },
);
