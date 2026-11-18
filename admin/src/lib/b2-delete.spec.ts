import { describe, expect, it, vi } from "vitest";
import type { UploadConfig } from "./b2";
import {
  deleteAllVersions,
  DeletePermissionError,
  parseVersions,
} from "./b2-delete";

const config: UploadConfig = {
  endpoint: "https://s3.us-west-002.backblazeb2.com",
  bucket: "sksat-gallery",
  region: "us-west-002",
  keyId: "key",
  applicationKey: "secret",
};
const now = () => new Date("2026-11-18T01:02:03Z");

const list = (
  entries: [kind: "Version" | "DeleteMarker", key: string, id: string][],
  next?: [string, string],
) =>
  `<?xml version="1.0" encoding="UTF-8"?><ListVersionsResult><Name>sksat-gallery</Name>` +
  `<IsTruncated>${next ? "true" : "false"}</IsTruncated>` +
  (next
    ? `<NextKeyMarker>${next[0]}</NextKeyMarker><NextVersionIdMarker>${next[1]}</NextVersionIdMarker>`
    : "") +
  entries
    .map(
      ([k, key, id]) =>
        `<${k}><Key>${key}</Key><VersionId>${id}</VersionId><IsLatest>false</IsLatest></${k}>`,
    )
    .join("") +
  `</ListVersionsResult>`;

describe("parseVersions", () => {
  it("reads versions and delete markers, and where to go on", () => {
    expect(
      parseVersions(
        list(
          [
            ["Version", "a/b.png", "4_z1"],
            ["DeleteMarker", "a/b.png", "4_z2"],
            ["Version", "a/b&amp;c.png", "4_z3"],
          ],
          ["a/b.png", "4_z2"],
        ),
      ),
    ).toEqual({
      versions: [
        { key: "a/b.png", versionId: "4_z1" },
        { key: "a/b.png", versionId: "4_z2" },
        { key: "a/b&c.png", versionId: "4_z3" },
      ],
      next: { keyMarker: "a/b.png", versionIdMarker: "4_z2" },
    });
  });
});

describe("deleteAllVersions", () => {
  it("lists every page and deletes each version of exactly that key", async () => {
    const calls: { method: string; url: URL }[] = [];
    const fetchFn = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        calls.push({ method, url });
        if (method === "DELETE") return new Response(null, { status: 204 });
        return new Response(
          url.searchParams.has("key-marker")
            ? list([["DeleteMarker", "V/a.png", "v3"]])
            : list(
                [
                  ["Version", "V/a.png", "v1"],
                  ["Version", "V/a.png.bak", "vx"],
                  ["Version", "V/a.png", "v2"],
                ],
                ["V/a.png", "v2"],
              ),
        );
      },
    );
    expect(await deleteAllVersions(config, "/V/a.png", fetchFn, now)).toBe(3);
    const lists = calls.filter((c) => c.method === "GET");
    expect(lists).toHaveLength(2);
    expect(lists[0].url.pathname).toBe("/sksat-gallery");
    expect(lists[0].url.searchParams.get("prefix")).toBe("V/a.png");
    expect(lists[0].url.searchParams.has("versions")).toBe(true);
    expect(lists[0].url.searchParams.get("X-Amz-Signature")).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(lists[1].url.searchParams.get("version-id-marker")).toBe("v2");
    const deletes = calls.filter((c) => c.method === "DELETE");
    expect(
      deletes.map((c) => [c.url.pathname, c.url.searchParams.get("versionId")]),
    ).toEqual([
      ["/sksat-gallery/V/a.png", "v1"],
      ["/sksat-gallery/V/a.png", "v2"],
      ["/sksat-gallery/V/a.png", "v3"],
    ]);
  });

  it("does nothing for a key with no versions left", async () => {
    const fetchFn = vi.fn(async () => new Response(list([])));
    expect(await deleteAllVersions(config, "/gone.png", fetchFn, now)).toBe(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("reports a key without the rights in plain words", async () => {
    const fetchFn = vi.fn(
      async () => new Response("AccessDenied", { status: 403 }),
    );
    await expect(
      deleteAllVersions(config, "/a.png", fetchFn, now),
    ).rejects.toBeInstanceOf(DeletePermissionError);
    await expect(
      deleteAllVersions(config, "/a.png", fetchFn, now),
    ).rejects.toThrow("削除の権限がありません");
  });

  it("treats a version that is already gone as deleted, other errors as errors", async () => {
    let status = 404;
    const fetchFn = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "DELETE"
        ? new Response(null, { status })
        : new Response(list([["Version", "a.png", "v1"]])),
    );
    expect(await deleteAllVersions(config, "/a.png", fetchFn, now)).toBe(1);
    status = 500;
    await expect(
      deleteAllVersions(config, "/a.png", fetchFn, now),
    ).rejects.toThrow("HTTP 500");
  });
});
