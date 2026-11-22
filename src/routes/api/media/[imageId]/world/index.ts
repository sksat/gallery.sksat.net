import type { RequestHandler } from "@builder.io/qwik-city";

import { apiGet } from "~/lib/api";

// The world preview of a photo (workers/api/src/world-route.ts) on the
// site's own origin, for the world link's card (world-preview.tsx). In
// production gallery.sksat.net/api/* is the API Worker's route, which
// answers before Pages; this passes it on where there is none (dev and
// tests, whose API is on another origin).
export const onGet: RequestHandler = async (event) => {
  const res = await apiGet(
    event,
    `/media/${encodeURIComponent(event.params.imageId)}/world`,
  );
  event.send(
    new Response(await res.text(), {
      status: res.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": res.headers.get("Cache-Control") ?? "no-store",
      },
    }),
  );
};
