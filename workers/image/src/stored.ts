/**
 * The resized copies and social cards the admin made once in its browser
 * and keeps in the R2 bucket gallery-media-cache (binding MEDIA_CACHE; keys
 * and presets in ../../../shared/resized/resized.ts). Tested with Vitest
 * (index.spec.ts).
 */
import {
  cardCaptionValue,
  cardWantedKey,
  isCardPresetName,
  isResizedPreset,
  isResizedType,
  RESIZED_CAPTION,
  RESIZED_SAME_AS,
  resizedKey,
  type CardCaption,
} from "../../../shared/resized/resized";
import type { PresetName } from "./request";

/** The part of an R2 binding used here. */
export type StoredBucket = Pick<R2Bucket, "get" | "head" | "put">;

/** Response header naming where an image came from ("stored" here). */
export const IMAGE_SOURCE_HEADER = "X-Image-Source";

const asResponse = (object: R2ObjectBody, type: string): Response =>
  new Response(object.body, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(object.size),
      ETag: object.httpEtag,
      [IMAGE_SOURCE_HEADER]: "stored",
    },
  });

/**
 * The copy of the photo `publicId` at `preset` made from `source` (its
 * file to resize), from the MEDIA_CACHE bucket, as a finished response
 * (without Cache-Control); null when there is none (not made yet, no
 * binding) or it cannot be read, so the caller resizes the original
 * instead. A copy stored as the same image as another preset
 * (RESIZED_SAME_AS: the photo is smaller than both boxes) is read from
 * there, one step only.
 *
 * Cards: `og-site` as stored; `og` only while the caption stored with it
 * is `caption`, the one the Worker would draw now (a card with metadata
 * that changed, or was hidden since, is never served).
 *
 * Only call this for a photo the API said may be shown: the key is built
 * from its answer, and nothing else guards the bucket.
 */
export const storedCopy = async (
  bucket: StoredBucket | undefined,
  publicId: string,
  source: string,
  preset: PresetName,
  caption: CardCaption = {},
): Promise<Response | null> => {
  if (!bucket) return null;
  try {
    if (isCardPresetName(preset)) {
      const object = await bucket.get(resizedKey(publicId, source, preset));
      if (!object) return null;
      const fresh =
        preset === "og-site" ||
        object.customMetadata?.[RESIZED_CAPTION] === cardCaptionValue(caption);
      if (!fresh || object.httpMetadata?.contentType !== "image/jpeg") {
        await object.body.cancel();
        return null;
      }
      return asResponse(object, "image/jpeg");
    }
    if (!isResizedPreset(preset)) return null;
    let object = await bucket.get(resizedKey(publicId, source, preset));
    const same = object?.customMetadata?.[RESIZED_SAME_AS];
    if (object && same !== undefined) {
      await object.body.cancel();
      object =
        isResizedPreset(same) && same !== preset
          ? await bucket.get(resizedKey(publicId, source, same))
          : null;
      if (object && object.customMetadata?.[RESIZED_SAME_AS] !== undefined) {
        await object.body.cancel();
        object = null;
      }
    }
    if (!object) return null;
    const type = object.httpMetadata?.contentType;
    if (!isResizedType(type)) {
      await object.body.cancel();
      console.error(`stored copy ${publicId} ${preset}: type ${type}`);
      return null;
    }
    return asResponse(object, type);
  } catch (err) {
    // The bucket failing must not take images down while the original
    // can still be resized.
    console.error(`stored copy ${publicId} ${preset} failed:`, err);
    return null;
  }
};

/**
 * Ask the admin to make the photo's `og` card (again): an empty marker
 * object it lists (cardWantedKey), written once (a HEAD first, so a card
 * requested often costs a read, not a write, per request). Best effort.
 */
export const wantCard = async (
  bucket: StoredBucket | undefined,
  publicId: string,
): Promise<void> => {
  if (!bucket) return;
  try {
    const key = cardWantedKey(publicId);
    if (await bucket.head(key)) return;
    await bucket.put(key, new Uint8Array());
  } catch (err) {
    console.error(`card request for ${publicId} failed:`, err);
  }
};
