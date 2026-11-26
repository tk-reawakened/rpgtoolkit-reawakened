// Hot-exit backups of a battle form whose typing is an edit (ADR 0022 D16.4, #3385). VS Code schedules a custom document's
// backup from its edit events, and a continued typing gesture fires none, so the provider rewrites the backup VS Code last
// took. These cases drive the real provider and the real webview request handler through an in-memory port.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { DialogService } from "@tk-reawakened/platform-services";
import {
  createGameEditorProvider,
  createVscodeFileSystemWithPort,
  handleEditorHostRequest,
  vscodeCapabilities,
  type GameDocument,
  type GameEditEvent,
  type VscodeFileSystemPort,
  type WorkspaceFolderLike,
} from "@tk-reawakened/host-vscode/testing";

interface Uri { readonly path: string }

const SPC = "SpcMove/fireball.spc";
const FP = 0x1e;
const fireball = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Game/Example/SpcMove/fireball.spc", import.meta.url)));
const FOLDER: WorkspaceFolderLike<Uri> = { uri: { path: "/game" }, key: "file:///game" };

function host() {
  const files = new Map<string, Uint8Array>([[`/game/${SPC}`, fireball.slice()]]);
  const backups = new Map<string, Uint8Array>();
  const missing = (uri: Uri) => Object.assign(new Error(`${uri.path} was not found`), { code: "FileNotFound" });
  const port: VscodeFileSystemPort<Uri> = {
    isSymbolicLink: (type) => (type & 64) !== 0,
    isDirectory: (type) => (type & 2) !== 0,
    joinPath: (base, ...parts) => ({ path: `${base.path}/${parts.join("/")}` }),
    parent: (uri) => ({ path: uri.path.slice(0, uri.path.lastIndexOf("/")) }),
    async readDirectory(uri) {
      const prefix = `${uri.path}/`;
      const entries = new Map<string, number>();
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        entries.set(slash === -1 ? rest : rest.slice(0, slash), slash === -1 ? 1 : 2);
      }
      if (entries.size === 0) throw missing(uri);
      return [...entries];
    },
    async readFile(uri) {
      const bytes = files.get(uri.path);
      if (bytes === undefined) throw missing(uri);
      return bytes.slice();
    },
    async createDirectory() {},
    async writeFile(uri, bytes) { files.set(uri.path, bytes.slice()); },
    async stat(uri) {
      const bytes = files.get(uri.path);
      if (bytes !== undefined) return { type: 1, size: bytes.length, mtime: 0 };
      if ([...files.keys()].some((path) => path.startsWith(`${uri.path}/`))) return { type: 2, size: 0, mtime: 0 };
      throw missing(uri);
    },
    async delete() { throw new Error("not used"); },
    async rename() { throw new Error("not used"); },
    async watch() { return { dispose() {} }; },
    errorCode: (error) => (typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined),
  };
  const never: DialogService = {
    ask: () => Promise.reject(new Error("not used")),
    pickSavePath: () => Promise.reject(new Error("not used")),
  };
  const edits: GameEditEvent<Uri>[] = [];
  const provider = createGameEditorProvider<Uri>({
    capabilities: vscodeCapabilities(false),
    folderOf: (uri) => (uri.path.startsWith("/game/") ? FOLDER : undefined),
    fileSystem: (folder) => createVscodeFileSystemWithPort(folder.uri, port, folder.key),
    dialogs: () => never,
    readBackup: async (id) => {
      const bytes = backups.get(id);
      if (bytes === undefined) throw new Error(`no backup ${id}`);
      return bytes.slice();
    },
    writeBackup: async (destination, bytes) => { backups.set(destination.path, bytes.slice()); return destination.path; },
    deleteBackup: async (destination) => { backups.delete(destination.path); },
    uriFor: () => { throw new Error("not used"); },
    openEditor: () => Promise.reject(new Error("not used")),
    quickPick: () => Promise.reject(new Error("not used")),
    saveEditor: () => Promise.reject(new Error("not used")),
  }, (event) => { edits.push(event); });
  /** Send a keystroke as the webview does: an `edit` request continuing the field's gesture. */
  const type = async (document: GameDocument<Uri>, command: unknown, coalesce: string): Promise<void> => {
    await handleEditorHostRequest(document, { type: "edit", command, requestId: `r-${Math.random()}`, coalesce } as never, async () => undefined);
  };
  return { files, backups, edits, provider, type };
}

const damageIn = (bytes: Uint8Array): number => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(FP, true);
const damage = (value: number) => ({ type: "set-special-move-amount", field: "damage", value });

test("a continued typing gesture rewrites the last backup, so hot exit restores the latest keystroke", async () => {
  const { backups, edits, provider, type } = host();
  const document = await provider.openCustomDocument({ path: `/game/${SPC}` }, undefined);
  await type(document, damage(-3), "damage#0");
  equal(edits.length, 1, "the first keystroke is the one edit VS Code holds");
  await provider.backupCustomDocument(document, { path: "/backup/1" });
  equal(damageIn(backups.get("/backup/1")!), -3);
  await type(document, damage(-30), "damage#0");
  equal(edits.length, 1, "the continued gesture adds no edit event, so VS Code schedules no backup of its own");
  await document.backupsSettled();
  equal(damageIn(backups.get("/backup/1")!), -30, "the provider refreshed the backup itself");

  document.dispose();
  const restored = await provider.openCustomDocument({ path: `/game/${SPC}` }, "/backup/1");
  equal((restored.model.getSnapshot() as unknown as { damage: number }).damage, -30, "hot exit restores the latest keystroke");
  equal(restored.model.getSnapshot().dirty, true);
});

test("text a field holds survives hot exit, and a backup without held text is the file's bytes exactly", async () => {
  const { backups, provider, type } = host();
  const document = await provider.openCustomDocument({ path: `/game/${SPC}` }, undefined);
  await type(document, damage(-3), "damage#0");
  await provider.backupCustomDocument(document, { path: "/backup/plain" });
  deepEqual(backups.get("/backup/plain"), document.model.serialize(), "no envelope unless text is held");
  await type(document, { type: "hold-field-text", field: "damage", text: "-3.", message: "enter a whole number" }, "damage#0");
  await document.backupsSettled();
  document.dispose();
  const restored = await provider.openCustomDocument({ path: `/game/${SPC}` }, "/backup/plain");
  const snapshot = restored.model.getSnapshot() as unknown as { damage: number; heldText: Record<string, { text: string; message: string }> };
  equal(snapshot.damage, -3, "the value typed before the held text");
  deepEqual(snapshot.heldText.damage, { text: "-3.", message: "enter a whole number" }, "and the held text, with its reason");
  const saved = await restored.model.save();
  ok(!saved.ok, "the recovered document still refuses to save the held text");
});

test("a backup VS Code deleted is never written again by a later keystroke", async () => {
  const { backups, provider, type } = host();
  const document = await provider.openCustomDocument({ path: `/game/${SPC}` }, undefined);
  await type(document, damage(-3), "damage#0");
  const backup = await provider.backupCustomDocument(document, { path: "/backup/gone" });
  await type(document, damage(-30), "damage#0");
  await backup.delete();
  await type(document, damage(-300), "damage#0");
  await document.backupsSettled();
  equal(backups.has("/backup/gone"), false);
});
