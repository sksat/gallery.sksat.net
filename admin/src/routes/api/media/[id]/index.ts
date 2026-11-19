import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getCamera, getMedia, updateMedia } from "~/lib/db";
import { platformExists } from "~/lib/db-platform";
import { resolveTagValuePatch } from "~/lib/db-tag-field";
import { getDB } from "~/lib/env";
import { contentChanged } from "~/lib/last-good";
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
    if (
      res.patch.camera_id != null &&
      !(await getCamera(db, res.patch.camera_id))
    ) {
      json(400, { error: "unknown camera_id" });
      return;
    }
    if (
      res.patch.digitized_with != null &&
      !(await getCamera(db, res.patch.digitized_with))
    ) {
      json(400, { error: "unknown digitized_with" });
      return;
    }
    if (
      res.patch.platform !== undefined &&
      !(await platformExists(db, res.patch.platform))
    ) {
      json(400, { error: "unknown platform" });
      return;
    }
    const tf = await resolveTagValuePatch(
      db,
      res.patch.tag_values,
      res.patch.tag_value_visibility,
    );
    if (!tf.ok) {
      json(400, { error: tf.error });
      return;
    }
    const updated = await updateMedia(db, id, {
      ...res.patch,
      tag_values: tf.values,
      tag_value_visibility: tf.levels,
    });
    if (!updated) {
      json(404, { error: "not found" });
      return;
    }
    await contentChanged(db);
    json(200, updated);
  },
);
