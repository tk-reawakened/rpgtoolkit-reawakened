import { equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { hashDrawList, type DrawList } from "@tk-reawakened/core";

type HashVectors = {
  readonly hashDrawList: readonly (
    | { readonly id: string; readonly input: DrawList; readonly hash: string }
    | { readonly id: string; readonly a: DrawList; readonly b: DrawList; readonly hashA: string; readonly hashB: string }
  )[];
};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const vectors = JSON.parse(readFileSync(join(repoRoot, "tools/fixtures/runner-protocol/vectors-v3.json"), "utf8")) as HashVectors;

test("runner protocol v3 hashes the version and both ordered command planes", () => {
  for (const row of vectors.hashDrawList) {
    if ("input" in row) {
      equal(hashDrawList(row.input), row.hash, row.id);
      equal(row.input.protocolVersion, 3);
    } else {
      equal(hashDrawList(row.a), row.hashA, `${row.id}: base hash`);
      equal(hashDrawList(row.b), row.hashB, `${row.id}: margin hash`);
      equal(row.hashA === row.hashB, false, `${row.id}: margin-only difference changes the hash`);
    }
  }
});
