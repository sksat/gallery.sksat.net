import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { cameraPreview } from "~/lib/camera-preview";
import { getDB } from "~/lib/env";

/**
 * GET: camera <id>'s first picture and newest photos, for the camera
 * list's hover card (lib/camera-preview.ts). Private photos too: never
 * cached outside the browser.
 */
export const onGet: RequestHandler = withErrorHandler(
  "GET /api/camera/[id]/preview",
  async ({ platform, params, headers, json }) => {
    headers.set("Cache-Control", "private, max-age=60");
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      json(400, { error: "invalid id" });
      return;
    }
    json(200, await cameraPreview(getDB(platform), id));
  },
);
