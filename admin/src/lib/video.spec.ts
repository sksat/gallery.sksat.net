import { describe, expect, it } from "vitest";
import type { UploadConfig } from "./b2";
import { validateFolderName } from "./folders";
import {
  newPlayKey,
  newPosterKey,
  PLAY_KEY_RE,
  playContentType,
  POSTER_KEY_RE,
  r2Key,
} from "./video";
import { removeUploadLeftovers } from "./video-cleanup";

describe("a video's keys", () => {
  it("are random, in their own places, of the right shape", () => {
    const a = newPosterKey();
    expect(a).toMatch(POSTER_KEY_RE);
    expect(newPosterKey()).not.toBe(a);
    expect(newPlayKey("video/mp4")).toMatch(PLAY_KEY_RE);
    expect(newPlayKey("video/quicktime")).toMatch(/\.mp4$/);
    expect(newPlayKey("video/webm")).toMatch(/\.webm$/);
    // No folder of the admin's can be named like the posters' one.
    expect(validateFolderName(".poster").ok).toBe(false);
  });

  it("are served as MP4 or WebM, from R2 without the leading slash", () => {
    expect(playContentType("video/quicktime")).toBe("video/mp4");
    expect(playContentType("video/webm")).toBe("video/webm");
    expect(r2Key("/v/a.mp4")).toBe("v/a.mp4");
  });
});

describe("removeUploadLeftovers", () => {
  const config = {} as UploadConfig;

  it("aborts both uploads, deletes the original's, the poster's versions and the copy", async () => {
    const done: string[] = [];
    await removeUploadLeftovers(
      {
        file: "/a.mp4",
        video: true,
        upload_id: "up",
        copies: [
          { storage: "b2", key: "/.poster/p.jpg", upload_id: null },
          { storage: "r2", key: "/v/x.mp4", upload_id: "r2up" },
        ],
      },
      {
        config,
        bucket: {
          delete: async (k: string | string[]) =>
            void done.push(`r2 ${String(k)}`),
          resumeMultipartUpload: ((k: string, id: string) => ({
            abort: async () => void done.push(`r2 abort ${k} ${id}`),
          })) as unknown as R2Bucket["resumeMultipartUpload"],
        },
        deleteVersions: async (_: UploadConfig, f: string) => (
          done.push(`b2 ${f}`),
          1
        ),
        abort: async (_: UploadConfig, f: string, id: string) =>
          void done.push(`abort ${f} ${id}`),
      },
    );
    expect(done).toEqual([
      "abort /a.mp4 up",
      "b2 /a.mp4",
      "b2 /.poster/p.jpg",
      "r2 abort v/x.mp4 r2up",
      "r2 v/x.mp4",
    ]);
  });

  it("fails without the R2 binding when there is a copy", async () => {
    await expect(
      removeUploadLeftovers(
        {
          file: "/a.mp4",
          video: false,
          upload_id: null,
          copies: [{ storage: "r2", key: "/v/x.mp4", upload_id: null }],
        },
        { config, bucket: null },
      ),
    ).rejects.toThrow("R2");
  });
});
