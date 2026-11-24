/**
 * scripts/check-i18n-parity.mjs — every i18n key must exist in all
 * 4 languages (ps/en/fa/ar) with no duplicates. Run:
 *   node scripts/check-i18n-parity.mjs
 * Exit 0 = parity holds; exit 1 = lists the missing/duplicate keys.
 * Reads src/lib/i18n.ts as text (no TS compile needed).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/lib/i18n.ts"), "utf8");

const langs = ["ps", "en", "fa", "ar"];
const dicts = {};
for (const lang of langs) {
  const start = src.indexOf(`const ${lang}: Dict = {`);
  if (start === -1) {
    console.error(`dict not found: ${lang}`);
    process.exit(1);
  }
  // The dict ends at the first "\n};" after its start.
  const end = src.indexOf("\n};", start);
  const body = src.slice(start, end);
  const keys = [...body.matchAll(/^ *([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
  dicts[lang] = keys;
}

let failed = false;
const union = [...new Set(langs.flatMap((l) => dicts[l]))];
console.log(`keys: union=${union.length} ` + langs.map((l) => `${l}=${dicts[l].length}`).join(" "));
for (const lang of langs) {
  const missing = union.filter((k) => !dicts[lang].includes(k));
  const dupes = dicts[lang].filter((k, i) => dicts[lang].indexOf(k) !== i);
  if (missing.length) {
    failed = true;
    console.error(`${lang} MISSING (${missing.length}): ${missing.join(", ")}`);
  }
  if ([...new Set(dupes)].length) {
    failed = true;
    console.error(`${lang} DUPLICATE: ${[...new Set(dupes)].join(", ")}`);
  }
}
if (!failed) console.log("i18n parity OK: all 4 languages have identical keys, no duplicates.");
process.exit(failed ? 1 : 0);
