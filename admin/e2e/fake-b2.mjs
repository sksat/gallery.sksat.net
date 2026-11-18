// A stand-in for the B2 bucket's S3 API in E2E (no real B2): accepts the
// browser's presigned PUTs with CORS, the way the bucket's CORS rule and
// SigV4 check would. Started by e2e/start-test-server.sh.
//
// Checks, independently of src/lib/sigv4.ts (node:crypto here): the query
// signature with the test key, its expiry, and that the body's SHA-256 is
// the signed x-amz-meta-sha256. GET /__uploads lists what was stored;
// GET /__stat?key=<file> is what the admin's upload check sees
// (E2E_FAKE_B2_STAT_URL, in place of the image Worker's stat).
//
// Usage: node e2e/fake-b2.mjs <port> <bucket> <keyId> <secret> <region>
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";

const [port, bucket, keyId, secret, region] = process.argv.slice(2);
const uploads = [];
let versions = 0;

const enc = (s) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

/** null if the presigned request is valid, else the reason. */
const checkSignature = (req, url) => {
  const q = url.searchParams;
  const signature = q.get("X-Amz-Signature");
  const credential = q.get("X-Amz-Credential") ?? "";
  const datetime = q.get("X-Amz-Date") ?? "";
  const signed = (q.get("X-Amz-SignedHeaders") ?? "").split(";");
  if (!signature || !credential.startsWith(`${keyId}/`)) return "credential";
  const scope = credential.slice(keyId.length + 1);
  if (scope !== `${datetime.slice(0, 8)}/${region}/s3/aws4_request`) {
    return "scope";
  }
  const t = Date.parse(
    datetime.replace(
      /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/,
      "$1-$2-$3T$4:$5:$6Z",
    ),
  );
  if (!(Date.now() < t + Number(q.get("X-Amz-Expires")) * 1000)) {
    return "expired";
  }
  const required =
    req.method === "PUT"
      ? ["host", "content-type", "x-amz-meta-sha256"]
      : ["host"];
  for (const h of required) {
    if (!signed.includes(h)) return `unsigned ${h}`;
  }
  const query = [...q]
    .filter(([k]) => k !== "X-Amz-Signature")
    .map(([k, v]) => [enc(k), enc(v)])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonical = [
    req.method,
    url.pathname,
    query,
    signed.map((h) => `${h}:${String(req.headers[h] ?? "").trim()}\n`).join(""),
    signed.join(";"),
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const toSign = [
    "AWS4-HMAC-SHA256",
    datetime,
    scope,
    createHash("sha256").update(canonical).digest("hex"),
  ].join("\n");
  let key = hmac(`AWS4${secret}`, datetime.slice(0, 8));
  for (const part of [region, "s3", "aws4_request"]) key = hmac(key, part);
  return hmac(key, toSign).toString("hex") === signature
    ? null
    : "SignatureDoesNotMatch";
};

const cors = (req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Expose-Headers", "ETag");
  }
};

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  cors(req, res);
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "PUT");
    res.setHeader(
      "Access-Control-Allow-Headers",
      req.headers["access-control-request-headers"] ?? "",
    );
    res.setHeader("Access-Control-Max-Age", "60");
    res.writeHead(204).end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/__uploads") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(uploads));
    return;
  }
  // Stands in for the image Worker's AdminImage.stat (a HEAD) in E2E.
  if (req.method === "GET" && url.pathname === "/__stat") {
    const key = url.searchParams.get("key");
    const found = uploads.findLast((u) => u.key === key);
    if (!found) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ size: found.size, sha256: found.sha256 }));
    return;
  }
  // Deleting for good (admin's b2-delete.ts): ListObjectVersions, then a
  // DELETE per versionId. Keys containing "nodelete" answer 403, like a
  // key without the deleteFiles capability.
  if (
    (req.method === "GET" && url.pathname === `/${bucket}`) ||
    (req.method === "DELETE" && url.pathname.startsWith(`/${bucket}/`))
  ) {
    const bad = checkSignature(req, url);
    if (bad) {
      res.writeHead(403, { "Content-Type": "text/plain" }).end(bad);
      return;
    }
    if (req.method === "GET") {
      if (!url.searchParams.has("versions")) {
        res.writeHead(400).end();
        return;
      }
      const prefix = url.searchParams.get("prefix") ?? "";
      const xml = uploads
        .filter((u) => u.key.slice(1).startsWith(prefix))
        .map(
          (u) =>
            `<Version><Key>${u.key.slice(1)}</Key><VersionId>${u.versionId}</VersionId></Version>`,
        )
        .join("");
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?><ListVersionsResult><IsTruncated>false</IsTruncated>${xml}</ListVersionsResult>`,
      );
      return;
    }
    const key = url.pathname.slice(bucket.length + 1);
    if (key.includes("nodelete")) {
      res.writeHead(403).end("AccessDenied");
      return;
    }
    const i = uploads.findIndex(
      (u) => u.key === key && u.versionId === url.searchParams.get("versionId"),
    );
    if (i < 0) {
      res.writeHead(404).end();
      return;
    }
    uploads.splice(i, 1);
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "PUT" || !url.pathname.startsWith(`/${bucket}/`)) {
    res.writeHead(404).end();
    return;
  }
  const bad = checkSignature(req, url);
  if (bad) {
    res.writeHead(403, { "Content-Type": "text/plain" }).end(bad);
    return;
  }
  const hash = createHash("sha256");
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    hash.update(chunk);
  });
  req.on("end", () => {
    const sha256 = hash.digest("hex");
    if (sha256 !== req.headers["x-amz-meta-sha256"]) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("BadDigest");
      return;
    }
    uploads.push({
      versionId: `v${++versions}`,
      key: url.pathname.slice(bucket.length + 1),
      size,
      sha256,
      contentType: req.headers["content-type"],
    });
    res.writeHead(200, { ETag: `"${sha256.slice(0, 32)}"` }).end();
  });
}).listen(Number(port), "127.0.0.1");
