import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canon, fnv1a64, type DrawListV2 } from "@tk-reawakened/core";

type HashVectors = {
  readonly hashDrawList: readonly (
    | { readonly id: string; readonly input: DrawListV2; readonly hash: string }
    | { readonly id: string; readonly a: DrawListV2; readonly b: DrawListV2; readonly hashA: string; readonly hashB: string }
  )[];
};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const vectors = JSON.parse(readFileSync(join(repoRoot, "tools/fixtures/runner-protocol/vectors-v2.json"), "utf8")) as HashVectors;

test("runner protocol v2 draw hashes include both ordered command planes", () => {
  for (const row of vectors.hashDrawList) {
    if ("input" in row) {
      equal(fnv1a64(canon(row.input)), row.hash, row.id);
    } else {
      equal(fnv1a64(canon(row.a)), row.hashA, `${row.id}: base hash`);
      equal(fnv1a64(canon(row.b)), row.hashB, `${row.id}: margin hash`);
      equal(row.hashA === row.hashB, false, `${row.id}: margin-only difference changes the hash`);
    }
  }
});

test("runner protocol v2 vectors are strict two-plane records", () => {
  const root = JSON.parse(readFileSync(join(repoRoot, "tools/fixtures/runner-protocol/vectors-v2.json"), "utf8")) as {
    readonly protocol: string;
    readonly vectors: readonly { readonly id: string; readonly valid: boolean; readonly record: unknown }[];
  };
  equal(root.protocol, "runner-protocol-v2");
  const rows = new Map(root.vectors.map((row) => [row.id, row]));
  deepEqual(rows.get("draw-empty-margin-plane")?.record, { tick: 12, width: 640, height: 480, commands: [], marginCommands: [] });
  equal(rows.get("draw-nonempty-margin-plane")?.valid, true);
  equal(rows.get("refuse-draw-missing-margin-plane")?.valid, false);
});
