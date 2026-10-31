// The instruction-version fingerprint (docs/spec/formats/save-game.md#save-compatibility-and-instruction-versions-owner-ruling):
// a save resumes at a saved `ip` only when `IR_VERSION` says the numbering is
// unchanged, and an older one restarts its thread. This golden pins the lowered
// `StepOp` stream of a small authored corpus (without source positions, which
// neither move an instruction nor change its meaning) so a lowering change cannot
// land without the author deciding whether it moved saved positions.
//
// Re-record with `IR_FINGERPRINT_RECORD=1 node --test ...` after deciding. If a
// saved `ip` now means a different instruction, bump `IR_VERSION` in the same
// change and add a previous-version fixture; if only the source positions moved,
// the hash is unchanged because `pos` is excluded.
import { equal, ok } from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canon, compileInline, fnv1a64, IR_VERSION } from "../src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "ir");
const corpus = JSON.parse(readFileSync(join(root, "corpus.json"), "utf8")) as Array<{ name: string; source: string }>;
const fingerprintPath = join(root, "fingerprint.json");

/** The lowered instruction stream, with each op's source position removed: it is not an instruction. */
function instructionHash(source: string): string {
  const ops = compileInline(source).ops.map((op) => {
    const { pos: _pos, ...rest } = op;
    return rest;
  });
  return fnv1a64(canon(ops as never));
}

function current(): { ir: string; programs: Record<string, string> } {
  const programs: Record<string, string> = {};
  for (const { name, source } of corpus) programs[name] = instructionHash(source);
  return { ir: IR_VERSION, programs };
}

test("the instruction-version fingerprint matches the committed golden", () => {
  const actual = current();
  if (process.env.IR_FINGERPRINT_RECORD === "1") {
    writeFileSync(fingerprintPath, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  const golden = JSON.parse(readFileSync(fingerprintPath, "utf8")) as { ir: string; programs: Record<string, string> };
  equal(golden.ir, IR_VERSION, "the golden was recorded under another IR_VERSION; re-record it with the bump");
  for (const { name } of corpus) {
    equal(
      actual.programs[name],
      golden.programs[name],
      `the lowered instruction stream for "${name}" changed: if a saved ip now means a different instruction, bump IR_VERSION and add a previous-version fixture; otherwise re-record with IR_FINGERPRINT_RECORD=1`,
    );
  }
  equal(Object.keys(actual.programs).length, Object.keys(golden.programs).length, "the corpus and the golden name the same programs");
});

test("the fingerprint covers every instruction kind the corpus names, and no source position", () => {
  const golden = JSON.parse(readFileSync(fingerprintPath, "utf8")) as { programs: Record<string, string> };
  ok(Object.keys(golden.programs).length >= 9, "the corpus stays broad enough to notice a lowering change");
  // Moving a statement down a line changes its source position but not one op.
  const padded = corpus.find((entry) => entry.name === "arithmetic");
  ok(padded !== undefined, "the corpus has the arithmetic program");
  equal(instructionHash(`\n\n${padded.source}`), golden.programs.arithmetic, "source positions are excluded");
});
