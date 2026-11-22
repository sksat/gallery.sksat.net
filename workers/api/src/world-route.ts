/**
 * The world preview of a photo (world.ts), by the photo's public id: the
 * HTTP route /api/media/<public_id>/world and the image Worker's
 * worldImage RPC. The photo is read as its HTTP answer
 * (/api/media/<public_id>), kept per content version, so this adds no D1
 * query and follows the photo's visibility and world level.
 */
import { answer, unavailable, type Context } from "./last-good";
import { respond } from "./respond";
import { jsonResponse, WORLD_CACHE_CONTROL } from "./route";
import {
  linkedWorldId,
  worldPreview,
  type PreviewContext,
  type WorldPreview,
} from "./world";

/** The photo is not there, or links no world. */
export const NO_WORLD = "none";
/** The photo could not be read (D1 down with nothing kept). */
export const UNAVAILABLE = "unavailable";

/** The preview of a photo's world, or why there is none. */
export const photoWorldPreview = async (
  publicId: string,
  ctx: Context,
  preview: PreviewContext,
): Promise<WorldPreview | typeof NO_WORLD | typeof UNAVAILABLE | null> => {
  const got = await answer(
    `http/api/media/${publicId}`,
    () => respond(ctx.db, { kind: "media", id: publicId }),
    ctx,
  );
  if (!got) return UNAVAILABLE;
  const body = await new Response(got.body).text();
  if (got.status !== 200) return NO_WORLD;
  const worldId = linkedWorldId(JSON.parse(body));
  if (!worldId) return NO_WORLD;
  return worldPreview(worldId, preview);
};

/** What the gallery's card gets: the picture is at /img/world/<public_id>. */
export type WorldCard = {
  name: string;
  author: string | null;
  description: string | null;
  image: boolean;
};

/** GET /api/media/<public_id>/world. */
export const handleWorldGet = async (
  request: Request,
  publicId: string,
  ctx: Context,
  preview: PreviewContext,
): Promise<Response> => {
  const got = await photoWorldPreview(publicId, ctx, preview);
  if (got === UNAVAILABLE) return unavailable();
  const response =
    got === NO_WORLD || got === null
      ? jsonResponse(404, { error: "not found" }, "public, max-age=600")
      : jsonResponse(
          200,
          {
            name: got.name,
            author: got.author,
            description: got.description,
            image: got.image !== null,
          } satisfies WorldCard,
          WORLD_CACHE_CONTROL,
        );
  return request.method === "HEAD"
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;
};
