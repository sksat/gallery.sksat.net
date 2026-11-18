// Every Qwik City <Link> in the admin sets prefetch="js". By default a Link
// fetches its page's data (runs every routeLoader$ of that page, i.e. D1
// queries) as soon as it is visible, again after each navigation, and on
// hover: the header's sections, the list's 100 tiles and the edit page's
// prev/next made every page view run the loaders of many others. "js"
// still preloads the code.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const srcDir = resolve(__dirname, "..");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith(".tsx")
        ? [join(dir, e.name)]
        : [],
  );

describe("Link prefetch", () => {
  it('every <Link> sets prefetch="js"', () => {
    const missing: string[] = [];
    let links = 0;
    for (const file of sources(srcDir)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/<Link\b/g)) {
        links++;
        // The opening tag's attributes: up to the next element or text.
        const rest = text.slice(m.index + 1);
        const tag = rest.slice(0, rest.indexOf("<"));
        if (!/\bprefetch="js"/.test(tag)) {
          const line = text.slice(0, m.index).split("\n").length;
          missing.push(`${relative(srcDir, file)}:${line}`);
        }
      }
    }
    expect(links).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
