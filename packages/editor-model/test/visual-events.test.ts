import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity } from "../src/identity.ts";
import { openProgramDocument, programCodec } from "../src/program-document.ts";
import { addShowMessage, deleteShowMessage, editShowMessage, projectVisualProgram } from "../src/visual-events.ts";

const bytes = (source: string): Uint8Array => Uint8Array.from(source, (character) => character.charCodeAt(0));
const sourceOf = (source: string, edit: { readonly from: number; readonly to: number; readonly text: string }): string =>
  source.slice(0, edit.from) + edit.text + source.slice(edit.to);

test("projects only tokenizer-bounded message sequences and preserves opaque code", () => {
  const source = '// hand-written\nmwin("Welcome.")\nwait()\nmwincls()\nvisits = visits + 1\n';
  const projection = projectVisualProgram(source);
  equal(projection.regions.length, 3);
  deepEqual(projection.regions[0], { type: "opaque", text: "// hand-written\n", from: 0, to: 16, line: 1 });
  const card = projection.regions[1]!;
  equal(card.type, "show-message");
  if (card.type === "show-message") {
    equal(card.message, "Welcome.");
    const edited = editShowMessage(projection, card.from, "Hello!");
    ok(edited.ok);
    if (edited.ok) equal(sourceOf(source, edited.edit), source.replace('mwin("Welcome.")', 'mwin("Hello!")'));
    const deleted = deleteShowMessage(projection, card.from);
    ok(deleted.ok);
    if (deleted.ok) equal(sourceOf(source, deleted.edit), "// hand-written\nvisits = visits + 1\n");
  }
});

test("keeps comments, lookalikes, and continued statements opaque", () => {
  const source = '/*\nmwin("not code")\nwait()\nmwincls()\n*/\nfoo _\nmwin("continued")\nwait()\nmwincls()';
  equal(projectVisualProgram(source).regions.some((region) => region.type === "show-message"), false);
});

test("treats LEX-8 backslashes as literal characters and rejects unsupported message values", () => {
  const projection = projectVisualProgram('mwin("path\\name")\nwait()\nmwincls()');
  const card = projection.regions[0]!;
  equal(card.type, "show-message");
  if (card.type === "show-message") {
    equal(card.message, "path\\name");
    const update = editShowMessage(projection, card.from, "new\\path");
    ok(update.ok);
    if (update.ok) equal(sourceOf(projection.source, update.edit), 'mwin("new\\path")\nwait()\nmwincls()');
    equal(editShowMessage(projection, card.from, 'say "hi"').ok, false);
    equal(editShowMessage(projection, card.from, "two\nlines").ok, false);
    equal(editShowMessage(projection, card.from, "snowman ☃").ok, false);
  }
});

test("adds a canonical sequence as one EOF edit and refuses unsafe source", () => {
  const projection = projectVisualProgram("// keep\n");
  const added = addShowMessage(projection, "Hello");
  ok(added.ok);
  if (added.ok) equal(sourceOf(projection.source, added.edit), '// keep\nmwin("Hello")\nwait()\nmwincls()\n');
  equal(addShowMessage(projectVisualProgram("", true)).ok, false);
  const malformed = projectVisualProgram("broken @ source");
  equal(malformed.lexicalError, true);
  equal(malformed.regions.length, 1);
  equal(addShowMessage(malformed).ok, false);
  equal(addShowMessage(projectVisualProgram("if (true) {\n")).ok, false);
  equal(addShowMessage(projectVisualProgram("x = 1 _\n")).ok, false);
  equal(addShowMessage(projectVisualProgram("x = 1 _")).ok, false);
  equal(addShowMessage(projectVisualProgram("// an _ is only trivia")).ok, true);
  equal(addShowMessage(projectVisualProgram("\n")).ok, true);
  equal(addShowMessage(projectVisualProgram("x = 1; y = 2 _\n")).ok, false);
  equal(addShowMessage(projectVisualProgram("x = (1")).ok, false);
});

test("refuses stale or missing card positions", () => {
  const original = projectVisualProgram('mwin("A")\nwait()\nmwincls()');
  const card = original.regions[0]!;
  if (card.type !== "show-message") throw new Error("expected card");
  const missing = projectVisualProgram('mwin("B")\nwait()\nother()');
  equal(editShowMessage(missing, card.from, "C").ok, false);
  equal(deleteShowMessage(original, card.from + 1).ok, false);
});

test("card TextEdits preserve mixed line endings through the program codec", () => {
  const source = '// keep\r\nmwin("A")\nwait()\r\nmwincls()\r\nvisits = visits + 1';
  const read = programCodec.read(bytes(source), "Prg/test.prg");
  ok(read.ok);
  if (!read.ok) return;
  const projection = projectVisualProgram(read.value.text);
  const card = projection.regions.find((region) => region.type === "show-message");
  if (card === undefined || card.type !== "show-message") throw new Error("expected projected card");
  const change = editShowMessage(projection, card.from, "B");
  ok(change.ok);
  if (!change.ok) return;
  const next = programCodec.apply(read.value, { type: "edit-text", edits: [change.edit] });
  const written = programCodec.write(next);
  ok(written.ok);
  if (written.ok) equal(new TextDecoder("windows-1252").decode(written.value), source.replace('mwin("A")', 'mwin("B")'));
  deepEqual(projectVisualProgram(read.value.text).regions.map((region) => region.type), ["opaque", "show-message", "opaque"]);
});

test("a failed save keeps the visual edit in shared document history", async () => {
  const path = "Prg/tracer.prg";
  const source = 'mwin("before")\nwait()\nmwincls()';
  const host = createMemoryPlatformServices({ files: { [path]: bytes(source) } });
  const opened = await openProgramDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  if (!opened.ok) return;
  const doc = opened.document;
  const projection = projectVisualProgram(doc.getSnapshot().text);
  const card = projection.regions.find((region) => region.type === "show-message");
  if (card === undefined || card.type !== "show-message") throw new Error("expected projected card");
  const changed = editShowMessage(projection, card.from, "after");
  ok(changed.ok);
  if (!changed.ok) return;
  const applied = doc.apply({ type: "edit-text", edits: [changed.edit], label: "Edit Show message" });
  ok(applied.ok);
  if (!applied.ok) return;
  equal(doc.getSnapshot().text, 'mwin("after")\nwait()\nmwincls()');
  host.failWrites({ code: "io-error", message: "disk full" });
  equal((await doc.save()).ok, false);
  equal(doc.getSnapshot().dirty, true);
  equal(doc.getSnapshot().text, 'mwin("after")\nwait()\nmwincls()');
  deepEqual(host.bytesOf(path), bytes(source));
  ok(doc.undo(applied.editId).ok);
  equal(doc.getSnapshot().text, source);
});
