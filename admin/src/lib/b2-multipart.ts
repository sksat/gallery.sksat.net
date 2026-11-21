// S3 multipart uploads of large originals (videos) into the B2 bucket
// (b2-multipart.spec.ts). The bucket's CORS rule lets browsers PUT only,
// so the admin makes the other calls itself, with the upload key, through
// presigned URLs (sigv4.ts) it fetches server-side:
//
//   CreateMultipartUpload  POST   /<bucket>/<key>?uploads
//   ListParts              GET    /<bucket>/<key>?uploadId=…   (resume, and before completing)
//   CompleteMultipartUpload POST  /<bucket>/<key>?uploadId=…   (part list from ListParts)
//   AbortMultipartUpload   DELETE /<bucket>/<key>?uploadId=…
//
// and the browser PUTs each part to a presigned UploadPart URL
// (`?partNumber=N&uploadId=…`), signed in batches (multipart.ts).
// https://www.backblaze.com/docs/cloud-storage-s3-compatible-api
// (B2 maps these to its large-file calls; all need the key's writeFiles,
// ListParts listFiles as well, which the upload key has for the trash.)

import type { UploadConfig } from "./b2";
import type { SentPart, UploadedPart } from "./multipart";
import { amzDatetime, presign } from "./sigv4";

/** Server-side calls are made at once. */
const SERVER_EXPIRES = 60;
/** A part URL may wait behind other parts on a slow line. */
export const PART_URL_EXPIRES = 3600;

export class B2Error extends Error {
  constructor(
    readonly status: number,
    what: string,
  ) {
    super(`B2 ${what}: HTTP ${status}`);
    this.name = "B2Error";
  }
}

/**
 * Whether B2 refused a call for the key's capabilities (401 / 403): e.g.
 * ListParts without listFiles. Uploads then do without it.
 */
export const isRefused = (err: unknown): boolean =>
  err instanceof B2Error && (err.status === 401 || err.status === 403);

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? unescapeXml(m[1]) : null;
};

/** The UploadId of a CreateMultipartUpload answer. */
export const parseUploadId = (xml: string): string | null =>
  tag(xml, "UploadId");

/** Parts of a ListParts answer and the marker to go on from. */
export const parseListParts = (
  xml: string,
): { parts: UploadedPart[]; next: number | null } => {
  const parts: UploadedPart[] = [];
  for (const m of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
    const n = Number(tag(m[1], "PartNumber"));
    const etag = tag(m[1], "ETag");
    const size = Number(tag(m[1], "Size"));
    if (Number.isInteger(n) && etag !== null && Number.isFinite(size)) {
      parts.push({ partNumber: n, etag, size });
    }
  }
  const next = Number(tag(xml, "NextPartNumberMarker"));
  return {
    parts,
    next:
      tag(xml, "IsTruncated") === "true" && Number.isInteger(next)
        ? next
        : null,
  };
};

/** The body of CompleteMultipartUpload, parts in order. */
export const completeXml = (parts: readonly SentPart[]): string =>
  `<CompleteMultipartUpload>${[...parts]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map(
      (p) =>
        `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`,
    )
    .join("")}</CompleteMultipartUpload>`;

export type MultipartDeps = {
  fetchFn?: typeof fetch;
  now?: () => Date;
};

const objectUrl = (config: UploadConfig, file: string) =>
  `${config.endpoint}/${config.bucket}${file}`;

const signer =
  (config: UploadConfig, now: () => Date) =>
  (
    method: string,
    url: string,
    expires: number,
    headers?: Record<string, string>,
  ) =>
    presign({
      method,
      url,
      region: config.region,
      accessKeyId: config.keyId,
      secretAccessKey: config.applicationKey,
      datetime: amzDatetime(now()),
      expires,
      headers,
    });

/**
 * Start a multipart upload of `file` with these headers (Content-Type and
 * x-amz-meta-sha256, stored on the finished object like a single PUT's).
 */
export const createMultipart = async (
  config: UploadConfig,
  file: string,
  headers: Record<string, string>,
  { fetchFn = fetch, now = () => new Date() }: MultipartDeps = {},
): Promise<string> => {
  const url = new URL(objectUrl(config, file));
  url.searchParams.set("uploads", "");
  const res = await fetchFn(
    await signer(config, now)("POST", url.toString(), SERVER_EXPIRES, headers),
    { method: "POST", headers },
  );
  if (!res.ok) throw new B2Error(res.status, "create multipart upload");
  const id = parseUploadId(await res.text());
  if (!id) throw new Error("B2 create multipart upload: no UploadId");
  return id;
};

/**
 * Every part the bucket has of the upload, or null when the upload is
 * gone (completed, aborted, or expired: B2 answers 404 NoSuchUpload).
 */
export const listParts = async (
  config: UploadConfig,
  file: string,
  uploadId: string,
  { fetchFn = fetch, now = () => new Date() }: MultipartDeps = {},
): Promise<UploadedPart[] | null> => {
  const sign = signer(config, now);
  const out: UploadedPart[] = [];
  let marker: number | null = null;
  // At most 10,000 parts, 1,000 a page: a bound against a looping answer.
  for (let page = 0; page < 11; page++) {
    const url = new URL(objectUrl(config, file));
    url.searchParams.set("uploadId", uploadId);
    url.searchParams.set("max-parts", "1000");
    if (marker !== null) {
      url.searchParams.set("part-number-marker", String(marker));
    }
    const res = await fetchFn(
      await sign("GET", url.toString(), SERVER_EXPIRES),
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new B2Error(res.status, "list parts");
    const got = parseListParts(await res.text());
    out.push(...got.parts);
    marker = got.next;
    if (marker === null) return out;
  }
  throw new Error("B2 list parts: too many pages");
};

export const completeMultipart = async (
  config: UploadConfig,
  file: string,
  uploadId: string,
  parts: readonly SentPart[],
  { fetchFn = fetch, now = () => new Date() }: MultipartDeps = {},
): Promise<void> => {
  const url = new URL(objectUrl(config, file));
  url.searchParams.set("uploadId", uploadId);
  const res = await fetchFn(
    await signer(config, now)("POST", url.toString(), SERVER_EXPIRES),
    {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: completeXml(parts),
    },
  );
  // S3 may answer 200 with an <Error> body when completing fails late.
  const text = res.ok ? await res.text() : "";
  if (!res.ok || /<Error>/.test(text)) {
    throw new B2Error(res.ok ? 500 : res.status, "complete multipart upload");
  }
};

/** Drop an unfinished upload and its parts; done when it is gone already. */
export const abortMultipart = async (
  config: UploadConfig,
  file: string,
  uploadId: string,
  { fetchFn = fetch, now = () => new Date() }: MultipartDeps = {},
): Promise<void> => {
  const url = new URL(objectUrl(config, file));
  url.searchParams.set("uploadId", uploadId);
  const res = await fetchFn(
    await signer(config, now)("DELETE", url.toString(), SERVER_EXPIRES),
    { method: "DELETE" },
  );
  if (res.status === 404) return;
  if (!res.ok) throw new B2Error(res.status, "abort multipart upload");
};

/** Presigned UploadPart URLs for the browser, by part number. */
export const presignParts = async (
  config: UploadConfig,
  file: string,
  uploadId: string,
  numbers: readonly number[],
  now: () => Date = () => new Date(),
): Promise<{ partNumber: number; url: string }[]> => {
  const sign = signer(config, now);
  const out: { partNumber: number; url: string }[] = [];
  for (const n of numbers) {
    const url = new URL(objectUrl(config, file));
    url.searchParams.set("partNumber", String(n));
    url.searchParams.set("uploadId", uploadId);
    out.push({
      partNumber: n,
      url: await sign("PUT", url.toString(), PART_URL_EXPIRES),
    });
  }
  return out;
};
