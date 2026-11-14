import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createDocumentIdentity, openBoardDocument, type BoardCommand } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { applyPixelStroke, paintLine, type PixelRaster } from "../conformance/pixel-operations.ts";

const BOARD_PATH = "Boards/village.brd";
const BOARD_IDENTITY = createDocumentIdentity("memory-project", BOARD_PATH);
const BOARD_BYTES = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor4.brd", import.meta.url)));

function transparent(width: number, height: number): PixelRaster {
  return { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
}

test("framework-free stroke primitive creates one reversible RGBA command for a transparent rectangular image", () => {
  const before = transparent(16, 8);
  const command = paintLine(before, { x: 0, y: 0 }, { x: 7, y: 7 }, [240, 40, 60, 128]);

  equal(command.type, "paint-stroke");
  equal(command.patches.length, 8, "one pixel per diagonal step");
  deepEqual([command.width, command.height], [16, 8]);
  deepEqual([...before.pixels], Array(16 * 8 * 4).fill(0), "stroke generation must not mutate its source");

  const painted = applyPixelStroke(before, command);
  ok(painted);
  equal(painted.pixels[0], 240);
  equal(painted.pixels[3], 128, "partial alpha is preserved");
  equal(painted.pixels[(7 * 16 + 7) * 4], 240);
  equal(painted.pixels[(7 * 16 + 7) * 4 + 3], 128);
  const undone = applyPixelStroke(painted, command, true);
  ok(undone);
  deepEqual([...undone.pixels], [...before.pixels]);
});

test("existing BoardDocument owns one editId/history for accepted commands and refuses an art stroke without mutating", async () => {
  const host = createMemoryPlatformServices({ files: { [BOARD_PATH]: BOARD_BYTES } });
  const opened = await openBoardDocument(host.fs, BOARD_IDENTITY);
  ok(opened.ok);
  const document = opened.document;
  const firstViewSnapshots: unknown[] = [];
  const secondViewSnapshots: unknown[] = [];
  const unsubscribeFirst = document.subscribe(() => firstViewSnapshots.push(document.getSnapshot()));
  const unsubscribeSecond = document.subscribe(() => secondViewSnapshots.push(document.getSnapshot()));

  const stroke = paintLine(transparent(16, 8), { x: 0, y: 0 }, { x: 7, y: 7 }, [240, 40, 60, 128]);
  const before = document.getSnapshot();
  const unsupported = document.apply(stroke as unknown as BoardCommand);
  ok(!unsupported.ok, "a board document is not an art-pixel document");
  equal(document.getSnapshot(), before, "an unsupported pixel command changes nothing");
  equal(firstViewSnapshots.length, 0);
  equal(secondViewSnapshots.length, 0);

  const accepted = document.apply({ type: "set-tile", layer: 0, x: 1, y: 1, tile: "village.tst8" });
  ok(accepted.ok);
  equal(document.getSnapshot().edits.length, 1, "one accepted host command creates one history entry");
  equal(firstViewSnapshots.length, 1);
  equal(secondViewSnapshots.length, 1, "both views observe the same document change");
  ok(document.undo(accepted.editId).ok);
  equal(document.getSnapshot().dirty, false);
  ok(document.redo(accepted.editId).ok);
  equal(document.getSnapshot().dirty, true);
  ok((await document.save()).ok);
  const reopened = await openBoardDocument(host.fs, BOARD_IDENTITY);
  ok(reopened.ok);
  equal(reopened.document.getSnapshot().edits.length, 0);
  deepEqual(reopened.document.serialize(), document.serialize());

  unsubscribeFirst();
  unsubscribeSecond();
  equal(host.editedEvents.length, 0, "the model alone does not impersonate a view's document.edited report");
});
