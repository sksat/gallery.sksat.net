// What an incomplete video upload leaves behind when it is deleted
// (video.spec.ts): its original's unfinished multipart upload in B2, or
// the original itself, and its copies' objects (the poster in B2, every
// version; the playback copy in R2, with its unfinished multipart
// upload). 完全に削除 goes through purgeItems instead, which deletes every
// file of a photo, whatever its storage.

import type { UploadConfig } from "./b2";
import { abortMultipart } from "./b2-multipart";
import { deleteAllVersions } from "./b2-delete";
import type { DeletedUpload } from "./db-upload";
import { r2Key } from "./video";

export type CleanupDeps = {
  config: UploadConfig;
  /** The playback bucket; null when unbound (then an R2 object is an error). */
  bucket: Pick<R2Bucket, "delete" | "resumeMultipartUpload"> | null;
  deleteVersions?: typeof deleteAllVersions;
  abort?: typeof abortMultipart;
  /**
   * Whether a B2 key belongs to a file again (an upload of the same name
   * started meanwhile): then it is not deleted.
   */
  inUse?: (key: string) => Promise<boolean>;
};

/**
 * Abort the original's multipart upload and delete the copies. Throws on
 * the first failure; deleting what is already gone is fine.
 */
export const removeUploadLeftovers = async (
  d: DeletedUpload,
  {
    config,
    bucket,
    deleteVersions = deleteAllVersions,
    abort = abortMultipart,
    inUse = async () => false,
  }: CleanupDeps,
): Promise<void> => {
  if (d.upload_id) await abort(config, d.file, d.upload_id);
  // A video's original may be whole in B2 already (its multipart upload
  // completed before its copies were). A video is never a camera picture
  // (those are images), so nothing else shows that object.
  if (d.video && !(await inUse(d.file))) await deleteVersions(config, d.file);
  for (const c of d.copies) {
    if (c.storage === "b2") {
      await deleteVersions(config, c.key);
    } else {
      if (!bucket) throw new Error("動画の置き場 (R2) が設定されていません");
      if (c.upload_id) {
        try {
          await bucket.resumeMultipartUpload(r2Key(c.key), c.upload_id).abort();
        } catch {
          // Completed or gone already: nothing of it is left to drop.
        }
      }
      // R2 has no versions: one delete removes it (none: no error).
      await bucket.delete(r2Key(c.key));
    }
  }
};
