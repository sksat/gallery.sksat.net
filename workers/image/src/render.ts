/**
 * One resize (or card) through Cloudflare Image Transformations, from the
 * original's stable presigned URL (origin.ts). Used by the public handler
 * for what is not stored yet, and by the copies' maker (fill.ts), with the
 * same options, so a stored copy is the image the handler would have made.
 */
import type { Caption } from "./caption";
import { originFor, type OriginEnv } from "./origin";
import {
  transformFailed,
  transformOptions,
  type PresetName,
  type TransformOptions,
} from "./request";

const transform = (originUrl: string, image: TransformOptions) =>
  fetch(originUrl, {
    cf: {
      // workers-types does not know `draw` text entries yet (documented at
      // https://developers.cloudflare.com/images/optimization/draw-overlays/).
      image: image as RequestInitCfPropertiesImage,
      // No `cacheKey`: it is Enterprise-only and ignored here, so the
      // resized image is cached under `originUrl`, which originFor keeps
      // stable.
    },
  });

/**
 * Resize `file` with `preset`. `degraded` is set when a card had to be
 * drawn without its caption (two transformations). The caller sets
 * Cache-Control.
 */
export const render = async (
  env: OriginEnv,
  file: string,
  preset: PresetName,
  accept: string | null,
  origin: string,
  caption: Caption = {},
  /** false: no badge-only retry (one transformation, always). */
  { retry = true }: { retry?: boolean } = {},
): Promise<{ upstream: Response; degraded: boolean }> => {
  const original = await originFor(env, file);
  let upstream = await transform(
    original,
    transformOptions(preset, accept, origin, caption),
  );
  let degraded = false;
  if (
    retry &&
    transformFailed(upstream.status, upstream.headers.get("Cf-Resized")) &&
    (caption.primary || caption.secondary)
  ) {
    // If the text overlay is rejected (font fetch, limits), a card with
    // just the badge is still better than a broken og:image.
    await upstream.body?.cancel().catch(() => {});
    upstream = await transform(
      original,
      transformOptions(preset, accept, origin),
    );
    degraded = true;
  }
  return { upstream, degraded };
};
