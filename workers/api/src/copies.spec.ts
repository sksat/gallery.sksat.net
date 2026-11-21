// The image Worker's claim of photos to make copies of (copies.ts), on the
// real schema: what it gets, and that it writes media.resized_at only.
import { describe, expect, it } from "vitest";
import { RESIZED_DATE } from "../../../shared/resized/claim";
import { claimCopiesJobs, copiesMaker, finishCopiesJob } from "./copies";
import { d1, migratedDb } from "./sqlite-d1.test-helper";

const NOW = Date.parse(RESIZED_DATE) + 3600_000;

const setup = () => {
  const raw = migratedDb();
  raw.exec(`
    INSERT INTO media (id, public_id, file, platform, visibility, width, height) VALUES
      (1, 'aaaaaaaaa2', '/a.png', 'Real', 'public', 7680, 4320),
      (2, 'aaaaaaaaa3', '/b.png', 'Real', 'private', NULL, NULL),
      (3, 'aaaaaaaaa4', '/c.png', 'Real', 'unlisted', 100, 50);
    UPDATE media SET trashed_at = '2026-01-01' WHERE id = 3;
  `);
  return { raw, db: d1(raw) };
};

describe("claimCopiesJobs", () => {
  it("claims live photos, private ones too, with their file and public card data", async () => {
    const { raw, db } = setup();
    const jobs = await claimCopiesJobs(db, 5, undefined, NOW);
    expect(jobs.map((j) => j.id)).toEqual([1, 2]);
    const [pub, priv] = jobs;
    expect(pub).toMatchObject({
      publicId: "aaaaaaaaa2",
      source: { storage: "b2", key: "/a.png" },
      width: 7680,
      height: 4320,
    });
    // The public photo comes projected (its og caption); the private one not.
    expect(pub.photo?.id).toBe("aaaaaaaaa2");
    expect(priv.photo).toBeNull();
    expect(
      raw.prepare("SELECT resized_at FROM media WHERE id = 1").get(),
    ).toEqual({ resized_at: pub.claim });
    // Claimed: not again.
    expect(await claimCopiesJobs(db, 5, undefined, NOW)).toEqual([]);
  });

  it("finishes a claim only while it holds", async () => {
    const { raw, db } = setup();
    const [job] = await claimCopiesJobs(db, 1, [1], NOW);
    expect(await finishCopiesJob(db, 1, "making:other", "made")).toBe(false);
    expect(await finishCopiesJob(db, 1, job.claim, "browser")).toBe(true);
    expect(
      (raw.prepare("SELECT resized_at FROM media WHERE id = 1").get() as {
        resized_at: string;
      }).resized_at,
    ).toMatch(/^browser:/);
  });

  it("claims nothing while the site makes the copies in the browser", async () => {
    const { raw, db } = setup();
    expect(await copiesMaker(db)).toBe("worker");
    raw.exec(
      `INSERT INTO setting (key, value) VALUES ('resize_maker', '"browser"')`,
    );
    expect(await copiesMaker(db)).toBe("browser");
    expect(await claimCopiesJobs(db, 5, undefined, NOW)).toEqual([]);
  });
});
