// The program text document (story 11.7; docs/spec/engine/rpgcode-tooling.md#tool-10-text): one editable text, lossless
// bytes, every line ending kept, edits that apply in order and undo as one.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, kindForPath, programCodec, type AnyDocument, type ProgramDocument, type ProgramDocumentSnapshot } from "../src/index.ts";

const PATH = "Prg/intro.prg";
const text = (value: string): Uint8Array => Uint8Array.from(value, (ch) => ch.charCodeAt(0));

async function open(bytes: Uint8Array): Promise<{ readonly host: MemoryPlatformServices; readonly doc: ProgramDocument }> {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  const opened = await kindForPath(PATH)!.open(host.fs, createDocumentIdentity("memory-project", PATH));
  ok(opened.ok);
  return { host, doc: opened.document as unknown as ProgramDocument };
}

const snapshot = (doc: ProgramDocument): ProgramDocumentSnapshot => doc.getSnapshot();

test("every byte value reads as one character and writes back as the same byte", () => {
  const bytes = Uint8Array.from({ length: 255 }, (_, index) => index + 1);
  const read = programCodec.read(bytes, PATH);
  ok(read.ok);
  const written = programCodec.write(read.value);
  ok(written.ok);
  deepEqual(written.value, bytes);
});

test("the editor shows LF only and remembers the ending of each break, including a lone CR and a missing final newline", async () => {
  const { doc } = await open(text("a\r\nb\nc\rd"));
  equal(snapshot(doc).text, "a\nb\nc\nd");
  equal(snapshot(doc).lineEnding, "mixed");
  deepEqual(doc.serialize(), text("a\r\nb\nc\rd"));
});

test("an edit keeps the endings of the lines around it and a new break takes the ending it replaces or follows", async () => {
  const { doc } = await open(text("one\r\ntwo\nthree\r\n"));
  // Insert a line after "one": the new break copies the CRLF of the break before it.
  ok(doc.apply({ type: "edit-text", edits: [{ from: 3, to: 3, text: "\nnew" }] }).ok);
  deepEqual(doc.serialize(), text("one\r\nnew\r\ntwo\nthree\r\n"));
  // Join "two" and "three": the LF between them goes, the others stay.
  const joined = snapshot(doc).text.indexOf("two\n") + 3;
  ok(doc.apply({ type: "edit-text", edits: [{ from: joined, to: joined + 1, text: " " }] }).ok);
  deepEqual(doc.serialize(), text("one\r\nnew\r\ntwo three\r\n"));
});

test("a file with no line break takes the legacy CRLF for the first one the author adds", async () => {
  const { doc } = await open(text("x = 1"));
  equal(snapshot(doc).lineEnding, "none");
  ok(doc.apply({ type: "edit-text", edits: [{ from: 5, to: 5, text: "\ny = 2" }] }).ok);
  deepEqual(doc.serialize(), text("x = 1\r\ny = 2"));
});

test("several edits in one command apply in order, each in the coordinates the last one left, and undo as one edit", async () => {
  const { doc } = await open(text("abc"));
  const applied = doc.apply({
    type: "edit-text",
    label: "Typing",
    edits: [{ from: 3, to: 3, text: "d" }, { from: 4, to: 4, text: "e" }, { from: 0, to: 1, text: "A" }],
  });
  ok(applied.ok);
  equal(snapshot(doc).text, "Abcde");
  equal(snapshot(doc).edits.at(-1)!.label, "Typing");
  ok(doc.undo(applied.editId).ok);
  equal(snapshot(doc).text, "abc");
  equal(snapshot(doc).dirty, false);
  ok(doc.redo().ok);
  equal(snapshot(doc).text, "Abcde");
});

test("a command is refused whole: out of range, CR in the text, no change, a character Windows-1252 cannot hold", async () => {
  const { doc } = await open(text("a\nb\nc"));
  const before = doc.getSnapshot();
  const refuse = (command: unknown): string => {
    const result = doc.apply(command as never);
    ok(!result.ok);
    equal(doc.getSnapshot(), before);
    return result.rejection.message;
  };
  ok(refuse({ type: "edit-text", edits: [{ from: 0, to: 99, text: "" }] }).includes("outside"));
  ok(refuse({ type: "edit-text", edits: [{ from: 0, to: 0, text: "x\r\n" }] }).includes("LF"));
  ok(refuse({ type: "edit-text", edits: [{ from: 0, to: 1, text: "a" }] }).includes("does not change"));
  // A good edit followed by a bad one rejects both: the document is unchanged.
  ok(refuse({ type: "edit-text", edits: [{ from: 0, to: 0, text: "ok" }, { from: 0, to: 99, text: "" }] }).includes("outside"));
  const unicode = refuse({ type: "edit-text", edits: [{ from: 4, to: 4, text: "\u2603" }] });
  ok(unicode.includes("U+2603"), unicode);
  ok(unicode.includes("line 3"), unicode);
});

test("isCommand accepts only the command shape", () => {
  ok(programCodec.isCommand({ type: "edit-text", edits: [{ from: 0, to: 0, text: "x" }] }));
  ok(!programCodec.isCommand({ type: "edit-text", edits: [{ from: "0", to: 0, text: "x" }] }));
  ok(!programCodec.isCommand({ type: "edit-text", edits: [{ from: 0, to: 0, text: "x" }], label: 3 }));
  ok(!programCodec.isCommand({ type: "other" }));
  ok(!programCodec.isCommand(null));
});

test("a compiled program opens read-only with the reason and is saved as a copy of the file, never converted", async () => {
  const compiled = Uint8Array.from([0, 1, 2, 3, 0xe9]);
  const { host, doc } = await open(compiled);
  const reason = snapshot(doc).readOnly;
  ok(reason !== null && reason.message.includes("compiled"));
  equal(snapshot(doc).compiled, true);
  const refused = doc.apply({ type: "edit-text", edits: [{ from: 0, to: 0, text: "x" }] });
  ok(!refused.ok);
  equal(refused.rejection.reason, "read-only");
  deepEqual(doc.serialize(), compiled);
  equal((await doc.save()).ok, false);
  deepEqual(host.bytesOf(PATH), compiled);
});

test("an empty program is a valid empty text", async () => {
  const { doc } = await open(new Uint8Array());
  equal(snapshot(doc).text, "");
  equal(snapshot(doc).readOnly, null);
  equal(kindForPath(PATH)!.summarise(new Uint8Array(), PATH), "0 lines");
  ok(doc.apply({ type: "edit-text", edits: [{ from: 0, to: 0, text: "x" }] }).ok);
  deepEqual(doc.serialize(), text("x"));
});

test("a save writes the edited bytes and reopening gives the same text", async () => {
  const { host, doc } = await open(text("// caf\u00e9\r\nx = 1\r\n"));
  ok(doc.apply({ type: "edit-text", edits: [{ from: 0, to: 0, text: "// top\n" }] }).ok);
  ok((await doc.save()).ok);
  deepEqual(host.bytesOf(PATH), text("// top\r\n// caf\u00e9\r\nx = 1\r\n"));
  const again = await kindForPath(PATH)!.open(host.fs, createDocumentIdentity("memory-project", PATH));
  ok(again.ok);
  equal((again.document as AnyDocument & { getSnapshot(): ProgramDocumentSnapshot }).getSnapshot().text, "// top\n// caf\u00e9\nx = 1\n");
});
