import { component$, useSignal, type Signal } from "@builder.io/qwik";

import { overlayClass } from "@shared/overlay/styles";
import { imageUrl, videoUrl, type ImageSource } from "./images";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;
const VIDEO_BASE = import.meta.env.VITE_VIDEO_BASE_URL;

interface VideoPlayerProps {
  /** The video (its public id; the poster is its image). */
  src: Extract<ImageSource, { id: string }>;
  boxClass: string;
  boxRef?: Signal<HTMLElement | undefined>;
  boxStyle?: Record<string, string>;
  /** Describes the video for screen readers. */
  label?: string;
}

/**
 * A video in the overlay and on its page: the browser's own controls over
 * the poster, and nothing is loaded until it is played (preload="none":
 * each range the player asks for is a request to the image Worker and a
 * read of R2). A codec the browser cannot play (HEVC in many browsers) or
 * a failed load shows a message over the poster instead of a broken player.
 */
export const VideoPlayer = component$<VideoPlayerProps>((props) => {
  const failed = useSignal<"codec" | "load" | null>(null);
  const ownBox = useSignal<HTMLElement>();
  const box = props.boxRef ?? ownBox;
  const poster = imageUrl(S3_BASE, props.src, IMAGE_BASE, "w1920");
  return (
    <div
      ref={box}
      data-testid="overlay-box"
      class={props.boxClass}
      style={props.boxStyle}
    >
      <video
        data-testid="video-player"
        controls
        preload="none"
        playsInline
        poster={poster}
        src={videoUrl(props.src.id, VIDEO_BASE)}
        aria-label={props.label}
        // A tap on the controls is not a tap outside the overlay, and a
        // drag on the seek bar is not a swipe to the next photo.
        stoppropagation:click
        data-no-swipe
        onError$={async (_, video) => {
          // The media error's code does not tell a codec from an HTTP
          // error, so ask the server once: a video it no longer serves
          // (made private, a failed read) is not the browser's fault.
          let served = false;
          try {
            served = (
              await fetch(video.currentSrc || video.src, {
                method: "HEAD",
              })
            ).ok;
          } catch {
            // Offline: a load failure.
          }
          failed.value = served ? "codec" : "load";
        }}
        onPlaying$={() => {
          failed.value = null;
        }}
        class={overlayClass.image}
      />
      {failed.value !== null && (
        <p
          role="status"
          data-testid="video-error"
          class="absolute inset-x-0 bottom-14 mx-auto w-fit max-w-[90%] rounded-lg bg-black/75 px-4 py-2 text-center text-sm text-white"
        >
          {failed.value === "codec" ? (
            <>
              この動画はこのブラウザでは再生できません。
              <br />
              別のブラウザ（Safari など）で開いてください。
            </>
          ) : (
            "動画を読み込めませんでした。"
          )}
        </p>
      )}
    </div>
  );
});
