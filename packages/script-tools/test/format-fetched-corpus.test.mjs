// Epic 10, #2039: exercise the fetched sample games, not a copied source fixture.
// TOOL-4 promises identical lowering for 3.1 and byte-identical refusal for TK2.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compileInline, decodeCp1252, encodeCp1252 } from "@tk-reawakened/core";
import { buildFetchedCorpus } from "@tk-reawakened/runner-harness";
import { formatSource } from "@tk-reawakened/script-tools";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const corpus = join(root, "fixtures/legacy");
const plan = JSON.parse(readFileSync(join(root, "golden/closing/plan.json"), "utf8"));

function programs(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return programs(path);
    return entry.isFile() && entry.name.toLowerCase().endsWith(".prg") ? [path] : [];
  }).sort();
}

function source(bytes) {
  return decodeCp1252(bytes, 0, bytes.length);
}

function lower(text) {
  return compileInline(text).ops.map(({ pos, ...op }) => op);
}

const originals = { demo: {}, basic: {} };
const formatted = { demo: {}, basic: {} };
for (const game of plan.games) {
  const files = programs(join(corpus, game.name)); // ENOENT is a failure, not a skip.
  test(`${game.name}: sample programs retain their ${game.dialect} behavior`, () => {
    ok(files.length > 0, `${game.name} has fetched programs`);
    let rewritten = 0;
    for (const file of files) {
      const bytes = readFileSync(file);
      const text = source(bytes);
      const result = formatSource(text, { dialect: game.dialect });
      const name = relative(root, file);
      if (game.dialect === "tk2") {
        equal(result.skipped, "tk2-dialect", name);
        equal(result.text, text, name);
        continue;
      }
      equal(result.skipped, undefined, name);
      equal(formatSource(result.text, { dialect: "tk3" }).text, result.text, `${name}: idempotence`);
      deepEqual(lower(result.text), lower(text), `${name}: lowered instructions`);
      if (result.changed) rewritten++;
    }
    if (game.dialect === "tk3") ok(rewritten > 0, `${game.name}: exercise an actual rewrite`);
  });
  if (game.dialect !== "tk3") continue;
  const key = game.name === "demo" ? "demo" : game.name === "Basic" ? "basic" : undefined;
  if (key === undefined) throw new Error(`No runtime corpus mapping for ${game.name}`);
  for (const file of files) {
    // The harness resolves programs from Prg/ and includes against the same map.
    const path = relative(join(corpus, game.name, "Prg"), file);
    if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
      throw new Error(`Unexpected program outside Prg: ${file}`);
    }
    const name = path.split(sep).join("/");
    const bytes = readFileSync(file);
    const result = encodeCp1252(formatSource(source(bytes), { dialect: "tk3" }).text);
    if (!result.ok) throw new Error(`${file}: formatted source is not Windows-1252`);
    originals[key][name] = bytes;
    formatted[key][name] = result.value;
  }
}

const before = buildFetchedCorpus(originals);
const after = buildFetchedCorpus(formatted);
equal(before.length, after.length);
ok(before.length > 0, "the execution corpus is not empty");
for (let index = 0; index < before.length; index++) {
  const original = before[index];
  const rewritten = after[index];
  test(`${original.id}: original and formatted programs run identically`, () => {
    equal(rewritten.id, original.id);
    const left = original.createHost(3);
    const right = rewritten.createHost(3);
    for (let tick = 1; tick <= original.ticks; tick++) {
      const inputs = original.inputsForTick?.(tick) ?? [];
      const { stateHash: _leftHash, ...leftReport } = left.advance(1, inputs);
      const { stateHash: _rightHash, ...rightReport } = right.advance(1, inputs);
      deepEqual(rightReport, leftReport, `tick ${tick}: reports`);
    }
    // R-42 hashes source bytes in each live frame. Compare every other state field.
    const snapshot = (host) => {
      const state = structuredClone(host.state());
      for (const thread of state.vm.threads) {
        for (const frame of thread.frames) {
          if (frame.program.kind === "file") delete frame.program.sourceHash;
        }
      }
      return state;
    };
    deepEqual(snapshot(right), snapshot(left));
  });
}
