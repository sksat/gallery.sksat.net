import { $, component$, useSignal, type Signal } from "@builder.io/qwik";
import { formatCount } from "~/lib/cf-graphql";
import { countryLabel } from "~/lib/web-analytics";
import {
  mapClassBounds,
  mapClassLabels,
  mapClassOf,
  rampSteps,
  viewsByCode,
} from "~/lib/world-map";
import {
  WORLD_COUNTRIES,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "~/lib/world-map.gen";
import { muted } from "./ui";

// Page views per country as a choropleth: one blue, lighter for fewer
// (log classes, lib/world-map.ts), grey for none. The paths are drawn on
// the server from a generated module (scripts/gen-world-map.ts), so the
// page loads no atlas, projection or tiles. Hovering (or tapping) a
// country names it with its views; the list beside the map has the same
// numbers for keyboards and screen readers, and the countries too small
// for this scale (Singapore, Hong Kong, …).

/**
 * Sequential ramp, light → dark on the light surface; in dark mode the
 * other way round, so few views recede into the dark card.
 */
const RAMP =
  "[--m0:#b7d3f6] [--m1:#86b6ef] [--m2:#3987e5] [--m3:#256abf] [--m4:#104281] [--mn:#f4f4f5] [--ms:#ffffff] " +
  "dark:[--m0:#184f95] dark:[--m1:#256abf] dark:[--m2:#3987e5] dark:[--m3:#6da7ec] dark:[--m4:#b7d3f6] dark:[--mn:#27272a] dark:[--ms:#18181b]";

type Tip = { name: string; views: number; x: number; y: number };

const MAPPED = new Set(WORLD_COUNTRIES.map((c) => c.code));

// The countries, apart from the tooltip so that hovering re-renders only
// the tooltip, never the paths.
const Shapes = component$<{ fills: Record<string, number> }>(({ fills }) => (
  <svg
    viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`}
    class="block h-auto w-full [&_path]:stroke-[var(--ms)] [&_path]:[stroke-width:0.5px] [&_path:hover]:stroke-zinc-900 [&_path:hover]:[stroke-width:1.5px] dark:[&_path:hover]:stroke-white"
    role="img"
    aria-label="国ごとのページビューの地図"
  >
    {WORLD_COUNTRIES.map((c, i) => {
      const step = c.code === null ? undefined : fills[c.code];
      const views = c.code === null ? 0 : (fills[`#${c.code}`] ?? 0);
      return (
        <path
          key={i}
          d={c.d}
          vector-effect="non-scaling-stroke"
          style={{
            fill: step === undefined ? "var(--mn)" : `var(--m${step})`,
          }}
          data-name={c.code ? countryLabel(c.code) : c.name}
          data-views={views}
          data-code={c.code ?? undefined}
        />
      );
    })}
  </svg>
));

const MapTip = component$<{ tip: Signal<Tip | null> }>(({ tip }) => {
  const t = tip.value;
  if (!t) return null;
  return (
    <div
      aria-hidden="true"
      class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs whitespace-nowrap shadow-md dark:border-zinc-700 dark:bg-zinc-900"
      style={{ left: `${t.x}px`, top: `${t.y - 12}px` }}
      data-testid="map-tooltip"
    >
      <p class="text-sm font-semibold tabular-nums">
        {t.views > 0 ? formatCount(t.views) : "なし"}
      </p>
      <p class={muted}>{t.name}</p>
    </div>
  );
});

export const WorldMap = component$<{
  countries: { country: string; pageViews: number }[];
}>(({ countries }) => {
  const tip = useSignal<Tip | null>(null);
  const views = viewsByCode(countries);
  // The shades span the countries the map can show: one too small for it
  // (Singapore, Hong Kong) must not take the darkest.
  const max = Math.max(
    0,
    ...[...views].filter(([code]) => MAPPED.has(code)).map(([, v]) => v),
  );
  const bounds = mapClassBounds(max);
  const steps = rampSteps(bounds.length);
  const labels = mapClassLabels(bounds, max);
  // Ramp step by code, and views by "#code" (one plain object, which
  // serializes smaller than two).
  const fills: Record<string, number> = {};
  for (const [code, v] of views) {
    const c = mapClassOf(v, bounds);
    if (c !== null) fills[code] = steps[c];
    fills[`#${code}`] = v;
  }

  const show = $((ev: PointerEvent, el: HTMLElement) => {
    const p = (ev.target as Element | null)?.closest?.("path[data-name]");
    if (!p) {
      tip.value = null;
      return;
    }
    const r = el.getBoundingClientRect();
    tip.value = {
      name: p.getAttribute("data-name") ?? "",
      views: Number(p.getAttribute("data-views")) || 0,
      x: Math.min(Math.max(ev.clientX - r.left, 48), r.width - 48),
      y: ev.clientY - r.top,
    };
  });

  return (
    <figure class={RAMP} data-testid="world-map">
      <div
        class="relative touch-pan-y"
        onPointerMove$={show}
        onPointerDown$={show}
        onPointerLeave$={() => (tip.value = null)}
      >
        <Shapes fills={fills} />
        <MapTip tip={tip} />
      </div>
      <figcaption
        class={[
          "mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs",
          muted,
        ]}
      >
        <span>ページビュー</span>
        <span class="flex items-center gap-1">
          <span
            aria-hidden="true"
            class="size-2.5 rounded-sm bg-[var(--mn)] ring-1 ring-zinc-300 ring-inset dark:ring-zinc-600"
          />
          なし
        </span>
        {labels.map((label, i) => (
          <span key={label} class="flex items-center gap-1 tabular-nums">
            <span
              aria-hidden="true"
              class="size-2.5 rounded-sm"
              style={{ background: `var(--m${steps[i]})` }}
            />
            {label}
          </span>
        ))}
      </figcaption>
      {/* Every country with views, for screen readers (the list beside
          the map has the first ten). */}
      <table class="sr-only">
        <caption>国ごとのページビュー (すべて)</caption>
        <thead>
          <tr>
            <th scope="col">国</th>
            <th scope="col">ページビュー</th>
          </tr>
        </thead>
        <tbody>
          {countries.map((c, i) => (
            <tr key={i}>
              <th scope="row">{countryLabel(c.country)}</th>
              <td>{c.pageViews}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
});
