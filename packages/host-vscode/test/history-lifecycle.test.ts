// The provider's own lifecycles carry the history sink (#2836): a recovered save and a Save As over an existing destination
// both keep the version they replace, read back through the destination's timeline.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BinaryReader, readMainFile } from "@tk-reawakened/core";
import { asMainDocument, createDocumentWorkspace } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { recoverMainDocument, resolveRecoveryConflict } from "@tk-reawakened/host-vscode/testing";
import { createGameEditorProvider, type GameDocument, type GameEditEvent, type GameEditorPort, type GameEditorProvider, type UriLike } from "../src/custom-editor.ts";

const PATH = "Main/example.gam";
const DEST = "Main/copy.gam";
const example = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor9.gam", import.meta.url)));
const titleOf = (bytes: Uint8Array): string => {
  const read = readMainFile(new BinaryReader(bytes, PATH));
  return read.ok ? read.value.gameTitle : "";
};
test("a recovered document saved over the disk version keeps the version it replaced (#2836)", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: example } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const identity = { key: `${PATH}`, projectId: "memory-project", path: PATH };
  const backup = (await (async () => {
    const opened = await workspace.open(PATH);
    ok(opened.ok);
    const applied = opened.document.apply({ type: "set-game-title", title: "Recovered work" });
    ok(applied.ok);
    return opened.document.serialize();
  })());
  workspace.release(workspace.documents()[0]!);
  const recovered = await recoverMainDocument(workspace.storage, identity as never, backup);
  ok(recovered.ok, recovered.ok ? "" : JSON.stringify(recovered.error));
  ok((await resolveRecoveryConflict(recovered.document, "keep-local")).ok);
  const saved = await recovered.document.save();
  ok(saved.ok, saved.ok ? "" : saved.failure.message);
  const entries = await workspace.history.documentTimeline(PATH);
  ok(entries.some((entry) => entry.reason === "before-conflict-resolution"), `the replaced disk version is kept; timeline: ${entries.map((entry) => entry.reason).join(", ")}`);
  workspace.dispose();
});

test("Save As over an existing destination keeps that destination's previous bytes (#2836)", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: example, [DEST]: example } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const opened = await workspace.open(PATH);
  ok(opened.ok);
  ok(opened.document.apply({ type: "set-game-title", title: "Copy with a new title" }).ok);
  const before = host.bytesOf(DEST)!;
  const copied = await opened.document.saveAs(workspace.storage, { key: DEST, projectId: "memory-project", path: DEST } as never);
  ok(copied.ok, copied.ok ? "" : copied.failure.message);
  const entries = await workspace.history.documentTimeline(DEST);
  ok(entries.length > 0, "the destination has history");
  const kept = await Promise.all(entries.map(async (entry) => (await workspace.history.preview(entry.id))!.bytes));
  ok(kept.some((bytes) => Buffer.compare(Buffer.from(bytes), Buffer.from(before)) === 0), "the destination's previous bytes are in its history");
  ok(kept.some((bytes) => Buffer.compare(Buffer.from(bytes), Buffer.from(host.bytesOf(DEST)!)) === 0), "and so is the copy that replaced them");
  equal(titleOf(host.bytesOf(DEST)!), "Copy with a new title");
  deepEqual(entries.map((entry) => entry.reason).sort(), ["checkpoint", "manual"].sort());
  workspace.dispose();
});
test("History restores an open custom editor through VS Code's edit and workbench save lifecycle", async () => {
  type TestUri = UriLike & { toString(): string };
  const root: TestUri = { path: "/project", toString: () => "memory-project" };
  const folder = { uri: root, key: "memory-project" };
  const uri: TestUri = { path: `/project/${PATH}`, toString: () => `memory-project/${PATH}` };
  const host = createMemoryPlatformServices({ files: { [PATH]: example } });
  const events: GameEditEvent<TestUri>[] = [];
  let provider!: GameEditorProvider<TestUri>;
  let document: GameDocument<TestUri> | undefined;
  let workbenchSaves = 0;
  const port: GameEditorPort<TestUri> = {
    capabilities: host.capabilities,
    folderOf: () => folder,
    fileSystem: () => host.fs,
    dialogs: () => host.dialogs,
    readBackup: async () => new Uint8Array(),
    writeBackup: async (_destination, bytes) => String(bytes.byteLength),
    deleteBackup: async () => undefined,
    saveEditor: async (target) => {
      if (document === undefined) return undefined;
      workbenchSaves += 1;
      await provider.saveCustomDocument(document);
      return target;
    },
    uriFor: (_folder, path) => ({ path: `/project/${path}`, toString: () => `memory-project/${path}` }),
    openEditor: async () => undefined,
    quickPick: async () => undefined,
  };
  provider = createGameEditorProvider(port, (event) => { events.push(event); });
  document = await provider.openCustomDocument(uri, undefined);
  const workspace = provider.workspaceFor(folder).workspace;
  const main = asMainDocument(document.model);
  ok(main.apply({ type: "set-game-title", title: "Later save" }).ok);
  await provider.saveCustomDocument(document);
  const savedVersion = (await workspace.history.documentTimeline(PATH)).find((entry) => entry.reason === "checkpoint")!;
  const report = await workspace.restoreHistoryEntry(savedVersion.id);
  deepEqual(report.files.map((file) => file.result), ["restored"]);
  equal(workbenchSaves, 1, "the restore is saved by the workbench, not a model-side bypass");
  equal(events.length, 1, "the accepted restore is registered as one native undo edit");
  ok(events[0]!.label.length > 0);
  const savedRestore = (await workspace.history.documentTimeline(PATH)).find((entry) => entry.groupId === report.restoreGroupId);
  ok(savedRestore, "the restored save is linked to its before-restore group");
  events[0]!.undo();
  equal(titleOf(document.model.serialize()), "Later save", "VS Code's undo callback reverses the restore");
  document.dispose();
  workspace.dispose();
});
