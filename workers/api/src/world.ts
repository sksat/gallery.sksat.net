/**
 * A world's preview (shared/vrchat/world.ts, also the admin's), and which
 * world a photo's projected answer links to: only that one is previewed
 * here (world-route.ts).
 */
import { WORLD_ID_RE } from "../../../shared/vrchat/world";

export * from "../../../shared/vrchat/world";

/**
 * The world id a photo's projected answer links to (`world.id`, given only
 * at the world level "link"), or null.
 */
export const linkedWorldId = (photo: unknown): string | null => {
  const world = (photo as { world?: { id?: unknown } | null } | null)?.world;
  const id = world?.id;
  return typeof id === "string" && WORLD_ID_RE.test(id) ? id : null;
};
