// Fake Cloudflare GraphQL Analytics API for E2E/VRT (bound as
// E2E_FAKE_GRAPHQL_URL by start-test-server.sh): fixed answers for the
// dashboard's D1 usage and Web Analytics queries, so the cards render with
// data without a real token. Counts are deterministic; the time buckets
// follow the request's `since` so they line up with the page's window.
//
// Usage: node e2e/fake-graphql.mjs <port> <token> <siteTag> <host>
import { createServer } from "node:http";

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

const access = (query, vars) => {
  const hourly = query.includes("datetimeHour");
  const start = Date.parse(vars.since);
  const n = hourly
    ? 24
    : Math.floor((Date.parse(vars.until) - start) / DAY) + 1;
  const series = [];
  for (let i = 0; i < n; i++) {
    const t = new Date(start + i * (hourly ? HOUR : DAY)).toISOString();
    const count = 5 + ((i * 7) % 13) * 3;
    series.push(
      g(count, Math.ceil(count / 2), {
        bucket: hourly ? t.replace(/\.\d{3}Z$/, "Z") : t.slice(0, 10),
      }),
    );
  }
  return account({
    total: [g(250, 140)],
    series,
    pages: [
      g(120, 80, { requestPath: "/" }),
      // Fixture photo 2 with and without the trailing slash.
      g(40, 30, { requestPath: "/photo/aaaaaaaaa3/" }),
      g(10, 8, { requestPath: "/photo/aaaaaaaaa3" }),
      g(25, 20, { requestPath: "/photo/aaaaaaaaa5/" }),
      g(15, 10, { requestPath: "/camera/" }),
      // No such photo, and an old numeric URL: pages, not photos.
      g(5, 5, { requestPath: "/photo/zzzzzzzzzz/" }),
      g(3, 3, { requestPath: "/photo/1" }),
    ],
    countries: [
      g(150, null, { countryName: "JP" }),
      g(40, null, { countryName: "US" }),
      g(10, null, { countryName: "DE" }),
    ],
    referrers: [
      g(100, null, { refererHost: "" }),
      g(30, null, { refererHost: `admin.${host}` }),
      g(20, null, { refererHost: "t.co" }),
      g(5, null, { refererHost: "github.com" }),
    ],
  });
};

createServer((req, res) => {
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
    if (query.includes("rumPageloadEventsAdaptiveGroups")) {
      if (vars.siteTag !== siteTag || vars.host !== host) {
        return json(res, 200, { data: null, errors: [{ message: "filter" }] });
      }
      return json(res, 200, access(query, vars));
    }
    json(res, 200, { data: null, errors: [{ message: "unknown query" }] });
  });
}).listen(Number(port), "127.0.0.1");
