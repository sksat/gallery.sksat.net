import { component$ } from "@builder.io/qwik";
import { Link, routeLoader$, type DocumentHead } from "@builder.io/qwik-city";
import { AccessCard } from "~/components/access-card";
import { CostCard } from "~/components/cost-card";
import { D1Card } from "~/components/d1-card";
import { StorageCard } from "~/components/storage-card";
import { buttonSecondary, card, muted } from "~/components/ui";
import { defaultCache, graphqlEndpoint } from "~/lib/cf-graphql";
import { loadCost, type CostSummary } from "~/lib/cost";
import {
  fetchD1Usage,
  getAnalyticsConfig,
  type D1UsageResult,
} from "~/lib/d1-usage";
import { loadAccess, type AccessData } from "~/lib/access-load";
import { getDB, getImageBase } from "~/lib/env";
import {
  fetchStorageRows,
  summarizeStorage,
  type StorageSummary,
} from "~/lib/storage";
import { DEFAULT_ACCESS_RANGE } from "~/lib/web-analytics";

type DashboardData = {
  /** null without a D1 binding (pnpm dev, previews); "error" if the query failed. */
  storage: StorageSummary | null | "error";
  dbBytes: number | null;
  usage: D1UsageResult;
  /** The default range (24 hours); the others are on /analytics/. */
  access: AccessData;
  imageBase: string | null;
  cost: CostSummary;
};

/** How many of the most viewed photos the summary shows. */
const SUMMARY_PHOTOS = 6;

// The dashboard renders without D1 or the analytics token (the cards then
// say so), so neither is an error page here.
export const useDashboard = routeLoader$<DashboardData>(
  async ({ platform, url }) => {
    const deps = {
      fetch,
      cache: defaultCache(),
      now: new Date(),
      endpoint: graphqlEndpoint(platform, url),
    };
    const usagePromise = fetchD1Usage(getAnalyticsConfig(platform), deps);
    const imageBase = getImageBase(platform);
    let db: D1Database | null = null;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/ loader: getDB failed:", err);
    }
    const accessPromise = loadAccess(
      platform,
      db,
      DEFAULT_ACCESS_RANGE,
      deps,
      { photos: SUMMARY_PHOTOS, pages: 0 },
      "/ loader",
    );
    const costPromise = loadCost(platform, db, usagePromise, deps, "/ loader");
    const [storage, usage, access, cost] = await Promise.all([
      db
        ? fetchStorageRows(db).catch((err) => {
            console.error("/ loader: storage query failed:", err);
            return "error" as const;
          })
        : null,
      usagePromise,
      accessPromise,
      costPromise,
    ]);
    const common = { usage, access, imageBase, cost };
    if (storage === null || storage === "error") {
      return { ...common, storage, dbBytes: null };
    }
    return {
      ...common,
      storage: summarizeStorage(storage.rows),
      dbBytes: storage.dbBytes,
    };
  },
);

export default component$(() => {
  const data = useDashboard();
  return (
    <div class="space-y-8">
      <div>
        <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
          Gallery Admin Dashboard
        </h1>
        <p class={["mt-2 max-w-2xl text-sm", muted]}>
          This is the admin panel for gallery.sksat.net, protected by Cloudflare
          Access.
        </p>
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <StorageCard summary={data.value.storage} />
        </div>
        <D1Card dbBytes={data.value.dbBytes} usage={data.value.usage} />
      </div>

      <CostCard summary={data.value.cost} />

      <AccessCard data={data.value.access} imageBase={data.value.imageBase} />

      <div class="grid gap-4 md:grid-cols-2">
        <section class={[card, "flex flex-col p-5"]}>
          <h2 class="text-base font-semibold">Media</h2>
          <p class={["mt-1 flex-1 text-sm", muted]}>
            Browse every photo in D1 and edit its visibility, platform, camera
            and tags. The public site reads D1 through the API Worker, so saved
            edits show up there within about a minute.
          </p>
          <div class="mt-4">
            <Link prefetch="js" href="/media/" class={buttonSecondary}>
              Browse and edit metadata →
            </Link>
          </div>
        </section>

        <section class={[card, "flex flex-col p-5"]}>
          <h2 class="text-base font-semibold">Cameras</h2>
          <p class={["mt-1 flex-1 text-sm", muted]}>
            Register cameras with their manufacturer, product page and pictures,
            and link photos to them.
          </p>
          <div class="mt-4">
            <Link prefetch="js" href="/camera/" class={buttonSecondary}>
              Manage cameras →
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Admin Dashboard - gallery.sksat.net",
  meta: [
    {
      name: "description",
      content: "Admin panel for managing gallery.sksat.net",
    },
  ],
};
