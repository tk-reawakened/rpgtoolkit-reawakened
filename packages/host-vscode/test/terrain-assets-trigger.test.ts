// When a scene's tilesets are read again in VS Code (#3533): a typing pause is bounded, and a save reads at once.
import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createTilesetRefreshTrigger, isTilesetDocumentPath } from "../src/terrain-assets-trigger.ts";

void test("only tileset documents trigger a read", () => {
  ok(isTilesetDocumentPath("Tiles/pond.tkrtst"));
  ok(isTilesetDocumentPath("Tiles/Water.TKRTLE"));
  equal(isTilesetDocumentPath("Boards/pond.tkrscn"), false);
  equal(isTilesetDocumentPath("Boards/map.brd"), false);
});

void test("an edit waits for the typing pause, a save reads at once and cancels the pause", async () => {
  let reads = 0;
  const trigger = createTilesetRefreshTrigger(() => { reads += 1; }, 20);
  trigger.edited("Tiles/pond.tkrtst");
  equal(trigger.pending, true);
  equal(reads, 0, "nothing is read while the author is still typing");
  trigger.saved("Tiles/pond.tkrtst");
  equal(reads, 1, "the save reads the bytes that just reached disk");
  equal(trigger.pending, false, "and the pending pause is cancelled");
  await new Promise((resolve) => setTimeout(resolve, 40));
  equal(reads, 1, "the cancelled pause never fires a second read");
  trigger.dispose();
});

void test("a pause with no save still reads once, and edits elsewhere read nothing", async () => {
  let reads = 0;
  const trigger = createTilesetRefreshTrigger(() => { reads += 1; }, 10);
  trigger.edited("Tiles/pond.tkrtst");
  trigger.edited("Boards/pond.tkrscn");
  trigger.edited("Tiles/bank.tkrtle");
  await new Promise((resolve) => setTimeout(resolve, 30));
  equal(reads, 1, "one read for the burst of tileset edits, none for the scene or a board");
  trigger.dispose();
});
