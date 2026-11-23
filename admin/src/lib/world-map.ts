// Pure helpers for the countries map of /analytics/ (components/
// world-map.tsx): which shade a country's page views get, and the legend.
//
// Views per country are very uneven (the home country has most of them),
// so the shades are classes on a log scale: with a linear one every
// country but the first would look the same. Class bounds are rounded to
// 1, 2 or 5 × 10^k so the legend reads easily.

/** How many shades the map uses at most. */
export const MAP_CLASSES = 5;

const nice = (v: number): number => {
  if (v <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const f = v / pow;
  // Nearest of 1, 2, 5, 10 on a log scale.
  const step =
    f < Math.SQRT2 ? 1 : f < Math.sqrt(10) ? 2 : f < Math.sqrt(50) ? 5 : 10;
  return step * pow;
};

/**
 * The lower bound of each class, ascending, the first always 1: up to
 * MAP_CLASSES bounds spread evenly on a log scale up to `max`. Fewer
 * when `max` is small (max 3 → [1, 2]); none when nothing was viewed.
 */
export const mapClassBounds = (max: number): number[] => {
  if (!(max >= 1)) return [];
  const out: number[] = [];
  for (let i = 0; i < MAP_CLASSES; i++) {
    const b = Math.min(nice(max ** (i / MAP_CLASSES)), Math.floor(max));
    if (out.length === 0 || b > out[out.length - 1]) out.push(b);
  }
  return out;
};

/** The class of a count (0 = lightest), null for no views. */
export const mapClassOf = (v: number, bounds: number[]): number | null => {
  if (!(v >= 1) || bounds.length === 0) return null;
  let c = 0;
  while (c + 1 < bounds.length && v >= bounds[c + 1]) c++;
  return c;
};

/**
 * Which of the MAP_CLASSES ramp steps each of `n` classes uses: spread
 * over the ramp, so 2 classes are its ends and 1 is its middle.
 */
export const rampSteps = (n: number): number[] =>
  n <= 1
    ? n === 1
      ? [Math.floor(MAP_CLASSES / 2)]
      : []
    : Array.from({ length: n }, (_, j) =>
        Math.round((j * (MAP_CLASSES - 1)) / (n - 1)),
      );

/** Legend labels of the classes: "1–4", "5–19", …, "200–1,234". */
export const mapClassLabels = (bounds: number[], max: number): string[] =>
  bounds.map((b, i) => {
    const hi = i + 1 < bounds.length ? bounds[i + 1] - 1 : Math.floor(max);
    const f = (x: number) => x.toLocaleString("en-US");
    return hi > b ? `${f(b)}–${f(hi)}` : f(b);
  });

/**
 * Page views by ISO 3166-1 alpha-2 code, the codes Web Analytics reports
 * and the map's paths are keyed by. Anything that is not a code (an
 * empty or unknown country, "XX", "T1" for Tor) stays off the map; it is
 * still in the list beside it.
 */
export const viewsByCode = (
  countries: { country: string; pageViews: number }[],
): Map<string, number> => {
  const out = new Map<string, number>();
  for (const { country, pageViews } of countries) {
    const code = country.toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || code === "XX") continue;
    out.set(code, (out.get(code) ?? 0) + pageViews);
  }
  return out;
};
