import { component$ } from "@builder.io/qwik";
import { Link, routeLoader$, type DocumentHead } from "@builder.io/qwik-city";
import { listMedia } from "~/lib/db";
import { getDB } from "~/lib/env";
import type { MediaRow, MediaWorld } from "~/lib/types";

const PAGE_SIZE = 100;

type MediaListResult =
  | {
      kind: "ok";
      rows: MediaRow[];
      total: number;
      page: number;
      world: MediaWorld | null;
      q: string;
    }
  | { kind: "missing-binding"; message: string };

export const useMediaList = routeLoader$<MediaListResult>(
  async ({ platform, query, status }) => {
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      status(500);
      return {
        kind: "missing-binding",
        message: err instanceof Error ? err.message : String(err),
      };
    }
    const worldRaw = query.get("world");
    const world: MediaWorld | undefined =
      worldRaw === "Real" || worldRaw === "VRChat" ? worldRaw : undefined;
    const q = query.get("q")?.trim() || undefined;
    const pageRaw = Number(query.get("page") ?? "1");
    const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const offset = (page - 1) * PAGE_SIZE;

    const { rows, total } = await listMedia(db, {
      world,
      q,
      limit: PAGE_SIZE,
      offset,
    });
    return {
      kind: "ok",
      rows,
      total,
      page,
      world: world ?? null,
      q: q ?? "",
    };
  },
);

// Preserve the date-component as-stored. The fixture and prod data carry
// timezone-aware ISO strings (e.g. `2023-12-11T01:21:32.519+09:00`); using
// `toISOString().slice(0,10)` would silently shift JST midnight photos to
// the previous UTC day. We trust the leading 10 chars (YYYY-MM-DD) of the
// ISO string and only fall back to validation when the string is unrecognised.
const fmtTimestamp = (ts: string | null): string => {
  if (!ts) return "—";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(ts);
  return m ? m[1] : ts;
};

export default component$(() => {
  const data = useMediaList();
  if (data.value.kind === "missing-binding") {
    return (
      <div style={{ padding: "1.5rem", fontFamily: "sans-serif" }}>
        <p>
          <Link href="/">← Dashboard</Link>
        </p>
        <h1>Configuration error</h1>
        <pre
          style={{
            background: "#f5f5f5",
            padding: "0.8rem",
            borderRadius: "4px",
            whiteSpace: "pre-wrap",
          }}
        >
          {data.value.message}
        </pre>
      </div>
    );
  }
  const { rows, total, page, world, q } = data.value;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageUrl = (p: number): string => {
    const params = new URLSearchParams();
    if (world) params.set("world", world);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/media/?${s}` : "/media/";
  };

  return (
    <div style={{ padding: "1.5rem", fontFamily: "sans-serif" }}>
      <p>
        <Link href="/">← Dashboard</Link>
      </p>
      <h1>Media ({total})</h1>

      <form
        method="get"
        action="/media/"
        style={{
          margin: "1rem 0",
          display: "flex",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <label>
          World:&nbsp;
          <select name="world">
            <option value="" selected={world === null}>
              (any)
            </option>
            <option value="Real" selected={world === "Real"}>
              Real
            </option>
            <option value="VRChat" selected={world === "VRChat"}>
              VRChat
            </option>
          </select>
        </label>
        <label>
          File contains:&nbsp;
          <input type="text" name="q" value={q} placeholder="substring" />
        </label>
        <button type="submit">Filter</button>
        {(world || q) && <Link href="/media/">Reset</Link>}
      </form>

      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #ccc", textAlign: "left" }}>
            <th style={{ padding: "0.4rem" }}>ID</th>
            <th style={{ padding: "0.4rem" }}>File</th>
            <th style={{ padding: "0.4rem" }}>World</th>
            <th style={{ padding: "0.4rem" }}>Date</th>
            <th style={{ padding: "0.4rem" }}>Tags</th>
            <th style={{ padding: "0.4rem" }}>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}
            >
              <td style={{ padding: "0.4rem", color: "#888" }}>{row.id}</td>
              <td
                style={{
                  padding: "0.4rem",
                  fontFamily: "monospace",
                  fontSize: "0.85em",
                  wordBreak: "break-all",
                }}
              >
                {row.file}
              </td>
              <td style={{ padding: "0.4rem" }}>{row.world}</td>
              <td style={{ padding: "0.4rem" }}>
                {fmtTimestamp(row.timestamp)}
              </td>
              <td style={{ padding: "0.4rem" }}>
                {row.tags.length === 0 ? (
                  <span style={{ color: "#bbb" }}>—</span>
                ) : (
                  row.tags.join(", ")
                )}
              </td>
              <td
                style={{ padding: "0.4rem", color: "#888", fontSize: "0.85em" }}
              >
                {row.updated_at.slice(0, 10)}
              </td>
              <td style={{ padding: "0.4rem" }}>
                <Link href={`/media/${row.id}/`}>edit</Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} style={{ padding: "1rem", color: "#888" }}>
                No rows match.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <nav style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
        {page > 1 && <Link href={pageUrl(page - 1)}>← Prev</Link>}
        <span>
          Page {page} / {pageCount}
        </span>
        {page < pageCount && <Link href={pageUrl(page + 1)}>Next →</Link>}
      </nav>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Media — Admin",
};
