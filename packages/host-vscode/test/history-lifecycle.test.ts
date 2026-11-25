// The provider's own lifecycles carry the history sink (#2836): a recovered save and a Save As over an existing destination
// both keep the version they replace, read back through the destination's timeline.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createEmptyMainFile, writeMainFile } from "@tk-reawakened/core";
import { asMainDocument, createDocumentWorkspace } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { recoverMainDocument, resolveRecoveryConflict } from "@tk-reawakened/host-vscode/testing";
import { createGameEditorProvider, type GameDocument, type GameEditEvent, type GameEditorPort, type GameEditorProvider, type UriLike } from "../src/custom-editor.ts";
import { registerBoardUpgradeCommands } from "../src/board-upgrade-commands.ts";
const boardExample = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor4.brd", import.meta.url)));

const PATH = "Main/example.gam";
const DEST = "Main/copy.gam";
const example = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor9.gam", import.meta.url)));
type BoardTestUri = UriLike & { readonly scheme: string; readonly authority: string; toString(): string };

function boardUpgradeHarness(files: Record<string, Uint8Array>, destination: string, boardPick?: string) {
  const host = createMemoryPlatformServices({ files });
  host.answerQuestions("preview");
  host.answerSavePaths(destination);
  const makeUri = (path: string): BoardTestUri => ({
    path,
    scheme: "file",
    authority: "",
    toString: () => path === "/project" ? "memory-project" : `memory-project${path.slice("/project".length)}`,
  });
  const root = makeUri("/project");
  const folder = { uri: root, name: "project", index: 0 };
  const registered = new Map<string, (...args: unknown[]) => unknown>();
  const errors: string[] = [];
  const openedWith: { readonly uri: BoardTestUri; readonly viewType: string }[] = [];
  let provider!: GameEditorProvider<BoardTestUri>;
  let workbenchSaves = 0;
  const api = {
    workspace: {
      workspaceFolders: [folder],
      getWorkspaceFolder: (uri: BoardTestUri) => uri.path.startsWith(`${root.path}/`) ? folder : undefined,
      fs: {
        readDirectory: async (uri: BoardTestUri) => {
          const path = uri.path === root.path ? "" : uri.path.slice(root.path.length + 1);
          const listed = await host.fs.listProject("memory-project", path);
          if (!listed.ok) throw new Error(listed.error.message);
          return listed.value.map(({ name, kind }) => [name, kind === "directory" ? 2 : kind === "link" ? 64 : 1] as [string, number]);
        },
      },
    },
    window: {
      activeTextEditor: undefined,
      showErrorMessage: async (message: string) => { errors.push(message); },
      showInformationMessage: async () => undefined,
      showQuickPick: async <T extends { readonly label: string }>(items: readonly T[]) => items.find(({ label }) => label === boardPick),
    },
    commands: {
      registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
        registered.set(id, handler);
        return { dispose: () => { registered.delete(id); } };
      },
      executeCommand: async (id: string, ...args: unknown[]) => {
        if (id === "vscode.openWith") {
          const uri = args[0] as BoardTestUri;
          const viewType = args[1] as string;
          openedWith.push({ uri, viewType });
          await provider.openCustomDocument(uri, undefined);
          return undefined;
        }
        const command = registered.get(id);
        if (command === undefined) throw new Error(`Unregistered command: ${id}`);
        return command(...args);
      },
    },
    Uri: {
      joinPath: (base: BoardTestUri, ...segments: string[]) =>
        makeUri(`${base.path.replace(/\/$/, "")}/${segments.join("/")}`),
    },
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  };
  const events: GameEditEvent<BoardTestUri>[] = [];
  const port: GameEditorPort<BoardTestUri> = {
    capabilities: host.capabilities,
    folderOf: () => ({ uri: root, key: "memory-project" }),
    fileSystem: () => host.fs,
    dialogs: () => host.dialogs,
    readBackup: async () => new Uint8Array(),
    writeBackup: async (_target, bytes) => String(bytes.byteLength),
    deleteBackup: async () => undefined,
    saveEditor: async (target) => {
      const document = provider.openDocument(target);
      if (document === undefined) return undefined;
      workbenchSaves += 1;
      await provider.saveCustomDocument(document);
      return target;
    },
    uriFor: (_folder, path) => makeUri(`/project/${path}`),
    openEditor: async () => undefined,
    quickPick: async () => undefined,
    runBoardUpgrade: async (uri, operation) => {
      const id = operation === "stacked-to-rotated" ? "tkr.upgradeBoardStackedToRotated"
        : operation === "tile-to-pixel" ? "tkr.upgradeBoardTileToPixel" : "tkr.upgradePreVectorBoard";
      await api.commands.executeCommand(id, uri);
    },
  };
  provider = createGameEditorProvider(port, (event) => { events.push(event); });
  const context = { subscriptions: [] };
  registerBoardUpgradeCommands(context as never, provider, () => false, {
    vscode: api as never,
    activeEditorUri: () => undefined,
    fileSystem: () => host.fs,
    dialogs: () => host.dialogs,
  });
  return {
    host, provider, root, folder, makeUri, events, errors, openedWith,
    executeCommand: (id: string, ...args: unknown[]) => api.commands.executeCommand(id, ...args),
    get workbenchSaves() { return workbenchSaves; },
  };
}

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
  const copiedBytes = opened.document.serialize();
  const before = host.bytesOf(DEST)!;
  const copied = await opened.document.saveAs(workspace.storage, { key: DEST, projectId: "memory-project", path: DEST } as never);
  ok(copied.ok, copied.ok ? "" : copied.failure.message);
  const entries = await workspace.history.documentTimeline(DEST);
  ok(entries.length > 0, "the destination has history");
  const kept = await Promise.all(entries.map(async (entry) => (await workspace.history.preview(entry.id))!.bytes));
  ok(kept.some((bytes) => Buffer.compare(Buffer.from(bytes), Buffer.from(before)) === 0), "the destination's previous bytes are in its history");
  ok(kept.some((bytes) => Buffer.compare(Buffer.from(bytes), Buffer.from(host.bytesOf(DEST)!)) === 0), "and so is the copy that replaced them");
  deepEqual(host.bytesOf(DEST), copiedBytes);
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
  const savedWork = document.model.serialize();
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
  deepEqual(document.model.serialize(), savedWork, "VS Code's undo callback reverses the restore");
  document.dispose();
  workspace.dispose();
});
test("registered VS Code board command saves an edit through the workbench and native Undo survives close/reopen", async () => {
  const path = "Boards/Entry.brd";
  const copyPath = "Boards/Entry.pixels.brd";
  const harness = boardUpgradeHarness({ [path]: boardExample }, copyPath);
  const originalBytes = harness.host.bytesOf(path);
  ok(originalBytes);
  await harness.executeCommand("tkr.upgradeBoardTileToPixel", harness.makeUri(`/project/${path}`));

  const copyUri = harness.makeUri(`/project/${copyPath}`);
  const copy = harness.provider.openDocument(copyUri);
  ok(copy, `copy was not opened; openWith=${harness.openedWith.length}, errors=${harness.errors.join("; ")}`);
  equal(harness.openedWith[0]?.viewType, "tkr.board", "the copy is explicitly opened with the board editor");
  equal(harness.openedWith[0]?.uri.toString(), copyUri.toString());
  equal(copy.model.getSnapshot().edits.length, 1, "the registered action applies one board-model edit");
  equal(harness.workbenchSaves, 1, "the command saves through the VS Code workbench");
  equal(harness.events.length, 1, "the command registers one native undo edit");
  ok(harness.host.bytesOf(copyPath), "the converted copy was saved");
  deepEqual(harness.host.bytesOf(path), originalBytes, "the original remains unchanged");

  harness.events[0]!.undo();
  deepEqual(copy.model.serialize(), boardExample, "native Undo reverses the saved coordinate edit");
  equal(copy.model.getSnapshot().dirty, true, "undo after save is dirty, not lost behind the VS Code savepoint");
  const savedUndo = await copy.saveThroughWorkbench();
  ok(savedUndo.ok, savedUndo.ok ? "" : savedUndo.failure.message);
  copy.dispose();
  const reopened = await harness.provider.openCustomDocument(copyUri, undefined);
  deepEqual(reopened.model.serialize(), boardExample, "closing and reopening preserves the undo result");
  reopened.dispose();
  harness.provider.workspaceFor({ uri: harness.root, key: "memory-project" }).workspace.dispose();
  deepEqual(harness.errors, []);
});

test("registered VS Code pre-vector command from a modern-board URI selects a legacy board", async () => {
  const oldBytes = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor2.brd", import.meta.url)));
  const modernPath = "Boards/Modern.brd";
  const oldPath = "Boards/Old.brd";
  const copyPath = "Boards/Old.upgraded.brd";
  const harness = boardUpgradeHarness(
    { [modernPath]: boardExample, [oldPath]: oldBytes },
    copyPath,
    oldPath,
  );
  const originalModernBytes = harness.host.bytesOf(modernPath);
  const originalOldBytes = harness.host.bytesOf(oldPath);
  ok(originalModernBytes);
  ok(originalOldBytes);
  await harness.executeCommand("tkr.upgradePreVectorBoard", harness.makeUri(`/project/${modernPath}`));
  const copyUri = harness.makeUri(`/project/${copyPath}`);
  const copy = harness.provider.openDocument(copyUri);
  ok(copy, `selected board was not copied; openWith=${harness.openedWith.length}, errors=${harness.errors.join("; ")}`);
  equal(harness.openedWith[0]?.viewType, "tkr.board");
  deepEqual(harness.host.bytesOf(oldPath), originalOldBytes);
  deepEqual(harness.host.bytesOf(modernPath), originalModernBytes);
  ok(harness.host.bytesOf(copyPath));
  equal(copy.model.kind, "board");
  deepEqual(harness.errors, []);
  copy.dispose();
  harness.provider.workspaceFor({ uri: harness.root, key: "memory-project" }).workspace.dispose();
});
test("nested VS Code board discovery keeps the most-specific owner for a board found under parent and child roots", async () => {
  const oldBytes = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor2.brd", import.meta.url)));
  const mainA = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "A" });
  const mainB = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "A/Boards/Region" });
  ok(mainA.ok, mainA.ok ? "" : mainA.error.message);
  ok(mainB.ok, mainB.ok ? "" : mainB.error.message);
  const nestedPath = "Game/A/Boards/Region/Boards/Old.brd";
  const copyPath = "Game/A/Boards/Region/Boards/Old.upgraded.brd";
  const harness = boardUpgradeHarness({
    "Main/A.gam": mainA.value,
    "Main/B.gam": mainB.value,
    "Boards/Modern.brd": boardExample,
    [nestedPath]: oldBytes,
  }, copyPath, nestedPath);
  await harness.executeCommand("tkr.upgradePreVectorBoard", harness.makeUri("/project/Boards/Modern.brd"));
  ok(harness.host.bytesOf(copyPath), `nested board was not copied; errors=${harness.errors.join("; ")}`);
  deepEqual(harness.host.bytesOf(nestedPath), oldBytes, "the nested source remains unchanged");
  deepEqual(harness.errors, []);
  harness.provider.openDocument(harness.makeUri(`/project/${copyPath}`))?.dispose();
  harness.provider.workspaceFor({ uri: harness.root, key: "memory-project" }).workspace.dispose();
});
test("VS Code upgrade refuses a copy in a nested game's project root even when it is inside the parent Boards folder", async () => {
  const oldBytes = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor2.brd", import.meta.url)));
  const mainA = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "A" });
  const mainB = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "A/Boards/Region" });
  ok(mainA.ok, mainA.ok ? "" : mainA.error.message);
  ok(mainB.ok, mainB.ok ? "" : mainB.error.message);
  const source = "Game/A/Boards/Old.brd";
  const destination = "Game/A/Boards/Region/Copy.brd";
  const harness = boardUpgradeHarness({
    "Main/A.gam": mainA.value,
    "Main/B.gam": mainB.value,
    "Boards/Modern.brd": boardExample,
    "Game/A/Boards/Region/Prg/start.prg": new Uint8Array([1]),
    [source]: oldBytes,
  }, destination, source);
  await harness.executeCommand("tkr.upgradePreVectorBoard", harness.makeUri("/project/Boards/Modern.brd"));
  equal(harness.host.bytesOf(destination), undefined);
  deepEqual(harness.host.bytesOf(source), oldBytes);
  ok(harness.errors.some((message) => /owning game/.test(message)));
  harness.provider.workspaceFor({ uri: harness.root, key: "memory-project" }).workspace.dispose();
});

test("VS Code upgrade refuses a destination that would activate a missing nested game's declared root", async () => {
  const oldBytes = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor2.brd", import.meta.url)));
  const mainA = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "A" });
  const mainB = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "A/Boards/Future" });
  ok(mainA.ok, mainA.ok ? "" : mainA.error.message);
  ok(mainB.ok, mainB.ok ? "" : mainB.error.message);
  const source = "Game/A/Boards/Region/Old.brd";
  const destination = "Game/A/Boards/Future/Boards/Copy.brd";
  const harness = boardUpgradeHarness({
    "Main/A.gam": mainA.value,
    "Main/B.gam": mainB.value,
    "Boards/Modern.brd": boardExample,
    [source]: oldBytes,
  }, destination, source);
  await harness.executeCommand("tkr.upgradePreVectorBoard", harness.makeUri("/project/Boards/Modern.brd"));
  equal(harness.host.bytesOf(destination), undefined);
  deepEqual(harness.host.bytesOf(source), oldBytes);
  ok(harness.errors.some((message) => /owning game/.test(message)), harness.errors.join("; "));
  harness.provider.workspaceFor({ uri: harness.root, key: "memory-project" }).workspace.dispose();
});

test("VS Code pre-vector picker refuses distinct board paths that collide after case folding", async () => {
  const oldBytes = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor2.brd", import.meta.url)));
  const modernPath = "Boards/Modern.brd";
  const upperPath = "Boards/Old.brd";
  const lowerPath = "Boards/old.brd";
  const destination = "Boards/Old.upgraded.brd";
  const harness = boardUpgradeHarness({
    [modernPath]: boardExample,
    [upperPath]: oldBytes,
    [lowerPath]: oldBytes,
  }, destination, upperPath);
  const originalList = harness.host.fs.listProject.bind(harness.host.fs);
  Object.defineProperty(harness.host.fs, "listProject", {
    configurable: true,
    value: async (projectId: string, path: string) => {
      const result = await originalList(projectId, path);
      if (!result.ok || path.toLowerCase() !== "boards") return result;
      return {
        ok: true,
        value: [...result.value.filter(({ name }) => name !== lowerPath.split("/").at(-1)), { name: "old.brd", kind: "file" as const }],
      };
    },
  });
  await harness.executeCommand("tkr.upgradePreVectorBoard", harness.makeUri(`/project/${modernPath}`));
  equal(harness.host.bytesOf(destination), undefined);
  deepEqual(harness.host.bytesOf(upperPath), oldBytes);
  deepEqual(harness.host.bytesOf(lowerPath), oldBytes);
  ok(harness.errors.some((message) => /differ only by case/.test(message)));
  harness.provider.workspaceFor({ uri: harness.root, key: "memory-project" }).workspace.dispose();
});

test("VS Code refuses a board owned by a nested game when it lies outside that game's Boards folder", async () => {
  const oldBytes = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor2.brd", import.meta.url)));
  const mainA = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "A" });
  const mainB = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "A/Boards/Region" });
  ok(mainA.ok, mainA.ok ? "" : mainA.error.message);
  ok(mainB.ok, mainB.ok ? "" : mainB.error.message);
  const source = "Game/A/Boards/Region/Outside.brd";
  const destination = "Game/A/Boards/Region/Copy.brd";
  const harness = boardUpgradeHarness({
    "Main/A.gam": mainA.value,
    "Main/B.gam": mainB.value,
    "Boards/Modern.brd": boardExample,
    "Game/A/Boards/Region/Prg/start.prg": new Uint8Array([1]),
    [source]: oldBytes,
  }, destination, source);
  await harness.executeCommand("tkr.upgradeBoardTileToPixel", harness.makeUri(`/project/${source}`));
  equal(harness.host.bytesOf(destination), undefined);
  deepEqual(harness.host.bytesOf(source), oldBytes);
  ok(harness.errors.some((message) => /not a board inside an open project folder/.test(message)));
  harness.provider.workspaceFor({ uri: harness.root, key: "memory-project" }).workspace.dispose();
});
