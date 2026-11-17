import { deepEqual, equal, ok } from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { platformError, platformOk } from "@tk-reawakened/platform-services";
import { animationTileBitmapBytes, createAnimationAuthoring, createAnimationFile, createDocumentIdentity, newAnimationBytes, openAnimationDocument, type AnimationCommand, type CheckpointEnvironment } from "../src/index.ts";
const path = "Misc/walk.anm";
const command: AnimationCommand = { type: "replace-animation", width: 128, height: 128, delay: .2, frames: [
  { image: "second.tbm", sound: "step.wav", transparent: { r: 1, g: 2, b: 3 } },
  { image: "first.tbm", sound: "hit.wav", transparent: { r: 4, g: 5, b: 6 } },
] };
async function fixture() {
  const host = createMemoryPlatformServices({ files: { [path]: newAnimationBytes() } });
  const opened = await openAnimationDocument(host.fs, createDocumentIdentity("memory-project", path)); ok(opened.ok);
  const doc = opened.document; let id = 0; let fail = false;
  const writes: string[] = [];
  const fs = { ...host.fs, async writeProject(project: string, target: string, bytes: Uint8Array) { writes.push(target); return host.fs.writeProject(project, target, bytes); } };
  const env: CheckpointEnvironment = { fs, projectId: "memory-project", hash: async (bytes) => createHash("sha256").update(bytes).digest("hex"), newId: () => `animation-${++id}`, time: () => "2026-11-15", guard: async (target) => target === path && doc.getSnapshot().dirty ? "Unsaved work" : null, consent: async () => true };
  const authoring = createAnimationAuthoring(env, doc, async () => {
    if (fail) return platformError("io-error", "Injected host save failure");
    const result = await doc.save(); return result.ok ? platformOk(undefined) : platformError("io-error", result.failure.message);
  }, (editId) => host.document.edited({ document: doc.identity.key, editId, label: "Wizard" }));
  return { host, doc, env, authoring, writes, fail: (value: boolean) => { fail = value; } };
}
const tbm = () => animationTileBitmapBytes(new Array<string>(16).fill("set.tst1"));

test("multi-frame wizard preserves displayed output order, metadata, canvas, undo and reopen", async () => {
  const { host, doc, authoring, writes } = await fixture();
  const result = await authoring.commitAnimation(command, [{ path: "Bitmap/second.tbm", bytes: tbm() }, { path: "Bitmap/first.tbm", bytes: tbm() }]); ok(result.ok);
  deepEqual(result.value.files.map((file) => file.path), ["Bitmap/second.tbm", "Bitmap/first.tbm", path]);
  deepEqual(writes.filter((target) => !target.startsWith(".tkr-history")), ["Bitmap/second.tbm", "Bitmap/first.tbm"]);
  equal(host.editedEvents.length, 1); equal(doc.getSnapshot().dirty, false);
  const reopened = await openAnimationDocument(host.fs, doc.identity); ok(reopened.ok);
  deepEqual(reopened.document.getSnapshot().frames, command.frames); equal(reopened.document.getSnapshot().width, 128);
  ok(doc.undo().ok); equal(doc.getSnapshot().frames.length, 0); ok(doc.redo().ok);
});

test("retry saves the exact pending ANM revision after rejected save and protects later unrelated edits", async () => {
  const { authoring, doc, fail } = await fixture(); fail(true);
  const failed = await authoring.commitAnimation(command, [{ path: "Bitmap/second.tbm", bytes: tbm() }]); ok(failed.ok);
  equal(failed.value.files.at(-1)!.status, "failed"); equal(doc.getSnapshot().dirty, true);
  ok(doc.apply({ type: "set-animation-delay", delay: .75 }).ok);
  fail(false); const refused = await authoring.retry(failed.value.id); ok(refused.ok); equal(refused.value.files.at(-1)!.status, "failed"); equal(doc.getSnapshot().delay, .75);
  ok(doc.undo().ok);
  const retried = await authoring.retry(failed.value.id); ok(retried.ok); equal(retried.value.files.at(-1)!.status, "written"); equal(doc.getSnapshot().dirty, false);
  const restored = await authoring.restore(failed.value.id); ok(restored.ok); equal(doc.getSnapshot().frames.length, 0);
  const again = await authoring.restore(failed.value.id); ok(again.ok); equal(again.value.files.at(-1)!.status, "already-as-wanted");
});

test("new destination and TBM validation refuse before any targets; text minor zero remains read-only", async () => {
  const { host, env, authoring } = await fixture();
  equal((await createAnimationFile(env, "Misc/../escape.anm")).ok, false);
  equal((await authoring.commitAnimation(command, [{ path: "Bitmap/bad.tbm", bytes: new Uint8Array([1]) }])).ok, false);
  const text = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/animation/animation_text.anm", import.meta.url)));
  host.seed("Misc/OLD.ANM", text);
  equal((await createAnimationFile(env, "Misc/old.anm")).ok, false);
  deepEqual(host.bytesOf("Misc/OLD.ANM"), text);
});
