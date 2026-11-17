// AWS Signature Version 4 query-string signing ("presigned URLs") for the
// S3-compatible API of the B2 bucket, with Web Crypto only (Workers and
// Node both have crypto.subtle). Covers what the upload needs: one request,
// UNSIGNED-PAYLOAD, a few extra signed headers. Checked against AWS's
// published example in sigv4.spec.ts.
//
// https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html

export type PresignRequest = {
  method: string;
  /** Full URL, path-style for B2: https://s3.<region>.backblazeb2.com/<bucket>/<key>. */
  url: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Signing time as YYYYMMDDTHHMMSSZ. */
  datetime: string;
  /** Validity in seconds (1 .. 604800). */
  expires: number;
  /**
   * Headers the request must carry with exactly these values, besides
   * `host` (always signed). Names are case-insensitive.
   */
  headers?: Record<string, string>;
};

const encoder = new TextEncoder();

const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );

export const sha256Hex = async (data: string): Promise<string> =>
  hex(await crypto.subtle.digest("SHA-256", encoder.encode(data)));

const hmac = async (
  key: ArrayBuffer | Uint8Array<ArrayBuffer>,
  data: string,
): Promise<ArrayBuffer> => {
  const k = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, encoder.encode(data));
};

/** RFC 3986 percent-encoding (what SigV4 calls UriEncode). */
export const uriEncode = (s: string): string =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** S3's canonical URI: each segment encoded once, slashes kept. */
const canonicalPath = (pathname: string): string =>
  pathname
    .split("/")
    .map((s) => uriEncode(decodeURIComponent(s)))
    .join("/");

const DATETIME_RE = /^\d{8}T\d{6}Z$/;

/** The parts of the signature, exposed for tests. */
export const canonicalRequest = (
  req: PresignRequest,
): { canonical: string; url: URL; scope: string } => {
  if (!DATETIME_RE.test(req.datetime)) {
    throw new Error(`bad datetime: ${req.datetime}`);
  }
  if (!Number.isInteger(req.expires) || req.expires < 1) {
    throw new Error(`bad expires: ${req.expires}`);
  }
  const url = new URL(req.url);
  const scope = `${req.datetime.slice(0, 8)}/${req.region}/s3/aws4_request`;
  const headers = new Map<string, string>([["host", url.host]]);
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    headers.set(name.toLowerCase(), value.trim().replace(/\s+/g, " "));
  }
  const names = [...headers.keys()].sort();
  const signedHeaders = names.join(";");

  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", `${req.accessKeyId}/${scope}`);
  url.searchParams.set("X-Amz-Date", req.datetime);
  url.searchParams.set("X-Amz-Expires", String(req.expires));
  url.searchParams.set("X-Amz-SignedHeaders", signedHeaders);
  const query = [...url.searchParams]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonical = [
    req.method.toUpperCase(),
    canonicalPath(url.pathname),
    query,
    names.map((n) => `${n}:${headers.get(n)}\n`).join(""),
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  // The URL's query in the same (canonical) encoding.
  url.search = query;
  return { canonical, url, scope };
};

/** The presigned URL for `req`. */
export const presign = async (req: PresignRequest): Promise<string> => {
  const { canonical, url, scope } = canonicalRequest(req);
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    req.datetime,
    scope,
    await sha256Hex(canonical),
  ].join("\n");
  let key: ArrayBuffer = await hmac(
    encoder.encode(`AWS4${req.secretAccessKey}`),
    req.datetime.slice(0, 8),
  );
  for (const part of [req.region, "s3", "aws4_request"]) {
    key = await hmac(key, part);
  }
  const signature = hex(await hmac(key, stringToSign));
  return `${url.toString()}&X-Amz-Signature=${signature}`;
};

/** `date` as SigV4's YYYYMMDDTHHMMSSZ. */
export const amzDatetime = (date: Date): string =>
  date.toISOString().replace(/[:-]|\.\d{3}/g, "");
