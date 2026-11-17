import type { RequestHandler } from "@builder.io/qwik-city";
import { getAdminImages, getImageBase } from "~/lib/env";

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
}) => {
  const images = getAdminImages(platform);
  if (!images || getImageBase(platform) === null) {
    send(new Response("Not Found", { status: 404 }));
    return;
  }
  let upstream: Response;
  try {
    upstream = await images.image(
      request.headers.get("cf-access-jwt-assertion"),
      `/${params.file}`,
      params.preset,
      request.headers.get("accept"),
    );
  } catch (err) {
    console.error("/thumb: AdminImage call failed:", err);
    send(new Response("Service unavailable", { status: 503 }));
    return;
  }
  const headers = new Headers({
    "Cache-Control": upstream.ok ? "private, max-age=3600" : "no-store",
    Vary: "Accept",
  });
  const type = upstream.headers.get("content-type");
  if (upstream.ok && type) headers.set("Content-Type", type);
  send(
    new Response(upstream.ok ? upstream.body : null, {
      status: upstream.status,
      headers,
    }),
  );
};
