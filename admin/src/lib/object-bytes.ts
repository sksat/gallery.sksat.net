// How the admin reads a few bytes of an original (metadata backfill): its
// own B2 key cannot read, so it asks the image Worker's AdminImage.bytes
// (Access JWT checked there too), like object-stat.ts does for uploads.

import type { ReadBytes } from "./backfill";
import { getAdminImages } from "./env";

/** The reader for this request, or null when the Worker is not bound. */
export const getObjectBytes = (
  platform: { env?: Record<string, unknown> } | undefined,
  accessJwt: string | null,
): ReadBytes | null => {
  const images = getAdminImages(platform);
  if (!images) return null;
  return async (file, range) => {
    const res = await images.bytes(accessJwt, file, range);
    // A path the Worker does not serve (an old name outside its rules):
    // nothing to read, like a missing object.
    if (!res.ok && res.status === 404) return null;
    if (!res.ok) throw new Error(`AdminImage.bytes: ${res.status}`);
    return res.object;
  };
};
