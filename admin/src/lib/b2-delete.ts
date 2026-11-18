// Deleting a photo's B2 object for good (b2-delete.spec.ts). The bucket
// keeps versions: an S3 DeleteObject without a version only hides the file
// behind a delete marker, and the bytes stay. So this lists every version
// of the key (ListObjectVersions, delete markers included) and deletes each
// by its versionId, after which nothing of it is left.
//
// The admin's B2 key (the upload key, B2_UPLOAD_KEY_ID) needs listFiles and
// deleteFiles for this, besides writeFiles for uploads. Without them B2
// answers 401/403, reported as 「削除の権限がありません」.

import type { UploadConfig } from "./b2";
import { amzDatetime, presign } from "./sigv4";

/** How long the server-side request URLs are valid. */
const EXPIRES = 60;

export class DeletePermissionError extends Error {
  constructor() {
    super("削除の権限がありません");
    this.name = "DeletePermissionError";
  }
}

export type ObjectVersion = { key: string; versionId: string };

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? unescapeXml(m[1]) : null;
};

/**
 * Versions and delete markers in a ListObjectVersions answer, and where to
 * go on when it was cut short.
 */
export const parseVersions = (
  xml: string,
): {
  versions: ObjectVersion[];
  next: { keyMarker: string; versionIdMarker: string } | null;
} => {
  const versions: ObjectVersion[] = [];
  for (const m of xml.matchAll(/<(Version|DeleteMarker)>([\s\S]*?)<\/\1>/g)) {
    const key = tag(m[2], "Key");
    const versionId = tag(m[2], "VersionId");
    if (key !== null && versionId !== null) versions.push({ key, versionId });
  }
  const truncated = tag(xml, "IsTruncated") === "true";
  const keyMarker = tag(xml, "NextKeyMarker");
  const versionIdMarker = tag(xml, "NextVersionIdMarker");
  return {
    versions,
    next:
      truncated && keyMarker !== null && versionIdMarker !== null
        ? { keyMarker, versionIdMarker }
        : null,
  };
};

const check = (res: Response, what: string) => {
  if (res.status === 401 || res.status === 403) {
    throw new DeletePermissionError();
  }
  if (!res.ok) throw new Error(`B2 ${what}: HTTP ${res.status}`);
};

/**
 * Delete every version of `file` (a media.file, "/a/b.png"). Nothing to do
 * when it has none (already deleted): safe to retry.
 */
export const deleteAllVersions = async (
  config: UploadConfig,
  file: string,
  fetchFn: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<number> => {
  const key = file.replace(/^\//, "");
  const sign = (method: string, url: string) =>
    presign({
      method,
      url,
      region: config.region,
      accessKeyId: config.keyId,
      secretAccessKey: config.applicationKey,
      datetime: amzDatetime(now()),
      expires: EXPIRES,
    });
  const bucketUrl = `${config.endpoint}/${config.bucket}`;
  const found: ObjectVersion[] = [];
  let marker: { keyMarker: string; versionIdMarker: string } | null = null;
  do {
    const url = new URL(bucketUrl);
    url.searchParams.set("versions", "");
    url.searchParams.set("prefix", key);
    if (marker) {
      url.searchParams.set("key-marker", marker.keyMarker);
      url.searchParams.set("version-id-marker", marker.versionIdMarker);
    }
    const res = await fetchFn(await sign("GET", url.toString()));
    check(res, "list versions");
    const page = parseVersions(await res.text());
    // The prefix also matches longer keys ("a.png.bak"): exact key only.
    found.push(...page.versions.filter((v) => v.key === key));
    marker = page.next;
  } while (marker);

  for (const v of found) {
    const url = new URL(`${bucketUrl}/${key}`);
    url.searchParams.set("versionId", v.versionId);
    const res = await fetchFn(await sign("DELETE", url.toString()), {
      method: "DELETE",
    });
    // Already gone (deleted by an earlier, interrupted try): fine.
    if (res.status === 404) continue;
    check(res, "delete");
  }
  return found.length;
};
