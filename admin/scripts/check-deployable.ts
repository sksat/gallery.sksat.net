// Pre-deploy guard: refuse to ship the committed all-zero placeholder
// `database_id`. Wrangler accepts it without complaint and the worker then
// fails at runtime on every D1 call. Run via the `predeploy` npm-lifecycle
// hook, so `pnpm deploy` aborts before the upload starts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

const root = resolve(import.meta.dirname, "..");
const config = readFileSync(resolve(root, "wrangler.jsonc"), "utf8");

if (config.includes(PLACEHOLDER_ID)) {
  console.error(
    `wrangler.jsonc still has the placeholder database_id (${PLACEHOLDER_ID}).\n` +
      `Run \`pnpm db.create\` and replace it with the real id locally before deploying.\n` +
      `(Do not commit the local edit — see admin/README.md.)`,
  );
  process.exit(1);
}

console.log("predeploy: wrangler.jsonc placeholder check ok");
