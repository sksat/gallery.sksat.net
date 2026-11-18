import { component$ } from "@builder.io/qwik";
import { Link, routeLoader$, type DocumentHead } from "@builder.io/qwik-city";
import { AccessCard, type TopPhoto } from "~/components/access-card";
import { D1Card } from "~/components/d1-card";
import { StorageCard } from "~/components/storage-card";
import { buttonSecondary, card, muted } from "~/components/ui";
import { defaultCache, graphqlEndpoint } from "~/lib/cf-graphql";
import {
  fetchD1Usage,
  getAnalyticsConfig,
  type D1UsageResult,
} from "~/lib/d1-usage";
import { getDB, getImageBase } from "~/lib/env";
import {
  fetchStorageRows,
  summarizeStorage,
  type StorageSummary,
} from "~/lib/storage";
import {
  fetchAccess,
  getWebAnalyticsConfig,
  parseAccessRange,
  photoIdsOf,
  photoRowsFor,
  topPhotos,
  type AccessRange,
  type AccessResult,
} from "~/lib/web-analytics";

type DashboardData = {
  /** null without a D1 binding (pnpm dev, previews); "error" if the query failed. */
  storage: StorageSummary | null | "error";
  dbBytes: number | null;
  usage: D1UsageResult;
  range: AccessRange;
  access: AccessResult;
  photos: TopPhoto[];
  imageBase: string | null;
};

// Most viewed photos: the photo pages of the access stats mapped to rows.
const topPhotosOf = async (
  db: D1Database | null,
  access: AccessResult,
): Promise<TopPhoto[]> => {
  if (!db || access.kind !== "ok") return [];
  try {
    const rows = await photoRowsFor(db, photoIdsOf(access.stats.pages));
    return topPhotos(access.stats.pages, rows);
  } catch (err) {
    console.error("/ loader: photo lookup failed:", err);
    return [];
  }
};

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
    const range = parseAccessRange(url.searchParams.get("range"));
    const usagePromise = fetchD1Usage(getAnalyticsConfig(platform), deps);
    const accessPromise = fetchAccess(
      getWebAnalyticsConfig(platform),
      range,
      deps,
    );
    const imageBase = getImageBase(platform);
    let db: D1Database | null = null;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/ loader: getDB failed:", err);
    }
    const [storage, usage, access] = await Promise.all([
      db
        ? fetchStorageRows(db).catch((err) => {
            console.error("/ loader: storage query failed:", err);
            return "error" as const;
          })
        : null,
      usagePromise,
      accessPromise,
    ]);
    const photos = await topPhotosOf(db, access);
    // The card lists only the top pages; the rest (up to PAGE_LIMIT) were
    // for the photo ranking and stay out of the page's serialized data.
    const shown: AccessResult =
      access.kind === "ok"
        ? {
            kind: "ok",
            stats: { ...access.stats, pages: access.stats.pages.slice(0, 10) },
          }
        : access;
    const common = { usage, range, access: shown, photos, imageBase };
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

      <AccessCard
        range={data.value.range}
        access={data.value.access}
        photos={data.value.photos}
        imageBase={data.value.imageBase}
      />

      <div class="grid gap-4 md:grid-cols-2">
        <section class={[card, "flex flex-col p-5"]}>
          <h2 class="text-base font-semibold">Media</h2>
          <p class={["mt-1 flex-1 text-sm", muted]}>
            Browse every photo in D1 and edit its visibility, platform, camera
            and tags. The public site reads D1 through the API Worker, so saved
            edits show up there within about a minute.
          </p>
          <div class="mt-4">
            <Link href="/media/" class={buttonSecondary}>
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
            <Link href="/camera/" class={buttonSecondary}>
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
