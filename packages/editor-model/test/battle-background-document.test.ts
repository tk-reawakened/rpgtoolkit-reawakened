import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, kindForPath, openBattleBackgroundDocument } from "../src/index.ts";

const PATH = "Bkrounds/forest.bkg";
const binaryFixture = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Game/Example/Bkrounds/forest.bkg", import.meta.url)));
const textFixture = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/fight-background/background_text.bkg", import.meta.url)));
const bytes = (...parts: readonly Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};
const encoded = (value: string): Uint8Array => new TextEncoder().encode(`${value}\0`);

test("the registry claims BKG and the document exposes its six distinct linked fields", async () => {
  equal(kindForPath("Bkrounds/FOREST.BKG")?.id, "battle-background");
  const host = createMemoryPlatformServices({ files: { [PATH]: binaryFixture } });
  const result = await openBattleBackgroundDocument(host.fs, createDocumentIdentity("memory-project", PATH));
  ok(result.ok);
  const doc = result.document;
  const snapshot = doc.getSnapshot();
  deepEqual([snapshot.image, snapshot.music, snapshot.selectSound, snapshot.chooseSound, snapshot.readySound, snapshot.cantDoSound], ["forest.tbm", "battle.mid", "", "", "", ""]);
  deepEqual([snapshot.major, snapshot.minor, snapshot.residueBytes], [2, 3, 0]);
  deepEqual(doc.serialize(), binaryFixture);
});

test("all six references edit and save without changing the version or trailing residue", async () => {
  const residue = Uint8Array.of(0xa5, 0x5a);
  const original = bytes(binaryFixture, residue);
  const host = createMemoryPlatformServices({ files: { [PATH]: original } });
  const result = await openBattleBackgroundDocument(host.fs, createDocumentIdentity("memory-project", PATH));
  ok(result.ok);
  const doc = result.document;
  const values = {
    image: "arena.tbm", music: "battle2.mid", selectSound: "cursor.wav", chooseSound: "choose.wav", readySound: "ready.mid", cantDoSound: "nope.wav",
  } as const;
  for (const [field, value] of Object.entries(values) as [keyof typeof values, string][]) {
    ok(doc.apply({ type: "set-battle-background-text", field, value }).ok);
  }
  const expected = bytes(
    new TextEncoder().encode("RPGTLKIT BKG\0"), Uint8Array.of(2, 0, 3, 0),
    encoded(values.image), encoded(values.music), encoded(values.selectSound), encoded(values.chooseSound), encoded(values.readySound), encoded(values.cantDoSound), residue,
  );
  deepEqual(doc.serialize(), expected, "independently assembled BKG bytes retain minor and residue");
  const saved = await doc.save();
  ok(saved.ok);
  deepEqual(host.bytesOf(PATH), expected);
  ok(doc.undo().ok);
  equal(doc.getSnapshot().cantDoSound, "");
  equal(doc.getSnapshot().readySound, values.readySound, "one Undo reverses only the latest field command");
  deepEqual(doc.serialize(), bytes(
    new TextEncoder().encode("RPGTLKIT BKG\0"), Uint8Array.of(2, 0, 3, 0),
    encoded(values.image), encoded(values.music), encoded(values.selectSound), encoded(values.chooseSound), encoded(values.readySound), encoded(""), residue,
  ));
  for (let index = 1; index < Object.keys(values).length; index++) ok(doc.undo().ok);
  deepEqual(doc.serialize(), original, "undoing every edit restores the exact original bytes");
  for (let index = 0; index < Object.keys(values).length; index++) ok(doc.redo().ok);
  deepEqual(doc.serialize(), expected, "redo restores the saved model including residue");
});

test("Toolkit 2 text backgrounds remain byte-preserving and read-only", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: textFixture } });
  const result = await openBattleBackgroundDocument(host.fs, createDocumentIdentity("memory-project", PATH));
  ok(result.ok);
  equal(result.document.getSnapshot().minor, 0);
  ok(result.document.getSnapshot().readOnly !== null);
  deepEqual(result.document.serialize(), textFixture, "a read-only text document serializes its original bytes");
  ok(!(await result.document.save()).ok, "the legacy text file is not converted on Save");
  const copied = await result.document.saveAs(host.fs, createDocumentIdentity("memory-project", "copy.bkg"));
  ok(copied.ok);
  deepEqual(host.bytesOf(PATH), textFixture);
  deepEqual(host.bytesOf("copy.bkg"), textFixture, "Save As copies the original text bytes rather than converting them");
});
