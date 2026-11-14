import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ANIMATION_MAGIC, writeAnimation, type Animation, type AnimationFrame } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, kindForPath, openAnimationDocument } from "../src/index.ts";

const PATH = "Misc/walk.anm";
const identity = createDocumentIdentity("memory-project", PATH);
const frame = (image: string, sound: string, transparent = { r: 255, g: 0, b: 255 }): AnimationFrame => ({ image, transparent, sound });
const animationBytes = (frames: readonly AnimationFrame[] = [frame("a.png", "step.wav")], width = 16, height = 24, delay = 0.125): Uint8Array => {
  const animation: Animation = { magic: ANIMATION_MAGIC, major: 2, minor: 3, width, height, frames, delay, residue: new Uint8Array() };
  const result = writeAnimation(animation);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

test("animation is a registered editable document; frame operations keep image, transparency and sound attached through save/reopen", async () => {
  const original = animationBytes();
  const host = createMemoryPlatformServices({ files: { [PATH]: original } });
  const opened = await openAnimationDocument(host.fs, identity);
  ok(opened.ok);
  const doc = opened.document;
  equal(doc.kind, "animation");
  equal(kindForPath("Misc/WALK.ANM")?.id, "animation");
  equal(doc.getSnapshot().width, 16);
  equal(doc.getSnapshot().height, 24);
  equal(doc.getSnapshot().delay, 0.125);

  const added = frame("b.png", "hit.wav", { r: 12, g: 34, b: 56 });
  ok(doc.apply({ type: "insert-animation-frame", index: 1, frame: added }).ok);
  ok(doc.apply({ type: "move-animation-frame", from: 1, to: 0 }).ok);
  ok(doc.apply({ type: "set-animation-canvas", width: 48, height: 32 }).ok);
  ok(doc.apply({ type: "set-animation-delay", delay: 0.25 }).ok);
  deepEqual(doc.getSnapshot().frames, [added, frame("a.png", "step.wav")]);
  ok((await doc.save()).ok);

  const stored = await host.fs.read(PATH);
  ok(stored.ok);
  const reopened = await openAnimationDocument(host.fs, identity);
  ok(reopened.ok);
  deepEqual(reopened.document.serialize(), stored.value);
  deepEqual(reopened.document.getSnapshot().frames, [added, frame("a.png", "step.wav")]);
  equal(reopened.document.getSnapshot().width, 48);
  equal(reopened.document.getSnapshot().height, 32);
  equal(reopened.document.getSnapshot().delay, 0.25);
});

test("Toolkit 2 text animation is explicitly read-only and byte-identical on open", async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "spec", "examples", "versions", "animation", "animation_text.anm");
  const bytes = new Uint8Array(readFileSync(root));
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  const opened = await openAnimationDocument(host.fs, identity);
  ok(opened.ok);
  equal(opened.document.getSnapshot().minor, 0);
  equal(opened.document.getSnapshot().readOnly?.code, "no-same-version-writer");
  equal((await opened.document.save()).ok, false);
  const edited = opened.document.apply({ type: "set-animation-delay", delay: 0.5 });
  equal(edited.ok, false);
  const stored = await host.fs.read(PATH);
  ok(stored.ok);
  deepEqual(stored.value, bytes);
});
