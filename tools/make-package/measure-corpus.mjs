// Measure the uncompressed contents of the actual distribution archives built from the pinned fixture corpus.
// docs/spec/engine/runners.md#load-modes
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPackage, writeDistributionPackage } from "@tk-reawakened/core";
import { loadSources } from "../fixtures/fetch.mjs";
import { packageManifest, readFolder, synthesisedMain } from "./run.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const corpus = join(root, "fixtures/legacy");
const planText = readFileSync(join(root, "golden/closing/plan.json"), "utf8");
const plan = JSON.parse(planText);
const MIB = 1024 * 1024;

function measure() {
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(join(corpus, ".fetched.json"), "utf8"));
  } catch (error) {
    throw new Error(`fetched fixtures are absent or unreadable at ${corpus}; run pnpm fixtures:fetch (${error.message})`);
  }
  const loaded = loadSources();
  const sources = Array.isArray(loaded) ? loaded : [loaded];
  if (JSON.stringify(stamp.sources) !== JSON.stringify(sources)) {
    throw new Error("fixture stamp does not match the pinned sources; run pnpm fixtures:fetch");
  }
  const names = sources.flatMap((source) => source.games);
  if (new Set(names).size !== names.length || Object.keys(stamp.games ?? {}).length !== names.length) {
    throw new Error("fixture stamp has missing or duplicate games; run pnpm fixtures:fetch");
  }
  const results = [];
  for (const name of names) {
    const folder = join(corpus, name);
    const entries = readFolder(folder);
    const count = entries.filter((entry) => entry.kind === "file").length;
    if (count !== stamp.games?.[name]?.files || count === 0) {
      throw new Error(`${name} fixture file count differs from its stamp; run pnpm fixtures:fetch`);
    }
    const game = plan.games.find((entry) => entry.name === name);
    if (game === undefined) throw new Error(`${name} has no closing-plan game definition`);
    let main = game.main?.file;
    if (game.main?.synthesised !== undefined) {
      const generated = synthesisedMain(planText, name);
      main = generated.path;
      entries.push({ kind: "file", ...generated });
    }
    const folderPackage = loadPackage({ kind: "folder", name, entries });
    if (!folderPackage.ok) throw new Error(`${name}: ${folderPackage.error.message}`);
    const files = folderPackage.value.files;
    if (typeof main !== "string" || !files.some((file) => file.path === main)) {
      throw new Error(`${name}: closing-plan main ${main} is missing`);
    }
    // Some corpus folders contain several .gam files; the closing plan selects the main without dropping any files.
    const made = writeDistributionPackage({ files, manifest: packageManifest(files, main) });
    if (!made.ok) throw new Error(`${name}: ${made.error.message}`);
    const unpacked = loadPackage({ kind: "tpk", name: `${name}.tpk`, bytes: made.value });
    if (!unpacked.ok) throw new Error(`${name}: ${unpacked.error.message}`);
    const bytes = unpacked.value.files.reduce((total, file) => total + file.bytes.length, 0);
    results.push({ name, bytes });
    console.log(`${name}: ${bytes} uncompressed bytes`);
  }
  results.sort((a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const largest = results[0];
  if (largest === undefined) throw new Error("the fixture corpus is empty");
  const thresholdMiB = Math.ceil(largest.bytes / MIB);
  console.log(`Largest: ${largest.name}, ${largest.bytes} bytes; threshold: ${thresholdMiB} MiB`);
  return { largest, thresholdMiB, count: names.length };
}

try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check") || args.length > 1) throw new Error("usage: corpus:measure [--check]");
  const measured = measure();
  if (args.includes("--check")) {
    const doc = readFileSync(join(root, "docs/spec/engine/runners.md"), "utf8");
    const expected = `| ${measured.count} fetched corpus games | ${measured.largest.name}: ${measured.largest.bytes} bytes | ${measured.thresholdMiB} MiB |`;
    if (!doc.includes(expected)) throw new Error(`documented threshold is stale; expected a table row starting: ${expected}`);
    console.log("Documented corpus threshold matches.");
  }
} catch (error) {
  console.error(`corpus:measure: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
