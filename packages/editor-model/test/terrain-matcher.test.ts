import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { compileTerrainMatcher } from "../src/terrain-matcher.ts";

void test("diagonals cannot match when their two adjacent sides are not both present", () => {
  const compiled = compileTerrainMatcher({ neighbours: "blob-8", coverage: "partial", rules: [
    { id: "inner-ne", when: { n: "same", e: "same", ne: "other" }, use: { tile: "inner-ne" } },
    { id: "north", when: { n: "same", e: "other" }, use: { tile: "north" } },
  ] });
  ok(compiled.ok);
  equal(compiled.choose(1 | 32, "ground", 0, 0), "north"); // n + irrelevant ne
  equal(compiled.choose(3, "ground", 0, 0), "inner-ne");
  equal(compiled.choose(3 | 32, "ground", 0, 0), null);
  // Across the four south/west combinations, the rules cover 13 and 8 masks.
  equal(compiled.uncovered, 47 - 13 - 8);
});

void test("coverage rejects ambiguity even for the same tile and reports impossible rules", () => {
  const compiled = compileTerrainMatcher({ neighbours: "cardinal-4", coverage: "complete", rules: [
    { id: "no-east", when: { e: "other" }, use: { tile: "edge" } },
    { id: "no-north", when: { n: "other" }, use: { tile: "edge" } },
    { id: "diagonal", when: { ne: "other" }, use: { tile: "corner" } },
  ] });
  ok(!compiled.ok);
  deepEqual(compiled.problems, [
    ...[0, 4, 8, 12].map((mask) => ({ code: "terrain-rule-ambiguous", mask, rules: ["no-east", "no-north"] })),
    { code: "terrain-rule-unsatisfiable", rule: "diagonal" },
    { code: "terrain-pattern-uncovered", count: 4 },
  ]);
});

void test("weighted choices are stable on the canonical mask and ignore rule labels", () => {
  for (const id of ["water", "renamed"]) {
    const compiled = compileTerrainMatcher({ neighbours: "blob-8", coverage: "complete", seed: -7, rules: [
      { id, when: {}, variants: [{ tile: "plain", weight: 4 }, { tile: "ripple", weight: 3 }, { tile: "lily", weight: 4 }] },
    ] });
    ok(compiled.ok);
    // Independently calculated FNV-1a slots: 3, 7, 6, 7, 10, 6.
    deepEqual([
      compiled.choose(0, "ground", 0, 0), compiled.choose(32, "ground", 1, 0),
      compiled.choose(3, "ground", 0, 0), compiled.choose(35, "ground", 0, 0),
      compiled.choose(35, "ground", 301, 2), compiled.choose(255, "ground", 5, 4),
    ], ["plain", "lily", "ripple", "lily", "lily", "ripple"]);
  }
});
