import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { utf8Encode } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, createNativeSkinDocument, DOCUMENT_KINDS, openNativeSkinDocument } from "../src/index.ts";

const GAM = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const PATH = "Misc/stone.tkrskin";
const SOURCE = "# author comment\ncontract: skin\nversion: 1.0.0-pre.1+build.2\ntags: [preview]\nmetadata: {source: handwritten, note: 1.10}\nlabel: Stone keep\nwindowImage: bitmap/old-window.png\nbuttonImage: bitmap/old-button.png # retained\npluginData:\n  com.example.glow:\n    version: 1.0.0\n    data: {future: 1.10}\n";
const bytes = utf8Encode(SOURCE);

test("native skin is registered and edits, undoes, redoes, saves and reopens with untouched source intact", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes, "Main/example.gam": GAM } });
  ok(DOCUMENT_KINDS.some((kind) => kind.id === "skin"));
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", PATH));
  ok(opened.ok);
  const doc = opened.document;
  equal(doc.kind, "skin");
  equal(doc.getSnapshot().skin.version, "1.0.0-pre.1+build.2");
  const applied = doc.apply({ type: "set-native-skin-image", field: "windowImage", reference: "bitmap/new-window.png" });
  ok(applied.ok);
  deepEqual(doc.serialize(), utf8Encode(SOURCE.replace("bitmap/old-window.png", "bitmap/new-window.png")));
  ok(doc.undo(applied.editId).ok);
  deepEqual(doc.serialize(), bytes);
  ok(doc.redo(applied.editId).ok);
  const edited = utf8Encode(SOURCE.replace("bitmap/old-window.png", "bitmap/new-window.png"));
  deepEqual(doc.serialize(), edited);
  ok((await doc.save()).ok);
  deepEqual(host.bytesOf(PATH), edited);
  const reopened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", PATH));
  ok(reopened.ok);
  deepEqual(host.bytesOf("Main/example.gam"), GAM, "opening and saving a skin never writes the game file");
  equal(reopened.document.getSnapshot().skin.windowImage, "bitmap/new-window.png");
  equal(reopened.document.getSnapshot().skin.buttonImage, "bitmap/old-button.png");
  deepEqual(reopened.document.serialize(), edited);
});

test("native skin refuses malformed commands and malformed source without changing bytes", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", PATH));
  ok(opened.ok);
  const doc = opened.document;
  const before = doc.serialize();
  const refused = doc.apply({ type: "set-native-skin-image", field: "windowImage", reference: "bitmap/bad.svg" });
  ok(!refused.ok);
  deepEqual(doc.serialize(), before);
  const result = createNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", PATH), utf8Encode(SOURCE.replace("contract: skin", "contract: other")));
  ok(!result.ok);
  deepEqual(doc.serialize(), bytes);
});

test("a refused skin save keeps its edited draft dirty and leaves the game file untouched", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes, "Main/example.gam": GAM } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", PATH));
  ok(opened.ok);
  const applied = opened.document.apply({ type: "set-native-skin-image", field: "buttonImage", reference: "bitmap/new-button.png" });
  ok(applied.ok);
  host.failWrites({ code: "io-error", message: "refused" });
  const saved = await opened.document.save();
  ok(!saved.ok);
  equal(opened.document.getSnapshot().dirty, true);
  equal(opened.document.getSnapshot().skin.buttonImage, "bitmap/new-button.png");
  deepEqual(host.bytesOf(PATH), bytes);
  deepEqual(host.bytesOf("Main/example.gam"), GAM);
});
