#!/usr/bin/env node
/**
 * Fresh test for src/lib/nameGuard.ts (P0 item 1).
 *
 * Tests the REAL module code, not a copy of the regexes: it compiles
 * src/lib/nameGuard.ts with tsc into a temp dir and imports the
 * compiled output. Prints PASS/FAIL per case and exits non-zero on
 * any failure.
 *
 * Run from the repo root:  node scripts/test-name-guard.mjs
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tmpDir = mkdtempSync(join(tmpdir(), "name-guard-test-"));

let failures = 0;
let passes = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    passes++;
    console.log(`PASS: ${label}`);
  } else {
    failures++;
    console.log(`FAIL: ${label}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

async function main() {
  // Compile the REAL module to a temp dir and import it.
  execSync(
    `npx tsc src/lib/nameGuard.ts --outDir "${tmpDir}" --module esnext --target es2020 --skipLibCheck`,
    { cwd: repoRoot, stdio: "pipe" }
  );
  const { normalizeFounderName, guardChatStream } = await import(
    pathToFileURL(join(tmpDir, "nameGuard.js")).href
  );

  // 1. Misspelled first name + surname -> correct full name, no duplication.
  check(
    '1. "عبدالسمیع نیازی" -> "عبدالصمیم نیازی"',
    normalizeFounderName("عبدالسمیع نیازی"),
    "عبدالصمیم نیازی"
  );
  // 2. Arabic-Yeh surname also corrected.
  check(
    '2. "عبدالسمیع نیازي" -> "عبدالصمیم نیازی"',
    normalizeFounderName("عبدالسمیع نیازي"),
    "عبدالصمیم نیازی"
  );
  // 3. Wrong final letter (ع instead of م) + surname.
  check(
    '3. "عبدالصمیع نیازی" -> "عبدالصمیم نیازی"',
    normalizeFounderName("عبدالصمیع نیازی"),
    "عبدالصمیم نیازی"
  );
  // 4. Misspelled first name ALONE gains the surname (intended).
  check(
    '4. "عبدالسمیع" alone -> "عبدالصمیم نیازی"',
    normalizeFounderName("عبدالسمیع"),
    "عبدالصمیم نیازی"
  );
  // 5. Already-correct name is unchanged (idempotency).
  check(
    '5. "عبدالصمیم نیازی" unchanged',
    normalizeFounderName("عبدالصمیم نیازی"),
    "عبدالصمیم نیازی"
  );
  // 6. Correct first name + other words must NOT gain a surname.
  check(
    '6. "عبدالصمیم یو ښه کس دی" unchanged',
    normalizeFounderName("عبدالصمیم یو ښه کس دی"),
    "عبدالصمیم یو ښه کس دی"
  );
  // 7. Latin misspelling corrected.
  check(
    '7. "Abdul Sami Niazai" -> "Abdul Samim Niazai"',
    normalizeFounderName("Abdul Sami Niazai"),
    "Abdul Samim Niazai"
  );
  // 8. Correct Latin name unchanged.
  check(
    '8. "Abdul Samim Niazai" unchanged',
    normalizeFounderName("Abdul Samim Niazai"),
    "Abdul Samim Niazai"
  );
  // 9. "Samim Pathan" untouched.
  check(
    '9. "Samim Pathan" untouched',
    normalizeFounderName("Samim Pathan"),
    "Samim Pathan"
  );
  // 10. Bare "Abdul Sami" (no surname) untouched.
  check(
    '10. Bare "Abdul Sami" untouched',
    normalizeFounderName("Abdul Sami"),
    "Abdul Sami"
  );
  // 11. Brand: both spacings collapse to "AfghanGPT".
  check(
    '11a. "افغان GPT" -> "AfghanGPT"',
    normalizeFounderName("افغان GPT"),
    "AfghanGPT"
  );
  check(
    '11b. "Afghan GPT" -> "AfghanGPT"',
    normalizeFounderName("Afghan GPT"),
    "AfghanGPT"
  );

  // 12. Streaming: guardChatStream must equal normalizeFounderName
  //    of the full text, at 1-char and 3-char chunk sizes.
  const full = "سلام، زه عبدالسمیع نیازی یم او افغان GPT کاروم";
  const expected = normalizeFounderName(full);
  for (const size of [1, 3]) {
    async function* gen() {
      for (let i = 0; i < full.length; i += size) {
        yield full.slice(i, i + size);
      }
    }
    let streamed = "";
    for await (const chunk of guardChatStream(gen())) streamed += chunk;
    check(`12${size === 1 ? "a" : "b"}. streaming ${size}-char chunks`, streamed, expected);
  }

  console.log(`\n${passes} passed, ${failures} failed.`);
  if (failures > 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
