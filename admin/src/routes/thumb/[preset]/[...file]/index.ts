import type { RequestHandler } from "@builder.io/qwik-city";
import {
  isCardPresetName,
  isResizedPreset,
  RESIZED_SAME_AS,
  resizedKey,
} from "@shared/resized/resized";
import { getAdminImages, getDB, getMediaCache, getImageBase } from "~/lib/env";
import { THUMB_EXACT } from "~/lib/images";
import { imageSource, type ImageSource } from "~/lib/media-file";
import { thumbHeaders } from "~/lib/thumb-response";

// GET /thumb/<preset>/<file…>: a resized thumbnail of any photo or camera
// picture, private ones included, for the admin's own pages.
//
// Like every admin route it is behind Cloudflare Access and plugin@access.
// A photo's image is its resized copy from the MEDIA_CACHE bucket when it has
// been made (src/lib/resized.ts), read here directly; else it comes from
// the image Worker's AdminImage entrypoint (service binding IMAGES), which
// checks the preset and path itself and verifies the Access JWT passed on
// here, so the binding alone is not enough. The response is for this
// browser only: never cached by shared caches.
export const onGet: RequestHandler = async ({
  params,
  request,
  platform,
  send,
  url,
}) => {
  const images = getAdminImages(platform);
  const copies = getMediaCache(platform);
  if (!copies && (!images || getImageBase(platform) === null)) {
    send(new Response("Not Found", { status: 404 }));
    return;
  }
  let upstream: Response;
  let stored: Response | null = null;
  try {
    // A photo's image is resized from the file it shows (or that file's
    // display copy), whose key the pages do not link: one indexed lookup.
    // ?exact: a camera picture, resized as it is.
    const file = `/${params.file}`;
    const source: ImageSource = url.searchParams.has(THUMB_EXACT)
      ? { storage: "b2", key: file, publicId: null }
      : await imageSource(getDB(platform), file);
    stored =
      copies && source.publicId
        ? await storedThumb(copies, source.publicId, source.key, params.preset)
        : null;
    if (stored) {
      upstream = stored;
    } else if (
      // A card is only ever stored (the Worker's AdminImage has none).
      isCardPresetName(params.preset) ||
      !images ||
      getImageBase(platform) === null ||
      source.storage !== "b2"
    ) {
      send(new Response("Not Found", { status: 404 }));
      return;
    } else {
      upstream = await images.image(
        request.headers.get("cf-access-jwt-assertion"),
        source.key,
        params.preset,
        request.headers.get("accept"),
      );
    }
  } catch (err) {
    console.error("/thumb: file lookup or image call failed:", err);
    send(new Response("Service unavailable", { status: 503 }));
    return;
  }
  // A large preset whose resize failed may come back as the photo's file
  // itself (X-Image-Fallback), which is shown as it is. A stored copy
  // keeps its ETag.
  const headers = thumbHeaders(upstream);
  const etag = stored ? upstream.headers.get("etag") : null;
  if (upstream.ok && etag) headers.set("ETag", etag);
  send(
    new Response(upstream.ok ? upstream.body : null, {
      status: upstream.status,
      headers,
    }),
  );
};

/**
 * A photo's resized copy or card at `preset` (following a copy stored as
 * another preset's image), or null when it has not been made. A card is
 * shown as stored, whatever its caption: this is the admin's own view.
 */
const storedThumb = async (
  copies: R2Bucket,
  publicId: string,
  source: string,
  preset: string,
): Promise<Response | null> => {
  if (!isResizedPreset(preset) && !isCardPresetName(preset)) return null;
  let object = await copies.get(resizedKey(publicId, source, preset));
  const same = object?.customMetadata?.[RESIZED_SAME_AS];
  if (object && same !== undefined) {
    await object.body.cancel();
    object = isResizedPreset(same)
      ? await copies.get(resizedKey(publicId, source, same))
      : null;
  }
  if (!object || object.size === 0) {
    await object?.body.cancel();
    return null;
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/webp",
      ETag: object.httpEtag,
    },
  });
};
