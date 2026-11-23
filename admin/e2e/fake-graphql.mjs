// Fake Cloudflare GraphQL Analytics API for E2E/VRT (bound as
// E2E_FAKE_GRAPHQL_URL by start-test-server.sh): fixed answers for the
// dashboard's D1 usage, cost (R2, Image Transformations, Workers) and Web
// Analytics queries, so the cards render with
// data without a real token. Counts are deterministic; the time buckets
// follow the request's `since` so they line up with the page's window.
//
// Usage: node e2e/fake-graphql.mjs <port> <token> <siteTag> <host>
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";

const [port, token, siteTag, host] = process.argv.slice(2);

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const account = (node) => ({
  data: { viewer: { accounts: [node] } },
  errors: null,
});
const g = (count, visits, dimensions) => ({
  count,
  ...(visits === null ? {} : { sum: { visits } }),
  ...(dimensions ? { dimensions } : {}),
});

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// Series rows are always per hour (datetimeHour). A 24 h window gets one
// row per hour; a longer one one row per day, in the first hour of each
// (JST) day the window starts at, so the page's days add up to it.
const slots = (vars) => {
  const start = Date.parse(vars.since);
  const len = Date.parse(vars.until) - start;
  const hourly = len < DAY;
  const n = hourly ? 24 : Math.floor(len / DAY) + 1;
  return Array.from({ length: n }, (_, i) =>
    new Date(start + i * (hourly ? HOUR : DAY))
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z"),
  );
};

const access = (vars) => {
  const series = slots(vars).map((bucket, i) => {
    const count = 5 + ((i * 7) % 13) * 3;
    return g(count, Math.ceil(count / 2), { bucket });
  });
  return account({
    total: [g(250, 140)],
    // +25% page views, −30% visits.
    previous: [g(200, 200)],
    series,
    pages: [
      g(120, 80, { requestPath: "/" }),
      // Fixture photo 2 with and without the trailing slash.
      g(40, 30, { requestPath: "/photo/aaaaaaaaa3/" }),
      g(10, 8, { requestPath: "/photo/aaaaaaaaa3" }),
      g(25, 20, { requestPath: "/photo/aaaaaaaaa5/" }),
      g(15, 10, { requestPath: "/camera/" }),
      // Fixture camera 1, both forms.
      g(12, 9, { requestPath: "/camera/virtuallens2/" }),
      g(2, 2, { requestPath: "/camera/virtuallens2" }),
      g(8, 6, { requestPath: "/calendar/2023/12/" }),
      g(6, 5, { requestPath: "/map/" }),
      // No such photo.
      g(5, 5, { requestPath: "/photo/zzzzzzzzzz/" }),
      // Fixture photo 5 (private now).
      g(4, 4, { requestPath: "/photo/aaaaaaaaa6/" }),
      // Fixture photos 1 and 3, a few views each (one on its detail page).
      g(3, 3, { requestPath: "/photo/aaaaaaaaa2/" }),
      g(2, 2, { requestPath: "/photo/aaaaaaaaa4/detail/" }),
      // Old numeric URLs: one row together, 6.
      g(3, 3, { requestPath: "/photo/1" }),
      g(2, 2, { requestPath: "/photo/0" }),
      g(1, 1, { requestPath: "/photo/30/" }),
    ],
    countries: [
      g(150, null, { countryName: "JP" }),
      g(40, null, { countryName: "US" }),
      g(10, null, { countryName: "DE" }),
      g(6, null, { countryName: "KR" }),
      g(4, null, { countryName: "TW" }),
      g(3, null, { countryName: "FR" }),
      g(2, null, { countryName: "GB" }),
      g(2, null, { countryName: "BR" }),
      g(1, null, { countryName: "AU" }),
      g(1, null, { countryName: "CA" }),
      // Too small for the map: in the list only (11th, so not even there).
      g(1, null, { countryName: "SG" }),
    ],
    referrers: [
      g(100, null, { refererHost: "" }),
      g(30, null, { refererHost: `admin.${host}` }),
      g(20, null, { refererHost: "t.co" }),
      g(5, null, { refererHost: "github.com" }),
      // Not well known: their favicons through /api/favicon (the fake
      // above), one found and one not.
      g(4, null, { refererHost: "friends-blog.net" }),
      g(3, null, { refererHost: "misskey.io" }),
      g(2, null, { refererHost: "nofavicon.net" }),
    ],
  });
};

// One photo's numbers (a query filtered with requestPath_in): fixture
// photo 2 (aaaaaaaaa3) has views on its viewer and detail pages in every
// bucket, any other photo none.
const photoAccess = (query, vars) => {
  const id = /"\/photo\/([^"/]+)"/.exec(query)?.[1];
  if (id !== "aaaaaaaaa3") {
    return account({
      total: [],
      previous: [],
      series: [],
      countries: [],
      referrers: [],
    });
  }
  const series = [];
  for (const [i, bucket] of slots(vars).entries()) {
    series.push(
      g(2 + (i % 3), null, { bucket, requestPath: `/photo/${id}/` }),
      g(1, null, { bucket, requestPath: `/photo/${id}` }),
      g(i % 2, null, { bucket, requestPath: `/photo/${id}/detail/` }),
    );
  }
  const total = series.reduce((s, x) => s + x.count, 0);
  return account({
    total: [g(total, 9)],
    // The period before: twice as many (−50%), as many visits (±0%).
    previous: [g(total * 2, 9)],
    series,
    countries: [
      g(24, null, { countryName: "JP" }),
      g(6, null, { countryName: "TW" }),
    ],
    referrers: [
      g(20, null, { refererHost: host }),
      g(7, null, { refererHost: "" }),
      g(3, null, { refererHost: "bsky.app" }),
    ],
  });
};

// A 16×16 PNG of one colour, made here so the fake needs no image file.
const crc32 = (buf) => {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const solidPng = (r, g, b) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(16, 0);
  ihdr.writeUInt32BE(16, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.from([
    0,
    ...Array.from({ length: 16 }, () => [r, g, b]).flat(),
  ]);
  const raw = Buffer.concat(Array.from({ length: 16 }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};
const ICON = solidPng(0x16, 0xa3, 0x4a);

// Referrer sites for /api/favicon (bound as E2E_FAKE_FAVICON_URL): every
// request the admin would send to https://<host>/<path> comes here as
// GET /__favicon/<host>/<path>. friends-blog.net has no
// /favicon.ico but links its icon from its home page; any other host has
// nothing (the admin then answers its globe).
const favicon = (req, res) => {
  const [, , site = "", ...rest] = new URL(req.url, "http://x").pathname.split(
    "/",
  );
  const path = `/${rest.join("/")}`;
  if (site === "friends-blog.net") {
    if (path === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(
        '<html><head><link rel="icon" href="/static/icon.png"></head></html>',
      );
    }
    if (path === "/static/icon.png") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(ICON);
    }
  }
  res.writeHead(404, { "content-type": "text/html" });
  res.end("<html>not found</html>");
};

createServer((req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/__favicon/")) {
    return favicon(req, res);
  }
  if (req.method !== "POST") return json(res, 405, {});
  if (req.headers.authorization !== `Bearer ${token}`) {
    return json(res, 200, { data: null, errors: [{ message: "auth" }] });
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const { query = "", variables: vars = {} } = JSON.parse(raw || "{}");
    if (query.includes("d1AnalyticsAdaptiveGroups")) {
      return json(
        res,
        200,
        account({
          d1AnalyticsAdaptiveGroups: [
            {
              sum: {
                readQueries: 120,
                writeQueries: 8,
                rowsRead: 45000,
                rowsWritten: 300,
              },
            },
          ],
        }),
      );
    }
    // The cost card (src/lib/cost.ts). Small enough that even carried on
    // from the 1st to a whole month they stay in the free tiers, so the
    // charges do not move with the date. R2: 4.2 GB, operations by type
    // (Class A 12,000; Class B 250,000; deletes free).
    if (query.includes("r2StorageAdaptiveGroups")) {
      if (vars.bucket !== "gallery-media-cache") {
        return json(res, 200, { data: null, errors: [{ message: "bucket" }] });
      }
      const op = (actionType, requests) => ({
        sum: { requests },
        dimensions: { actionType },
      });
      return json(
        res,
        200,
        account({
          storage: [
            {
              max: {
                payloadSize: 4_199_000_000,
                metadataSize: 1_000_000,
                objectCount: 13_000,
              },
              dimensions: { datetime: vars.now },
            },
          ],
          operations: [
            op("PutObject", 11_500),
            op("ListObjects", 500),
            op("GetObject", 240_000),
            op("HeadObject", 10_000),
            op("DeleteObject", 300),
          ],
        }),
      );
    }
    // Unique transformations, a running total per day since the 1st.
    if (
      query.includes("imagesUniqueTransformationsAccumulatedSinceStartOfMonth")
    ) {
      return json(
        res,
        200,
        account({
          imagesUniqueTransformationsAccumulatedSinceStartOfMonth: [
            { date: vars.today, transformations: 150 },
            { date: vars.monthStart, transformations: 20 },
          ],
        }),
      );
    }
    if (query.includes("workersInvocationsAdaptive")) {
      return json(
        res,
        200,
        account({
          workersInvocationsAdaptive: [
            { sum: { requests: 8000 } },
            { sum: { requests: 4345 } },
          ],
        }),
      );
    }
    if (query.includes("rumPageloadEventsAdaptiveGroups")) {
      if (vars.siteTag !== siteTag || vars.host !== host) {
        return json(res, 200, { data: null, errors: [{ message: "filter" }] });
      }
      return json(
        res,
        200,
        query.includes("requestPath_in")
          ? photoAccess(query, vars)
          : access(vars),
      );
    }
    json(res, 200, { data: null, errors: [{ message: "unknown query" }] });
  });
}).listen(Number(port), "127.0.0.1");
