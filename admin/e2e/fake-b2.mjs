// A stand-in for the B2 bucket's S3 API in E2E (no real B2): accepts the
// browser's presigned PUTs with CORS, the way the bucket's CORS rule and
// SigV4 check would. Started by e2e/start-test-server.sh.
//
// Checks, independently of src/lib/sigv4.ts (node:crypto here): the query
// signature with the test key, its expiry, and that the body's SHA-256 is
// the signed x-amz-meta-sha256. GET /__uploads lists what was stored;
// GET /__stat?key=<file> is what the admin's upload check sees
// (E2E_FAKE_B2_STAT_URL, in place of the image Worker's stat); GET
// /__bytes reads a stored or seeded (PUT /__seed) object's bytes, GET
// /__object the whole of one (E2E_FAKE_B2_OBJECT_URL). A PUT
// whose key contains "slow" is read at 1 MiB/s.
//
// Usage: node e2e/fake-b2.mjs <port> <bucket> <keyId> <secret> <region>
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";

const [port, bucket, keyId, secret, region] = process.argv.slice(2);
/** How fast a PUT whose key contains "slow" is read. */
const SLOW_BYTES_PER_SEC = 1024 * 1024;
const uploads = [];
let versions = 0;
/** What was PUT, by key (GET /__bytes reads it). */
const bodies = new Map();
/** The og caption GET /__caption answers (JSON). */
let caption = JSON.stringify({
  primary: "2023-12-02 09:00 JST",
  secondary: "logilabo VirtualLens2 · #VRChat",
});

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
  // A whole object's PUT and CreateMultipartUpload carry its type and
  // hash; a part's PUT only the host.
  const whole =
    (req.method === "PUT" && !q.has("partNumber")) ||
    (req.method === "POST" && q.has("uploads"));
  const required = whole
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

/** Multipart uploads in progress, by UploadId. */
const multiparts = new Map();
let multipartIds = 0;

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

/** Store a finished object like a PUT does. */
const store = (key, body, contentType) => {
  const sha256 = createHash("sha256").update(body).digest("hex");
  uploads.push({
    versionId: `v${++versions}`,
    key,
    size: body.length,
    sha256,
    contentType,
  });
  bodies.set(key, body);
  return sha256;
};

/**
 * S3 multipart (admin's b2-multipart.ts): CreateMultipartUpload (POST
 * ?uploads), UploadPart (PUT ?partNumber&uploadId, from the browser),
 * ListParts (GET ?uploadId), CompleteMultipartUpload (POST ?uploadId),
 * AbortMultipartUpload (DELETE ?uploadId). Every request is presigned.
 * Completing checks the parts' SHA-256 against the x-amz-meta-sha256
 * given at creation, like a single PUT. Returns false when not multipart.
 */
const multipart = async (req, res, url) => {
  const q = url.searchParams;
  if (!url.pathname.startsWith(`/${bucket}/`)) return false;
  if (!(q.has("uploads") || q.has("uploadId"))) return false;
  const bad = checkSignature(req, url);
  if (bad) {
    res.writeHead(403, { "Content-Type": "text/plain" }).end(bad);
    return true;
  }
  const key = url.pathname.slice(bucket.length + 1);
  const xml = (body) => {
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>${body}`);
  };
  if (req.method === "POST" && q.has("uploads")) {
    const uploadId = `mp${++multipartIds}`;
    multiparts.set(uploadId, {
      key,
      contentType: req.headers["content-type"],
      sha256: req.headers["x-amz-meta-sha256"],
      parts: new Map(),
    });
    xml(
      `<InitiateMultipartUploadResult><Key>${key.slice(1)}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`,
    );
    return true;
  }
  const upload = multiparts.get(q.get("uploadId"));
  if (!upload || upload.key !== key) {
    res.writeHead(404, { "Content-Type": "application/xml" });
    res.end("<Error><Code>NoSuchUpload</Code></Error>");
    return true;
  }
  if (req.method === "PUT" && q.has("partNumber")) {
    const body = await readBody(req);
    const etag = `"${createHash("md5").update(body).digest("hex")}"`;
    upload.parts.set(Number(q.get("partNumber")), { body, etag });
    res.writeHead(200, { ETag: etag }).end();
    return true;
  }
  if (req.method === "GET") {
    // Like the production key without listFiles: ListParts is refused.
    if (key.includes("nolist")) {
      res.writeHead(403, { "Content-Type": "application/xml" });
      res.end("<Error><Code>AccessDenied</Code></Error>");
      return true;
    }
    const parts = [...upload.parts]
      .sort(([a], [b]) => a - b)
      .map(
        ([n, p]) =>
          `<Part><PartNumber>${n}</PartNumber><ETag>${p.etag.replace(/"/g, "&quot;")}</ETag><Size>${p.body.length}</Size></Part>`,
      )
      .join("");
    xml(
      `<ListPartsResult><UploadId>${q.get("uploadId")}</UploadId><IsTruncated>false</IsTruncated>${parts}</ListPartsResult>`,
    );
    return true;
  }
  if (req.method === "POST") {
    const body = (await readBody(req)).toString();
    const numbers = [...body.matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map(
      (m) => Number(m[1]),
    );
    const etags = [...body.matchAll(/<ETag>([^<]*)<\/ETag>/g)].map((m) =>
      m[1].replace(/&quot;/g, '"'),
    );
    if (
      numbers.some(
        (n, i) => !upload.parts.has(n) || upload.parts.get(n).etag !== etags[i],
      )
    ) {
      res.writeHead(400).end("InvalidPart");
      return true;
    }
    const whole = Buffer.concat(numbers.map((n) => upload.parts.get(n).body));
    if (createHash("sha256").update(whole).digest("hex") !== upload.sha256) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("BadDigest");
      return true;
    }
    store(key, whole, upload.contentType);
    multiparts.delete(q.get("uploadId"));
    xml(
      `<CompleteMultipartUploadResult><Key>${key.slice(1)}</Key></CompleteMultipartUploadResult>`,
    );
    return true;
  }
  if (req.method === "DELETE") {
    multiparts.delete(q.get("uploadId"));
    res.writeHead(204).end();
    return true;
  }
  res.writeHead(400).end();
  return true;
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  cors(req, res);
  if (req.method !== "OPTIONS" && (await multipart(req, res, url))) return;
  if (req.method === "GET" && url.pathname === "/__multipart") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([...multiparts.keys()]));
    return;
  }
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
  // Stands in for the image Worker's AdminImage.bytes (metadata reader):
  // ?key=&offset=&length= or ?key=&suffix=, the object's size in a header.
  if (req.method === "GET" && url.pathname === "/__bytes") {
    const body = bodies.get(url.searchParams.get("key"));
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    const suffix = url.searchParams.get("suffix");
    const part =
      suffix !== null
        ? body.subarray(Math.max(0, body.length - Number(suffix)))
        : body.subarray(
            Number(url.searchParams.get("offset")),
            Number(url.searchParams.get("offset")) +
              Number(url.searchParams.get("length")),
          );
    res.writeHead(200, { "x-object-size": String(body.length) });
    res.end(part);
    return;
  }
  // Stands in for AdminImage.caption (E2E_FAKE_CAPTION_URL): the caption
  // of every photo's og card, which PUT /__caption replaces (JSON).
  if (url.pathname === "/__caption") {
    if (req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        caption = Buffer.concat(chunks).toString("utf8");
        res.writeHead(204).end();
      });
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(caption);
    return;
  }
  // Stands in for AdminImage.object (making resized copies): the whole
  // object at ?key=.
  if (req.method === "GET" && url.pathname === "/__object") {
    const body = bodies.get(url.searchParams.get("key"));
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(body.length),
    });
    res.end(body);
    return;
  }
  // PUT /__seed?key=<file>: puts a fixture photo's original in place, for
  // /__bytes and /__object (no upload row, so nothing lists it); DELETE
  // takes it away.
  if (req.method === "DELETE" && url.pathname === "/__seed") {
    bodies.delete(url.searchParams.get("key"));
    res.writeHead(204).end();
    return;
  }
  if (req.method === "PUT" && url.pathname === "/__seed") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      bodies.set(url.searchParams.get("key"), Buffer.concat(chunks));
      res.writeHead(204).end();
    });
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
  const chunks = [];
  // A key containing "slow" is read at SLOW_BYTES_PER_SEC, like a slow
  // line, so the browser sees its upload progress over several seconds.
  const slow = url.pathname.includes("slow");
  req.on("data", (chunk) => {
    size += chunk.length;
    hash.update(chunk);
    chunks.push(chunk);
    if (slow) {
      req.pause();
      setTimeout(
        () => req.resume(),
        (chunk.length / SLOW_BYTES_PER_SEC) * 1000,
      );
    }
  });
  req.on("end", () => {
    const sha256 = hash.digest("hex");
    if (sha256 !== req.headers["x-amz-meta-sha256"]) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("BadDigest");
      return;
    }
    const key = url.pathname.slice(bucket.length + 1);
    uploads.push({
      versionId: `v${++versions}`,
      key,
      size,
      sha256,
      contentType: req.headers["content-type"],
    });
    bodies.set(key, Buffer.concat(chunks));
    res.writeHead(200, { ETag: `"${sha256.slice(0, 32)}"` }).end();
  });
}).listen(Number(port), "127.0.0.1");
