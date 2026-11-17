import { component$ } from "@builder.io/qwik";
import { Link, routeLoader$, type DocumentHead } from "@builder.io/qwik-city";
import { D1Card } from "~/components/d1-card";
import { StorageCard } from "~/components/storage-card";
import { buttonSecondary, card, muted } from "~/components/ui";
import {
  fetchD1Usage,
  getAnalyticsConfig,
  type D1UsageResult,
  type SimpleCache,
} from "~/lib/d1-usage";
import { getDB } from "~/lib/env";
import {
  fetchStorageRows,
  summarizeStorage,
  type StorageSummary,
} from "~/lib/storage";

type DashboardData = {
  /** null without a D1 binding (pnpm dev, previews); "error" if the query failed. */
  storage: StorageSummary | null | "error";
  dbBytes: number | null;
  usage: D1UsageResult;
};

// The Workers Cache API (caches.default), absent outside workerd.
const defaultCache = (): SimpleCache | null => {
  const c = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  return c
    ? {
        match: (key) => c.match(new Request(key)),
        put: (key, res) => c.put(new Request(key), res),
      }
    : null;
};

// The dashboard renders without D1 (the cards then say so), so a missing
// binding is not an error page here.
export const useDashboard = routeLoader$<DashboardData>(
  async ({ platform }) => {
    const usagePromise = fetchD1Usage(getAnalyticsConfig(platform), {
      fetch,
      cache: defaultCache(),
      now: new Date(),
    });
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/ loader: getDB failed:", err);
      return { storage: null, dbBytes: null, usage: await usagePromise };
    }
    const [storage, usage] = await Promise.all([
      fetchStorageRows(db).catch((err) => {
        console.error("/ loader: storage query failed:", err);
        return null;
      }),
      usagePromise,
    ]);
    return storage
      ? {
          storage: summarizeStorage(storage.rows),
          dbBytes: storage.dbBytes,
          usage,
        }
      : { storage: "error", dbBytes: null, usage };
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

      <div class="grid gap-4 md:grid-cols-2">
        <section class={[card, "flex flex-col p-5"]}>
          <h2 class="text-base font-semibold">Media</h2>
          <p class={["mt-1 flex-1 text-sm", muted]}>
            Browse every photo in D1 and edit its visibility, world, camera and
            tags. The public site reads D1 through the API Worker, so saved
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
