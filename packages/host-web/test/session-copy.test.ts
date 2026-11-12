import { deepEqual, equal, notDeepEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createDocumentIdentity, createMainDocument } from "@tk-reawakened/editor-model";
import { createSessionCopy } from "../src/index.ts";

const original = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor4.gam", import.meta.url)));

test("session copy is identified honestly and persists edits only in the page copy", async () => {
  const project = createSessionCopy("game.gam", original);
  equal(project.sessionCopy, true);
  equal(project.project.name, "game.gam (session copy)");
  const opened = createMainDocument(project.services.fs, createDocumentIdentity(project.project.id, "game.gam"), original);
  equal(project.services.capabilities.size, 0, "a page-memory copy claims no persistent host capabilities");
  ok(opened.ok);
  const edit = opened.document.apply({ type: "set-game-title", title: "Session title" });
  ok(edit.ok);
  const saved = await opened.document.save();
  ok(saved.ok);
  equal(opened.document.getSnapshot().gameTitle, "Session title");
  const bytes = await project.services.fs.read("game.gam");
  ok(bytes.ok);
  notDeepEqual(bytes.value, original);
});

test("session-copy filesystem validates every relative-path operation and permits only root exceptions", async () => {
  const fs = createSessionCopy("game.gam", original).services.fs;
  for (const result of [
    await fs.list("../outside"),
    await fs.read("../outside"),
    await fs.write("../outside", new Uint8Array()),
    await fs.stat("../outside"),
    await fs.delete("../outside"),
    await fs.rename("game.gam", "../outside"),
    await fs.rename("../outside", "game.gam"),
    await fs.watch("../outside", () => undefined),
  ]) {
    ok(!result.ok && result.error.code === "invalid-path");
  }
  const listed = await fs.list("");
  ok(listed.ok);
  const root = await fs.stat("");
  ok(root.ok && root.value.kind === "directory");
  for (const result of [await fs.read(""), await fs.write("", new Uint8Array()), await fs.delete("")]) {
    ok(!result.ok && result.error.code === "invalid-path");
  }
  const watch = await fs.watch("", () => undefined);
  ok(!watch.ok && watch.error.code === "unavailable");
});

test("retiring a switched-away web project refuses its document saves without affecting an independent project", async () => {
  const a = createSessionCopy("game.gam", original);
  const b = createSessionCopy("game.gam", original);
  const opened = createMainDocument(a.services.fs, createDocumentIdentity(a.project.id, "game.gam"), original);
  ok(opened.ok);
  opened.document.apply({ type: "set-game-title", title: "Unsaved" });
  a.deactivate();
  const result = await opened.document.save();
  ok(!result.ok);
  equal(result.failure.document, "game.gam");
  ok(opened.document.getSnapshot().dirty);
  const bytesA = await a.services.fs.read("game.gam");
  const bytesB = await b.services.fs.read("game.gam");
  ok(bytesA.ok && bytesB.ok);
  deepEqual(bytesA.value, original);
  deepEqual(bytesB.value, original);
  ok((await b.services.fs.writeProject(b.project.id, "game.gam", original)).ok);
});
