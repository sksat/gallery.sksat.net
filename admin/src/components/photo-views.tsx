import { component$, Resource, useResource$ } from "@builder.io/qwik";
import { server$ } from "@builder.io/qwik-city";
import { defaultCache, formatCount, graphqlEndpoint } from "~/lib/cf-graphql";
import {
  fetchAccess,
  getWebAnalyticsConfig,
  photoCounts,
  type AccessResult,
} from "~/lib/web-analytics";
import { muted } from "./ui";

type ViewsResult =
  { kind: "ok"; d7: number; d30: number } | { kind: "unavailable" | "error" };

// The photo's page views (/photo/<public_id> and its /detail page, with or
// without the trailing slash) from the same cached Web Analytics answers as the dashboard (the
// 7 d and 30 d ranges).
const loadViews = server$(async function (
  publicId: string,
): Promise<ViewsResult> {
  const config = getWebAnalyticsConfig(this.platform);
  if (config.kind !== "ok") return { kind: "unavailable" };
  const deps = {
    fetch,
    cache: defaultCache(),
    now: new Date(),
    endpoint: graphqlEndpoint(this.platform, this.url),
  };
  const [d7, d30]: AccessResult[] = await Promise.all([
    fetchAccess(config, "7d", deps),
    fetchAccess(config, "30d", deps),
  ]);
  if (d7.kind !== "ok" || d30.kind !== "ok") return { kind: "error" };
  return {
    kind: "ok",
    d7: photoCounts(d7.stats.pages, publicId).pageViews,
    d30: photoCounts(d30.stats.pages, publicId).pageViews,
  };
});

/** One line on the edit page: "閲覧数 (概数) 7 日 12 · 30 日 34". */
export const PhotoViews = component$<{ public_id: string }>(({ public_id }) => {
  const views = useResource$(() => loadViews(public_id));
  return (
    <Resource
      value={views}
      onPending={() => <p class={["text-sm", muted]}>閲覧数: …</p>}
      onRejected={() => (
        <p class={["text-sm", muted]}>閲覧数を取得できませんでした</p>
      )}
      onResolved={(v) =>
        v.kind === "unavailable" ? (
          <></>
        ) : (
          <p class={["text-sm tabular-nums", muted]} data-testid="photo-views">
            {v.kind === "ok"
              ? `閲覧数 (概数) 7 日 ${formatCount(v.d7)} · 30 日 ${formatCount(v.d30)}`
              : "閲覧数を取得できませんでした"}
          </p>
        )
      }
    />
  );
});
