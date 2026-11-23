import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { handleWorldImage } from "~/lib/world-preview";
import { worldContext } from "~/lib/world-context";

/** A VRChat world's picture for the edit page (lib/world-preview.ts). */
export const onGet: RequestHandler = withErrorHandler(
  "GET /api/world/[worldId]/image",
  async (ev) => {
    ev.send(await handleWorldImage(ev.params.worldId, worldContext(ev)));
  },
);
