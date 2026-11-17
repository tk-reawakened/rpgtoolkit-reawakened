import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { BinaryReader, readBoard, writeBoard } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createBoardDocument, createDocumentIdentity } from "../src/index.ts";
import { defaultBoardObject } from "../src/board-object-tools.ts";
import { exampleBoard } from "./fixtures.ts";

const path = "Boards/objects.brd";
const identity = createDocumentIdentity("memory-project", path);
const points = [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 32 }];

function decode(bytes: Uint8Array) {
  const result = readBoard(new BinaryReader(bytes));
  ok(result.ok);
  return result.value;
}

function setup() {
  const source = decode(exampleBoard(4));
  const original = {
    ...source,
    vectors: [{ ...defaultBoardObject("vectors", 1, points[0]!, points), type: 4, closed: 1, attributes: 7, handle: "old" }],
    programs: [
      { ...defaultBoardObject("programs", 1, points[0]!, []), graphic: "reserved.gph", handle: "raw slot" },
      { ...defaultBoardObject("programs", 1, points[0]!, points), program: "old.prg", activationType: 64 },
    ],
    sprites: [
      { ...defaultBoardObject("sprites", 1, { x: 16, y: 31 }, []), reserved: 22 },
      { ...defaultBoardObject("sprites", 1, { x: 48, y: 63 }, []), itemFile: "old.itm", reserved: 23 },
    ],
    images: [{ ...defaultBoardObject("images", 1, { x: 7, y: 9 }, []), drawType: 2, reserved: 18 }],
    residue: new Uint8Array([17, 39, 205, 0]),
  };
  const written = writeBoard(original);
  ok(written.ok);
  const host = createMemoryPlatformServices({ files: { [path]: written.value } });
  const opened = createBoardDocument(host.fs, identity, written.value);
  ok(opened.ok);
  equal(opened.document.getSnapshot().readOnly, null);
  return { host, doc: opened.document, original: decode(written.value), bytes: written.value };
}

test("authored records survive same-version save, undo and reopen without compacting raw slots", async () => {
  const { doc, host, original, bytes } = setup();
  // Deliberately construct keys in another order than the binary decoder.
  const authored = { handle: "authored", type: 2, layer: 1, closed: -1, attributes: 5, points };
  const fields = {
    vectors: [...original.vectors, authored],
    programs: original.programs.map((program, index) => index === 1 ? { ...program, program: "next.prg" } : program),
    sprites: original.sprites.map((sprite, index) => index === 1 ? { ...sprite, x: 80, y: 95 } : sprite),
    images: original.images.map((image) => ({ ...image, left: 19 })),
  };
  const applied = doc.apply({ type: "set-board-fields", fields });
  ok(applied.ok);
  deepEqual(decode(doc.serialize()), { ...original, ...fields });
  ok(doc.undo(applied.editId).ok);
  deepEqual(doc.serialize(), bytes);
  ok(doc.redo(applied.editId).ok);
  ok((await doc.save()).ok);
  const saved = host.bytesOf(path);
  ok(saved !== undefined);
  const reopened = createBoardDocument(host.fs, identity, saved);
  ok(reopened.ok);
  deepEqual(decode(reopened.document.serialize()), { ...original, ...fields });
  deepEqual(reopened.document.getSnapshot().programs[0], original.programs[0]);
  deepEqual(reopened.document.getSnapshot().sprites[0], original.sprites[0]);
  equal(reopened.document.getSnapshot().vectors[0]!.type, 4);
  equal(reopened.document.getSnapshot().vectors[0]!.closed, 1);
});

test("unrepresentable object edits are refused without replacing the snapshot or bytes", () => {
  const { doc, original, bytes } = setup();
  const before = doc.getSnapshot();
  const changes = [
    { vectors: [{ ...original.vectors[0]!, points: [{ x: 0.5, y: 0 }, points[1]!] }] },
    { sprites: [{ ...original.sprites[0]!, x: 32768 }] },
    { images: [{ ...original.images[0]!, left: 2147483648 }] },
    { programs: [{ ...original.programs[1]!, program: "run\0truncated.prg" }] },
  ];
  for (const fields of changes) {
    equal(doc.apply({ type: "set-board-fields", fields }).ok, false);
    equal(doc.getSnapshot(), before);
    deepEqual(doc.serialize(), bytes);
  }
});

test("editing another region and clearing a reference preserve empty slots and untouched records", () => {
  const { doc, original } = setup();
  const programs = original.programs.map((program, index) => index === 1 ? { ...program, program: "" } : program);
  ok(doc.apply({ type: "set-board-fields", fields: { programs } }).ok);
  const vectors = original.vectors.map((vector) => ({ ...vector, handle: "renamed" }));
  ok(doc.apply({ type: "set-board-fields", fields: { vectors } }).ok);
  deepEqual(decode(doc.serialize()), { ...original, programs, vectors });
});
