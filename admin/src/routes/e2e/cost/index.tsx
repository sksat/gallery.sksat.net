import { component$ } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import { CostCard } from "~/components/cost-card";
import { defaultCache, graphqlEndpoint } from "~/lib/cf-graphql";
import { loadCost } from "~/lib/cost";
import { fetchD1Usage, getAnalyticsConfig } from "~/lib/d1-usage";
import { e2eRoutesEnabled } from "~/lib/e2e-routes";
import { getDB } from "~/lib/env";

// E2E only: the dashboard's cost card as it is without the analytics
// token (?token=none) or with one the API refuses (?token=wrong), which
// the E2E server cannot otherwise show (it has the fake's token). 404
// unless the E2E server's E2E_TEST_ROUTES=1 binding is set and the request
// is on a loopback host.

export const useCost = routeLoader$(async ({ platform, url, error }) => {
  const env = (platform as { env?: Record<string, unknown> } | undefined)?.env;
  if (!e2eRoutesEnabled(env, url)) {
    throw error(404, "Not found");
  }
  const mode = url.searchParams.get("token");
  const p = {
    env: {
      ...env,
      CF_ANALYTICS_API_TOKEN: mode === "wrong" ? "wrong-token" : undefined,
    },
  };
  const deps = {
    fetch,
    cache: null,
    now: new Date(),
    endpoint: graphqlEndpoint(p, url),
  };
  return loadCost(
    p,
    getDB(platform),
    fetchD1Usage(getAnalyticsConfig(p), deps),
    deps,
    "/e2e/cost",
  );
});

export default component$(() => {
  const cost = useCost();
  return (
    <div class="mx-auto max-w-3xl">
      <CostCard summary={cost.value} />
    </div>
  );
});
