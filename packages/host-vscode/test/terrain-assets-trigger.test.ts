// When native scene assets are read again in VS Code: text changes are debounced, and images and saves are observed.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createLatestRead, createTerrainAssetRefreshTrigger, isTerrainAssetPath } from "../src/terrain-assets-trigger.ts";

void test("only files that can affect a scene asset trigger a read", () => {
  ok(isTerrainAssetPath("Tiles/pond.tkrtst"));
  ok(isTerrainAssetPath("Tiles/Water.TKRTLE"));
  ok(isTerrainAssetPath("Packs/props.tkrpack"));
  ok(isTerrainAssetPath("Tiles/roles-sheet.png"));
  ok(isTerrainAssetPath("Tiles/roles-sheet.jpeg"));
  equal(isTerrainAssetPath("Boards/pond.tkrscn"), false);
  equal(isTerrainAssetPath("Boards/map.brd"), false);
});

void test("a save reads the just-saved recipe once and cancels the pending typing pause", async () => {
  let diskRecipe = "old";
  const reads: string[] = [];
  const trigger = createTerrainAssetRefreshTrigger(() => { reads.push(diskRecipe); }, 20);
  trigger.edited("Tiles/pond.tkrtst");
  equal(trigger.pending, true);
  deepEqual(reads, [], "nothing is read while the author is still typing");
  diskRecipe = "saved";
  trigger.saved("Tiles/pond.tkrtst");
  deepEqual(reads, ["saved"], "the save reads the bytes that just reached disk");
  equal(trigger.pending, false, "and the pending pause is cancelled");
  await new Promise((resolve) => setTimeout(resolve, 40));
  deepEqual(reads, ["saved"], "the cancelled pause never fires a second read");
  trigger.dispose();
});

void test("a pause with no save still reads once, and edits elsewhere read nothing", async () => {
  let reads = 0;
  const trigger = createTerrainAssetRefreshTrigger(() => { reads += 1; }, 10);
  trigger.edited("Tiles/roles-sheet.png");
  trigger.edited("Boards/pond.tkrscn");
  trigger.edited("Tiles/bank.tkrtle");
  trigger.edited("Packs/props.tkrpack");
  await new Promise((resolve) => setTimeout(resolve, 30));
  equal(reads, 1, "one read for image, tile and pack changes in the burst, none for a scene");
  trigger.dispose();
});

void test("startup latest-wins across a later refresh", async () => {
  type Inventory = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly problems: readonly string[] };
  const pending: ((value: Inventory) => void)[] = [];
  const published: Inventory[] = [];
  const reader = createLatestRead<Inventory>(() => new Promise<Inventory>((resolve) => { pending.push(resolve); }), (value) => { published.push(value); });
  const startup = reader.read();
  const readyRead = reader.read();
  const ready = reader.waitForLatest();
  const latestRead = reader.read();
  await Promise.resolve();
  equal(pending.length, 3);

  const failure: Inventory = { ok: false, problems: ["latest inventory failed"] };
  pending[2]!(failure);
  deepEqual(await ready, failure, "readiness follows the latest completed inventory, including a failure");
  deepEqual(published, [failure], "the failure replaces any previously good inventory");
  pending[0]!({ ok: true, name: "startup" });
  pending[1]!({ ok: true, name: "ready" });
  await startup;
  await readyRead;
  equal(await latestRead, failure);
  deepEqual(published, [failure], "older startup and readiness reads never replace the failed latest read");
});

