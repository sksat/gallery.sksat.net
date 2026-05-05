import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getMedia, updateMedia } from "~/lib/db";
import { getDB } from "~/lib/env";
import { validatePatch } from "~/lib/validate";

const parseId = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const onGet: RequestHandler = withErrorHandler(
  "GET /api/media/[id]",
  async ({ platform, params, json }) => {
    const id = parseId(params.id);
    if (id === null) {
      json(400, { error: "invalid id" });
      return;
    }
    const db = getDB(platform);
    const row = await getMedia(db, id);
    if (!row) {
      json(404, { error: "not found" });
      return;
    }
    json(200, row);
  },
);

export const onPatch: RequestHandler = withErrorHandler(
  "PATCH /api/media/[id]",
  async ({ platform, params, request, json }) => {
    const id = parseId(params.id);
    if (id === null) {
      json(400, { error: "invalid id" });
      return;
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      json(400, { error: "body must be JSON" });
      return;
    }
    const res = validatePatch(body);
    if (!res.ok) {
      json(400, { error: res.error });
      return;
    }
    const db = getDB(platform);
    const updated = await updateMedia(db, id, res.patch);
    if (!updated) {
      json(404, { error: "not found" });
      return;
    }
    json(200, updated);
  },
);
