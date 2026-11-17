import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { BinaryReader, readBoard } from "@tk-reawakened/core";
import { platformError } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createBoardDocument, createDocumentIdentity, type DocumentStorage } from "../src/index.ts";
import { exampleBoard } from "./fixtures.ts";

const PATH = "Boards/properties.brd";
const identity = createDocumentIdentity("memory-project", PATH);

function decode(bytes: Uint8Array) {
  const read = readBoard(new BinaryReader(bytes));
  ok(read.ok);
  return read.value;
}

test("board settings reject lossy text and fractional numbers without making an edit", () => {
  const bytes = exampleBoard(4);
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  const opened = createBoardDocument(host.fs, identity, bytes);
  ok(opened.ok);
  const doc = opened.document;
  const before = doc.getSnapshot();
  const properties = before.properties;
  for (const changed of [
    { ...properties, backgroundMusic: "music\0truncated.mid" },
    { ...properties, enterPrg: "\u{1F680}.prg" },
    { ...properties, battleSkill: 1.5 },
    { ...properties, ambient: { ...properties.ambient, r: 0.5 } },
  ]) {
    const result = doc.apply({ type: "set-board-fields", fields: { properties: changed } });
    equal(result.ok, false, "the authored value must survive, not merely the writer's normalized output");
    equal(doc.getSnapshot(), before);
    deepEqual(doc.serialize(), bytes);
    deepEqual(host.bytesOf(PATH), bytes);
  }
});

test("a refused properties save retains its edit for undo, redo and a successful retry without losing board objects", async () => {
  const bytes = exampleBoard(4);
  const original = decode(bytes);
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  let writable = false;
  const storage: DocumentStorage = {
    readProject: host.fs.readProject,
    writeProject: async (...args) => writable ? host.fs.writeProject(...args) : platformError("permission-denied", "The destination is read-only."),
  };
  const opened = createBoardDocument(storage, identity, bytes);
  ok(opened.ok);
  const doc = opened.document;
  const links = { ...original.links, north: "next.brd", west: "edge.prg" };
  const properties = { ...original.properties, backgroundMusic: "night.mid", ambient: { r: -30, g: 12, b: 7 } };
  const changed = doc.apply({ type: "set-board-fields", fields: { links, properties } });
  ok(changed.ok);
  const failed = await doc.save();
  ok(!failed.ok);
  equal(failed.failure.code, "permission-denied");
  equal(doc.getSnapshot().dirty, true);
  deepEqual(doc.getSnapshot().links, links);
  deepEqual(host.bytesOf(PATH), bytes);
  ok(doc.undo(changed.editId).ok);
  deepEqual(doc.serialize(), bytes);
  equal(doc.getSnapshot().dirty, true, "a failed write stays unconfirmed until a successful save");
  ok(doc.redo(changed.editId).ok);
  writable = true;
  ok((await doc.save()).ok);
  const saved = host.bytesOf(PATH);
  ok(saved !== undefined);
  const after = decode(saved);
  deepEqual(after, { ...original, links, properties });
  equal(doc.getSnapshot().dirty, false);
});
