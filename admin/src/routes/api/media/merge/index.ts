import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { MergeError, mergePhotos, unmergePhoto } from "~/lib/db-merge";
import { getDB } from "~/lib/env";
import { isVisibility } from "~/lib/types";

const parseId = (raw: unknown): number | null =>
  typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : null;

/**
 * Merge a photo that is a retouch of another into it (db-merge.ts), for
 * the upload panel. Body: { into, from, visibility?, show? } (defaults:
 * defaultMerge), or { undo: <alias> } to undo one.
 *
 * 200 { alias } / { id, path } (the photo back); 409 { error } when it
 * cannot be done (the reason in words).
 */
export const onPost: RequestHandler = withErrorHandler(
  "POST /api/media/merge",
  async ({ platform, request, json }) => {
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      body = parsed as Record<string, unknown>;
    } catch {
      json(400, { error: "リクエストの形式が正しくありません" });
      return;
    }
    const db = getDB(platform);
    try {
      if (typeof body.undo === "string") {
        json(200, await unmergePhoto(db, body.undo));
        return;
      }
      const into = parseId(body.into);
      const from = parseId(body.from);
      if (
        into === null ||
        from === null ||
        (body.visibility !== undefined && !isVisibility(body.visibility)) ||
        (body.show !== undefined && typeof body.show !== "boolean")
      ) {
        json(400, { error: "リクエストの形式が正しくありません" });
        return;
      }
      json(
        200,
        await mergePhotos(db, {
          into,
          from,
          ...(isVisibility(body.visibility)
            ? { visibility: body.visibility }
            : {}),
          ...(typeof body.show === "boolean" ? { show: body.show } : {}),
        }),
      );
    } catch (err) {
      if (err instanceof MergeError) {
        json(409, { error: err.message });
        return;
      }
      throw err;
    }
  },
);
