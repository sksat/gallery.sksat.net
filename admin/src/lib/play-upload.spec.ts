import { describe, expect, it } from "vitest";
import { initUpload, setPlayUploadId } from "./db-upload";
import { MIN_PART_BYTES } from "./multipart";
import { handlePlayPut, PLAY_PUT_RE } from "./play-upload";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const ORIGIN = "https://admin.example";

const setup = async (size: number) => {
  const raw = migratedSqlite();
  const db = sqliteD1(raw);
  await initUpload(
    db,
    {
      file: "/v/clip.mp4",
      size,
      contentType: "video/mp4",
      sha256: "a".repeat(64),
      timestamp: null,
      kind: "video",
      video: {
        width: null,
        height: null,
        durationMs: null,
        codec: null,
        poster: false,
        posterSha256: null,
      },
    },
    {
      publicId: "abcdefghjk",
      platform: "Real",
      video: {
        posterKey: "/.poster/22222222222222222222.jpg",
        playKey: "/v/33333333333333333333.mp4",
      },
    },
  );
  await setPlayUploadId(db, 1, "up1");
  const puts: { key: string; type?: string }[] = [];
  const parts: { key: string; id: string; n: number }[] = [];
  const bucket = {
    put: async (key: string, _: unknown, o?: R2PutOptions) => {
      puts.push({
        key,
        type: (o?.httpMetadata as R2HTTPMetadata | undefined)?.contentType,
      });
    },
    resumeMultipartUpload: (key: string, id: string) => ({
      uploadPart: async (n: number) => {
        if (id !== "up1") throw new Error("no such upload");
        parts.push({ key, id, n });
        return { partNumber: n, etag: `e${n}` };
      },
    }),
  };
  const env = { DB: db, MEDIA_CACHE: bucket } as Record<string, unknown>;
  const put = (
    path: string,
    body: Uint8Array,
    headers: Record<string, string> = {},
  ) =>
    handlePlayPut(
      new Request(`${ORIGIN}${path}`, {
        method: "PUT",
        body: body as Uint8Array<ArrayBuffer>,
        headers: {
          origin: ORIGIN,
          "content-length": String(body.length),
          ...headers,
        },
      }),
      env,
      { access: async () => ({ ok: true }) as never },
    );
  return { put, puts, parts };
};

describe("handlePlayPut", () => {
  it("matches the copy's path only", () => {
    expect(PLAY_PUT_RE.test("/api/upload/12/play")).toBe(true);
    expect(PLAY_PUT_RE.test("/api/upload/12/play/")).toBe(true);
    expect(PLAY_PUT_RE.test("/api/upload/12/parts")).toBe(false);
  });

  it("puts a small copy whole, at its R2 key and type", async () => {
    const { put, puts } = await setup(10);
    const res = await put("/api/upload/1/play", new Uint8Array(10));
    expect(res.status).toBe(200);
    expect(puts).toEqual([
      { key: "v/33333333333333333333.mp4", type: "video/mp4" },
    ]);
  });

  it("refuses another size, a cross-origin request, and an unknown upload", async () => {
    const { put, puts } = await setup(10);
    expect((await put("/api/upload/1/play", new Uint8Array(9))).status).toBe(
      400,
    );
    expect(
      (
        await put("/api/upload/1/play", new Uint8Array(10), {
          origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    expect((await put("/api/upload/9/play", new Uint8Array(10))).status).toBe(
      404,
    );
    expect(puts).toEqual([]);
  });

  it("sends a large copy's parts to its multipart upload", async () => {
    const size = MIN_PART_BYTES + 5;
    const { put, parts } = await setup(size);
    // Whole: refused (it goes in parts).
    expect((await put("/api/upload/1/play", new Uint8Array(1))).status).toBe(
      400,
    );
    const last = await put(
      "/api/upload/1/play?uploadId=up1&part=2",
      new Uint8Array(5),
    );
    expect(last.status).toBe(200);
    expect(await last.json()).toEqual({ partNumber: 2, etag: "e2" });
    expect(parts).toEqual([
      { key: "v/33333333333333333333.mp4", id: "up1", n: 2 },
    ]);
    // A gone upload: 409, the browser starts the copy over.
    expect(
      (await put("/api/upload/1/play?uploadId=old&part=2", new Uint8Array(5)))
        .status,
    ).toBe(409);
    expect(
      (await put("/api/upload/1/play?uploadId=up1&part=3", new Uint8Array(5)))
        .status,
    ).toBe(400);
  });
});
