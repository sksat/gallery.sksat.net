import type { RequestHandler } from "@builder.io/qwik-city";
import { getAdminImages, getDB, getImageBase } from "~/lib/env";
import { THUMB_EXACT } from "~/lib/images";
import { imageSource, type FileObject } from "~/lib/media-file";
import { thumbHeaders } from "~/lib/thumb-response";

// GET /thumb/<preset>/<file…>: a resized thumbnail of any photo or camera
// picture, private ones included, for the admin's own pages.
//
// Like every admin route it is behind Cloudflare Access and plugin@access.
// The image comes from the image Worker's AdminImage entrypoint (service
// binding IMAGES), which checks the preset and path itself and verifies the
// Access JWT passed on here, so the binding alone is not enough. The
// response is for this browser only: never cached by shared caches.
export const onGet: RequestHandler = async ({
  params,
  request,
  platform,
  send,
  url,
}) => {
  const images = getAdminImages(platform);
  if (!images || getImageBase(platform) === null) {
    send(new Response("Not Found", { status: 404 }));
    return;
  }
  let upstream: Response;
  try {
    // A photo's image is resized from the file it shows (or that file's
    // display copy), whose key the pages do not link: one indexed lookup.
    // ?exact: a camera picture, resized as it is.
    const file = `/${params.file}`;
    const source: FileObject = url.searchParams.has(THUMB_EXACT)
      ? { storage: "b2", key: file }
      : await imageSource(getDB(platform), file);
    if (source.storage !== "b2") {
      send(new Response("Not Found", { status: 404 }));
      return;
    }
    upstream = await images.image(
      request.headers.get("cf-access-jwt-assertion"),
      source.key,
      params.preset,
      request.headers.get("accept"),
    );
  } catch (err) {
    console.error("/thumb: file lookup or AdminImage call failed:", err);
    send(new Response("Service unavailable", { status: 503 }));
    return;
  }
  // A large preset whose resize failed may come back as the photo's file
  // itself (X-Image-Fallback), which is shown as it is.
  send(
    new Response(upstream.ok ? upstream.body : null, {
      status: upstream.status,
      headers: thumbHeaders(upstream),
    }),
  );
};
