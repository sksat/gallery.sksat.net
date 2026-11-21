/**
 * The image Worker's side of the resized copies' claim (admin migration
 * 0018, ../../../shared/resized/claim.ts): which photos it should have
 * Image Transformations make copies of, and marking them made. The only
 * writes this Worker makes, to `media.resized_at` alone, and only through
 * RPC (a service binding), never over HTTP. Tested in copies.spec.ts.
 *
 * Every live photo is claimed, private ones too (their copies serve the
 * admin's thumbnails; the image Worker serves a copy publicly only after
 * the API said the photo may be shown). A claimed photo comes with its
 * file to resize and, when it may be shown, its projected public metadata
 * for the `og` card's caption.
 */
import {
  claimCopies,
  finishCopies,
  resizeMaker,
  type Maker,
} from "../../../shared/resized/claim";
import { getPhotoForImage, type ImagePhoto } from "./query";

/** A photo the image Worker makes the copies of. */
export type CopiesJob = {
  /** media.id (for finishing the claim). */
  id: number;
  publicId: string;
  claim: string;
  source: { storage: "b2" | "r2"; key: string };
  /** The photo's size as displayed, when known (aliases need no resize). */
  width: number | null;
  height: number | null;
  /** The public photo for its og card; null when it may not be shown. */
  photo: ImagePhoto | null;
};

/** Claim up to `limit` photos (the ones in `ids` only, when given). */
export const claimCopiesJobs = async (
  db: D1Database,
  limit: number,
  ids?: readonly number[],
  nowMs: number = Date.now(),
): Promise<CopiesJob[]> => {
  const { claim, rows } = await claimCopies(db, {
    maker: "worker",
    ids,
    limit: Math.max(0, Math.min(limit, 20)),
    nowMs,
  });
  const jobs: CopiesJob[] = [];
  for (const r of rows) {
    jobs.push({
      id: r.id,
      publicId: r.public_id,
      claim,
      source: {
        storage: r.source_storage === "r2" ? "r2" : "b2",
        key: r.source_key,
      },
      width: r.width,
      height: r.height,
      photo:
        r.visibility === "private"
          ? null
          : await getPhotoForImage(db, r.public_id),
    });
  }
  return jobs;
};

export const finishCopiesJob = (
  db: D1Database,
  id: number,
  claim: string,
  outcome: "made" | "failed" | "browser",
): Promise<boolean> => finishCopies(db, id, claim, outcome);

export const copiesMaker = (db: D1Database): Promise<Maker> => resizeMaker(db);
