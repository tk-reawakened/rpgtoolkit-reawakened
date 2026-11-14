// The kind-conformance suite (ADR 0026 decision 5): one table of registered kinds run through one set of checks, so the
// lifecycle promises of ADR 0022 D2 and D3 are proved per kind and not re-argued per editor. Each case uses the smallest
// authored fixture for its kind and no engine (the owner's test-speed rule).
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, DOCUMENT_KINDS, kindForPath, type AnyCommand, type AnyDocument } from "../src/index.ts";
import { exampleBoard, exampleCharacter, exampleItem, exampleMain } from "./fixtures.ts";

interface KindCase {
  readonly kind: string;
  readonly path: string;
  readonly bytes: Uint8Array;
  /** A command the kind accepts and that changes the document. */
  readonly accepted: AnyCommand;
  /** A command the kind rejects whole. */
  readonly rejected: unknown;
}

const CASES: readonly KindCase[] = [
  {
    kind: "main",
    path: "Main/example.gam",
    bytes: exampleMain(9),
    accepted: { type: "set-game-title", title: "Renamed" },
    rejected: { type: "set-game-title", title: "no \u0000 allowed" },
  },
  {
    kind: "board",
    path: "Boards/village.brd",
    bytes: exampleBoard(4),
    accepted: { type: "set-tile", layer: 0, x: 1, y: 1, tile: "village.tst8" },
    rejected: { type: "set-tile", layer: 0, x: 9, y: 9, tile: "village.tst8" },
  },
  {
    kind: "character",
    path: "Chrs/hero.tem",
    bytes: exampleCharacter(),
    accepted: { type: "set-sprite-animation", group: "walk", index: 7, file: "Misc/hero_walk_se.anm" },
    rejected: { type: "set-sprite-animation", group: "walk", index: 8, file: "Misc/hero_walk_invalid.anm" },
  },
  {
    kind: "item",
    path: "Item/chest.itm",
    bytes: exampleItem(),
    accepted: { type: "set-sprite-animation", group: "idle", index: 7, file: "Misc/chest_idle_se.anm" },
    rejected: { type: "set-sprite-animation", group: "battle", index: 0, file: "Misc/chest_battle.anm" },
  },
];

async function open(entry: KindCase): Promise<{ readonly host: ReturnType<typeof createMemoryPlatformServices>; readonly doc: AnyDocument }> {
  const host = createMemoryPlatformServices({ files: { [entry.path]: entry.bytes } });
  const kind = kindForPath(entry.path);
  ok(kind !== null, `${entry.path} has a registered kind`);
  const opened = await kind.open(host.fs, createDocumentIdentity("memory-project", entry.path));
  ok(opened.ok, `${entry.path} opens`);
  return { host, doc: opened.document };
}

test("every registered kind is in the conformance table (ADR 0026 decision 5)", () => {
  deepEqual(DOCUMENT_KINDS.map((kind) => kind.id).sort(), CASES.map((entry) => entry.kind).sort());
});

for (const entry of CASES) {
  test(`${entry.kind}: opening and saving with no edit leaves the bytes identical (AD-18)`, async () => {
    const { host, doc } = await open(entry);
    equal(doc.kind, entry.kind);
    equal(doc.getSnapshot().readOnly, null);
    deepEqual(doc.serialize(), entry.bytes);
    ok((await doc.save()).ok);
    deepEqual(host.bytesOf(entry.path), entry.bytes);
  });

  test(`${entry.kind}: a rejected command leaves the snapshot unchanged and names its reason (ADR 0022 D3.1)`, async () => {
    const { doc } = await open(entry);
    const before = doc.getSnapshot();
    const result = doc.apply(entry.rejected as AnyCommand);
    ok(!result.ok);
    equal(result.rejection.reason, "invalid");
    ok(result.rejection.message.length > 0);
    equal(doc.getSnapshot(), before, "the very same snapshot object: nothing changed");
  });

  test(`${entry.kind}: apply then undo gives back the snapshot before, and every command has a label (AD-19)`, async () => {
    const { doc } = await open(entry);
    const before = doc.getSnapshot();
    const applied = doc.apply(entry.accepted);
    ok(applied.ok);
    const edit = doc.getSnapshot().edits.at(-1);
    ok(edit !== undefined && edit.label.length > 0);
    equal(doc.getSnapshot().dirty, true);
    ok(doc.undo(applied.editId).ok);
    const after = doc.getSnapshot();
    equal(after.dirty, false);
    deepEqual({ ...after, edits: [] }, { ...before, edits: [], canRedo: after.canRedo });
    deepEqual(doc.serialize(), entry.bytes);
  });

  test(`${entry.kind}: apply, save and reopen agree (ADR 0022 D3.3)`, async () => {
    const { host, doc } = await open(entry);
    ok(doc.apply(entry.accepted).ok);
    ok((await doc.save()).ok);
    equal(doc.getSnapshot().dirty, false);
    const kind = kindForPath(entry.path)!;
    const reopened = await kind.open(host.fs, createDocumentIdentity("memory-project", entry.path));
    ok(reopened.ok);
    deepEqual(reopened.document.serialize(), doc.serialize());
    deepEqual(host.bytesOf(entry.path), doc.serialize());
  });
}
