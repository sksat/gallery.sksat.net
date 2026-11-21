import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getDB } from "~/lib/env";
import { getObjectBody } from "~/lib/object-bytes";
import { claimedSource } from "~/lib/resized";

/**
 * The file a claimed photo's images are resized from, streamed to the
 * browser that claimed it (`?claim=`, src/lib/resized.ts), which makes the
 * resized copies from it. Only while the claim holds, so this is no way to
 * download any file. Through the image Worker's AdminImage.object (its
 * read key; the Access JWT is checked there again).
 *
 * 200 the file; 404 no such claim or no such object; 503 nothing to read
 * with. Never cached (private photos).
 */
export const onGet: RequestHandler = withErrorHandler(
  "GET /api/resized/[id]/source",
  async ({ platform, params, request, url, headers, json, send }) => {
    headers.set("Cache-Control", "private, no-store");
    const id = Number(params.id);
    const claim = url.searchParams.get("claim");
    if (!Number.isInteger(id) || id <= 0 || !claim) {
      json(400, { error: "id and claim are required" });
      return;
    }
    const source = await claimedSource(getDB(platform), id, claim);
    if (!source || source.storage !== "b2") {
      json(404, { error: "not claimed" });
      return;
    }
    const read = getObjectBody(
      platform,
      url,
      request.headers.get("cf-access-jwt-assertion"),
    );
    if (!read) {
      json(503, { error: "the image Worker is not bound" });
      return;
    }
    const upstream = await read(source.key);
    if (!upstream.ok) {
      await upstream.body?.cancel();
      json(upstream.status === 404 ? 404 : 502, { error: "unavailable" });
      return;
    }
    const out = new Headers({ "Cache-Control": "private, no-store" });
    for (const name of ["Content-Type", "Content-Length"]) {
      const v = upstream.headers.get(name);
      if (v !== null) out.set(name, v);
    }
    send(new Response(upstream.body, { status: 200, headers: out }));
  },
);
