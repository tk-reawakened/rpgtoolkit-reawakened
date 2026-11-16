import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";
import { newAnimationBytes, type CheckpointGroup } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createGameEditorProvider, type GameDocument } from "@tk-reawakened/host-vscode/testing";

interface Uri { path: string }
const path = "Misc/native-guard.anm";
const encoded = (value: string) => new TextEncoder().encode(value);

test("animation recovery refuses native text documents while ordinary animation saves remain authoritative", async () => {
  for (const existing of [false, true]) {
    const host = createMemoryPlatformServices({ files: { [path]: newAnimationBytes(), ...(existing ? { ".gitignore": encoded("existing/\n") } : {}) } });
    const native = { path: "/project/.gitignore", dirty: true, text: "unsaved native work\n" };
    let nativeOpen = true;
    let document!: GameDocument<Uri>;
    let saves = 0;
    const folder = { uri: { path: "/project" }, key: "memory-project" };
    const port = {
      capabilities: [], folderOf: () => folder, fileSystem: () => host.fs, dialogs: () => host.dialogs,
      readBackup: async () => new Uint8Array(), writeBackup: async () => "unused", deleteBackup: async () => undefined,
      uriFor: (_folder: typeof folder, relative: string) => ({ path: `/project/${relative}` }),
      openEditor: async () => undefined, quickPick: async () => undefined,
      isTextDocumentOpen: (uri: Uri) => nativeOpen && uri.path === native.path,
      saveEditor: async (uri: Uri) => { saves++; await provider.saveCustomDocument(document); return uri; },
    };
    const provider = createGameEditorProvider(port, () => undefined);
    document = await provider.openCustomDocument({ path: `/project/${path}` }, undefined);
    // Native text is not in the provider's model workspace. Its unsaved buffer and disk must both survive.
    host.answerQuestions("replace");
    const ignored = await document.animationAction("ignore"); equal(ignored.ok, false);
    if (!ignored.ok) match(ignored.error.message, /close.*\.gitignore/i);
    deepEqual(host.bytesOf(".gitignore"), existing ? encoded("existing/\n") : undefined); equal(native.text, "unsaved native work\n"); equal(native.dirty, true);
    nativeOpen = false;
    host.answerQuestions("replace"); ok((await document.animationAction("ignore")).ok);
    const listed = await document.animationAction("list"); ok(listed.ok && Array.isArray(listed.value));
    const group = (listed.value as CheckpointGroup[]).find((entry) => entry.files.some((file) => file.path === ".gitignore")); ok(group);
    const changed = host.bytesOf(".gitignore");
    nativeOpen = true;
    const restore = await document.animationAction("restore", group.id); equal(restore.ok, false);
    deepEqual(host.bytesOf(".gitignore"), changed); equal(native.text, "unsaved native work\n");
    // An unrelated native buffer must not block the owning animation's normal command/save lifecycle.
    host.answerQuestions("replace");
    const written = await document.animationAction("commit", undefined, { type: "set-animation-delay", delay: .5 }, []);
    ok(written.ok && written.value !== undefined && !Array.isArray(written.value));
    equal((written.value as CheckpointGroup).files[0]!.status, "written"); equal(saves, 1); equal(document.model.getSnapshot().dirty, false);
    document.dispose();
  }
});
