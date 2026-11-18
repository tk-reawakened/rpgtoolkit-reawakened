import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { utf8Encode } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, createNativeClipDocument, DOCUMENT_KINDS, kindForPath, openNativeClipDocument } from "../src/index.ts";

const PATH = "Misc/walk.tkranm";
const IDENTITY = createDocumentIdentity("memory-project", PATH);
const SOURCE = "contract: animation-clip\nversion: 1.0.0-pre.1\ncanvas: {width: 32, height: 32}\ndelay: 0.15 # timing\nframes:\n  - image: bitmap/walk.png # frame\n";

test("native clip edits one authored line, preserves comments, and undo/redo/save/reopen keep exact UTF-8", async () => {
  const bytes = utf8Encode(SOURCE);
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  const opened = await openNativeClipDocument(host.fs, IDENTITY);
  ok(opened.ok);
  const doc = opened.document;
  equal(doc.kind, "native-clip");
  equal(doc.getSnapshot().clip.delay, 0.15);
  const applied = doc.apply({ type: "set-native-clip-property", path: ["delay"], value: 0.2 });
  ok(applied.ok);
  const edited = SOURCE.replace("delay: 0.15", "delay: 0.2");
  deepEqual(doc.serialize(), utf8Encode(edited));
  equal(doc.undo(applied.editId).ok, true);
  deepEqual(doc.serialize(), bytes);
  equal(doc.redo(applied.editId).ok, true);
  deepEqual(doc.serialize(), utf8Encode(edited));
  ok((await doc.save()).ok);
  deepEqual(host.bytesOf(PATH), utf8Encode(edited));
  const reopened = await openNativeClipDocument(host.fs, IDENTITY);
  ok(reopened.ok);
  deepEqual(reopened.document.serialize(), utf8Encode(edited));
});

test("native clip editor saves and reopens edits without changing opaque plugin source", async () => {
  const source = [
    "contract: animation-clip",
    "version: 1.0.0-pre.1",
    "canvas: {width: 32, height: 32}",
    "delay: 0.15 # timing",
    "frames:",
    "  - image: bitmap/walk.png",
    "pluginData: # preserve this region",
    "  com.example.weather:",
    "    version: 1.0.0",
    "    data: {wind: 1.10, futureKnob: \"leave: exact\"} # opaque",
    "",
  ].join("\n");
  const host = createMemoryPlatformServices({ files: { [PATH]: utf8Encode(source) } });
  const opened = await openNativeClipDocument(host.fs, IDENTITY);
  ok(opened.ok);
  const expected = source.replace("delay: 0.15", "delay: 0.2");
  const applied = opened.document.apply({ type: "set-native-clip-property", path: ["delay"], value: 0.2 });
  ok(applied.ok);
  deepEqual(opened.document.serialize(), utf8Encode(expected));
  ok((await opened.document.save()).ok);
  deepEqual(host.bytesOf(PATH), utf8Encode(expected));
  const reopened = await openNativeClipDocument(host.fs, IDENTITY);
  ok(reopened.ok);
  deepEqual(reopened.document.serialize(), utf8Encode(expected));
});

test("flow-mapping property removal preserves the preceding comment through undo and redo", async () => {
  const source = `${SOURCE.replace("  - image: bitmap/walk.png # frame\n", "  - {image: bitmap/walk.png, # front view\n    sound: media/step.wav}\n")}`;
  const host = createMemoryPlatformServices({ files: { [PATH]: utf8Encode(source) } });
  const opened = await openNativeClipDocument(host.fs, IDENTITY);
  ok(opened.ok);
  const applied = opened.document.apply({ type: "remove-native-clip-property", path: ["frames", 0, "sound"] });
  ok(applied.ok);
  const edited = source.replace(", # front view\n    sound: media/step.wav}", " # front view\n    }");
  deepEqual(opened.document.serialize(), utf8Encode(edited));
  equal(opened.document.undo(applied.editId).ok, true);
  deepEqual(opened.document.serialize(), utf8Encode(source));
  equal(opened.document.redo(applied.editId).ok, true);
  deepEqual(opened.document.serialize(), utf8Encode(edited));
});

test("native clip frame IDs lowercase only when edited", async () => {
  const source = SOURCE.replace("bitmap/walk.png", "Existing/Walk.PNG");
  const host = createMemoryPlatformServices({ files: { [PATH]: utf8Encode(source) } });
  const opened = await openNativeClipDocument(host.fs, IDENTITY);
  ok(opened.ok);
  const applied = opened.document.apply({ type: "set-native-clip-property", path: ["frames", 0, "image"], value: "Bitmap/New.PNG" });
  ok(applied.ok);
  const edited = source.replace("Existing/Walk.PNG", "bitmap/new.png");
  deepEqual(opened.document.serialize(), utf8Encode(edited));
  equal(opened.document.getSnapshot().clip.frames[0]!.image, "bitmap/new.png");
});

test("native clip sound IDs lowercase when edited while authored image bytes stay unchanged", async () => {
  const source = `${SOURCE}    sound: Existing/Step.WAV\n`;
  const host = createMemoryPlatformServices({ files: { [PATH]: utf8Encode(source) } });
  const opened = await openNativeClipDocument(host.fs, IDENTITY);
  ok(opened.ok);
  const applied = opened.document.apply({ type: "set-native-clip-property", path: ["frames", 0, "sound"], value: "Media/New.WAV" });
  ok(applied.ok);
  const edited = source.replace("Existing/Step.WAV", "media/new.wav");
  deepEqual(opened.document.serialize(), utf8Encode(edited));
  equal(opened.document.getSnapshot().clip.frames[0]!.image, "bitmap/walk.png");
});

test("native clip refuses malformed UTF-8 and invalid edits without mutation while preserving a BOM", async () => {
  const validBytes = utf8Encode(SOURCE);
  const commentAt = validBytes.indexOf(0x23);
  const bytesWithInvalidComment = new Uint8Array([...validBytes.slice(0, commentAt + 1), 0xff, ...validBytes.slice(commentAt + 1)]);
  const host = createMemoryPlatformServices({ files: { [PATH]: bytesWithInvalidComment } });
  const malformed = await openNativeClipDocument(host.fs, IDENTITY);
  equal(malformed.ok, false);
  if (!malformed.ok) equal(malformed.error.error.message, `Invalid UTF-8 in native clip ${PATH}; the file was not opened.`);
  const bom = createNativeClipDocument(host.fs, IDENTITY, utf8Encode(`\ufeff${SOURCE}`));
  ok(bom.ok);
  deepEqual(bom.document.serialize(), utf8Encode(`\ufeff${SOURCE}`));
  ok(bom.document.apply({ type: "set-native-clip-property", path: ["delay"], value: 0.2 }).ok);
  deepEqual(bom.document.serialize(), utf8Encode(`\ufeff${SOURCE.replace("delay: 0.15", "delay: 0.2")}`));
  const validHost = createMemoryPlatformServices({ files: { [PATH]: utf8Encode(SOURCE) } });
  const opened = await openNativeClipDocument(validHost.fs, IDENTITY);
  ok(opened.ok);
  const before = opened.document.getSnapshot();
  equal(opened.document.apply({ type: "set-native-clip-property", path: ["delay"], value: -1 }).ok, false);
  equal(opened.document.apply({ type: "remove-native-clip-property", path: ["frames", 0, "image"] }).ok, false);
  equal(opened.document.getSnapshot(), before);
});

test("native clip registry owns .tkranm independently of legacy .anm", async () => {
  equal(kindForPath("Misc/walk.tkranm")?.id, "native-clip");
  equal(kindForPath("Misc/walk.anm")?.id, "animation");
  equal(DOCUMENT_KINDS.find((kind) => kind.id === "native-clip")?.storage, "native-text");
  const kind = kindForPath(PATH);
  ok(kind !== null);
  const host = createMemoryPlatformServices({ files: { [PATH]: utf8Encode(SOURCE) } });
  const opened = await kind.open(host.fs, IDENTITY);
  ok(opened.ok);
});
