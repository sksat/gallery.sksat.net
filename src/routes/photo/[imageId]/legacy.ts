import type { RequestEventLoader } from "@builder.io/qwik-city";

import { PUBLIC_ID_RE } from "~/components/gallery/types";
import { loadLegacyId } from "~/lib/api";

/**
 * Throws the 301 from an old photo URL (/photo/N, /?imageId=N) to
 * /photo/<public_id>/, keeping `query`. N is the photo's position in the
 * media.json of before public ids, frozen in the database
 * (media.legacy_index). 404 when no public or unlisted photo had it.
 */
export const legacyRedirect = async (
  event: RequestEventLoader,
  index: number,
  query: URLSearchParams,
): Promise<never> => {
  let id: string | null;
  try {
    id = await loadLegacyId(event, index);
  } catch (error) {
    console.error("Failed to look up an old photo URL:", error);
    throw event.error(500, "Failed to look up the photo");
  }
  if (id === null || !PUBLIC_ID_RE.test(id)) {
    throw event.error(404, "Image not found");
  }
  const search = query.toString();
  throw event.redirect(301, `/photo/${id}/${search ? `?${search}` : ""}`);
};
