# The gap between a save's check and its write

Evidence for [#2207](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2207) and [#2238](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2238). The recommendation is in [proposed ADR 0030](../../adr/0030-save-check-and-write-are-two-steps.md). Base `origin/main` `3e5a9937`, 2026-11-12, macOS arm64, Node v26.13.0.

## What was reproduced

`MainDocument.save()` reads the file and compares it with the bytes the document last read or wrote (`packages/editor-model/src/main-document.ts:468`). Only after that does it ask the host to write (`main-document.ts:492`). These are two host calls, and nothing ties the second to the first. The reproduction runs the real `editor-model` code against the platform-services memory double. A storage wrapper performs another program's write once, at an exact point: after the save's pre-write read resolves and before the save's host write starts. No timer or sleep is used, so every run gives the same result.

| Case | Result |
|---|---|
| Save, document opened over "Example Game", local title "Local Title", another program writes "External Title" in the gap | The save reports `ok`, the file holds "Local Title", `conflict` is `null` and `dirty` is `false`. A later `checkExternal()` answers `unchanged`. "External Title" is gone and nothing reported it. |
| The same, through `createDocumentWorkspace` on a host that declares `fileWatch` (the memory double emits a `changed` event for the other program's write) | The check that the watcher's event queues runs behind the save. It finds the document's own bytes, answers `unchanged` and raises no conflict. Watching does not reveal the lost change. |
| Save As to `Main/copy.gam`, which did not exist at the collision check; another program creates it immediately before the write | Save As reports `ok`, asks no question, and the file holds the copied document ("Example Game"). The other program's new file is gone ([#2238](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2238)). |

Output of the throwaway test below (summary lines of `node --test` omitted):

```text
read#1 -> Example Game
read#2 -> Example Game
external write -> External Title
host write -> Local Title
{"saved":{"ok":true},"onDisk":"Local Title","conflict":null,"dirty":false}
{"saved":{"ok":true},"onDisk":"Local Title","conflictsSeen":[],"dirty":false}
{"ok":true,"questions":0,"onDisk":"Example Game"}
✔ #2207 save: an external write between the pre-write compare and the host write is overwritten silently (7.556542ms)
✔ #2207 fileWatch host: the watcher's event for the external write arrives, and the check behind the save sees only our bytes (5.639292ms)
✔ Save As: a destination another program creates after the collision check is overwritten without a question (1.534041ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

To reproduce, run `pnpm build`, put the source below at `packages/editor-model/test/repro-2207.test.ts`, and run `node --test packages/editor-model/test/repro-2207.test.ts`. The test asserts today's behaviour, so it passes while the defect exists. It is evidence and is not committed as a test. The test that ships with a fix asserts the outcome the owner rules on.

**Control.** Moving the other program's write one step earlier, to just *before* the save's pre-write read, makes today's check catch it. The save fails with `kind: "conflict"`, writes nothing, keeps "External Title" on disk, and leaves the document dirty with the conflict waiting. The first test's assertions then fail. This shows that the harness injects the write where it claims to, and that the gap is exactly between the comparison and the host write.

```ts
import { test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, createDocumentWorkspace, openMainDocument, type DocumentStorage } from "../src/index.ts";
import { exampleMain, titleOf, withTitle } from "./fixtures.ts";

const PATH = "Main/example.gam";
const identity = createDocumentIdentity("memory-project", PATH);

function racingStorage(host: MemoryPlatformServices, external: Uint8Array) {
  const log: string[] = [];
  let reads = 0;
  let injected = false;
  const storage: DocumentStorage = {
    async readProject(projectId, path) {
      reads += 1;
      const read = await host.fs.readProject(projectId, path);
      log.push(`read#${reads} -> ${read.ok ? titleOf(read.value) : read.error.code}`);
      // Read 1 opens the document; read 2 is the save's pre-write comparison. The other program writes right after it.
      if (reads === 2 && !injected) {
        injected = true;
        await host.fs.write(path, external);
        log.push(`external write -> ${titleOf(external)}`);
      }
      return read;
    },
    async writeProject(projectId, path, bytes) {
      log.push(`host write -> ${titleOf(bytes)}`);
      return host.fs.writeProject(projectId, path, bytes);
    },
  };
  return { storage, log };
}

test("#2207 save: an external write between the pre-write compare and the host write is overwritten silently", async () => {
  const original = exampleMain(9);
  const external = withTitle(original, "External Title");
  const host = createMemoryPlatformServices({ files: { [PATH]: original } });
  const { storage, log } = racingStorage(host, external);
  const opened = await openMainDocument(storage, identity);
  if (!opened.ok) throw new Error("open failed");
  const doc = opened.document;
  doc.apply({ type: "set-game-title", title: "Local Title" });
  const saved = await doc.save();
  console.log(log.join("\n"));
  console.log(JSON.stringify({ saved, onDisk: titleOf(host.bytesOf(PATH)!), conflict: doc.getSnapshot().conflict, dirty: doc.getSnapshot().dirty }));
  equal(saved.ok, true);
  equal(titleOf(host.bytesOf(PATH)!), "Local Title");
  equal(doc.getSnapshot().conflict, null);
  equal(doc.getSnapshot().dirty, false);
  equal(await doc.checkExternal(), "unchanged");
});

test("#2207 fileWatch host: the watcher's event for the external write arrives, and the check behind the save sees only our bytes", async () => {
  const original = exampleMain(9);
  const external = withTitle(original, "External Title");
  const host = createMemoryPlatformServices({ files: { [PATH]: original } }); // declares fileWatch
  let reads = 0;
  const checks: string[] = [];
  const fs = {
    ...host.fs,
    async readProject(projectId: string, path: string) {
      reads += 1;
      const read = await host.fs.readProject(projectId, path);
      if (reads === 2) await host.fs.write(path, external); // emits a "changed" watch event, like a real watcher
      return read;
    },
  };
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: { fs, dialogs: host.dialogs, capabilities: host.capabilities } });
  const opened = await workspace.open(PATH);
  if (!opened.ok) throw new Error("open failed");
  const doc = opened.document;
  const unsubscribe = doc.subscribe(() => { const c = doc.getSnapshot().conflict; if (c) checks.push(c.kind); });
  doc.apply({ type: "set-game-title", title: "Local Title" });
  const saved = await doc.save();
  equal(await doc.checkExternal(), "unchanged");
  unsubscribe();
  console.log(JSON.stringify({ saved, onDisk: titleOf(host.bytesOf(PATH)!), conflictsSeen: checks, dirty: doc.getSnapshot().dirty }));
  equal(saved.ok, true);
  deepEqual(checks, []);
  equal(titleOf(host.bytesOf(PATH)!), "Local Title");
  workspace.dispose();
});

test("Save As: a destination another program creates after the collision check is overwritten without a question", async () => {
  const original = exampleMain(9);
  const theirs = withTitle(original, "Their New File");
  const host = createMemoryPlatformServices({ files: { [PATH]: original } });
  host.answerSavePaths("Main/copy.gam");
  let wrote = false;
  const fs = {
    ...host.fs,
    async writeProject(projectId: string, path: string, bytes: Uint8Array) {
      if (path === "Main/copy.gam" && !wrote) { wrote = true; host.seed("Main/copy.gam", theirs); }
      return host.fs.writeProject(projectId, path, bytes);
    },
  };
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: { fs, dialogs: host.dialogs, capabilities: host.capabilities } });
  const opened = await workspace.open(PATH);
  if (!opened.ok) throw new Error("open failed");
  const outcome = await workspace.saveAs(opened.document);
  console.log(JSON.stringify({ ok: outcome.ok, questions: host.questions.length, onDisk: titleOf(host.bytesOf("Main/copy.gam")!) }));
  equal(outcome.ok, true);
  equal(host.questions.length, 0);
  equal(titleOf(host.bytesOf("Main/copy.gam")!), "Example Game");
  workspace.dispose();
});
```

## What each host can write

The editor could close the gap only with a host write that changes the file *only if* it still holds the bytes the editor checked: a compare-and-write, done in one step. No current host offers one.

| Host | How it writes | Compare-and-write? | Source |
|---|---|---|---|
| Browser folder project (`host-web`, File System Access) | `getFileHandle(…, { create: true })`, `createWritable({ keepExistingData: false })`, `write`, `close` (`packages/host-web/src/filesystem.ts:47`) | **No.** The standard's only writable option is `keepExistingData`: `dictionary FileSystemCreateWritableOptions { boolean keepExistingData = false; }`. Its `"exclusive"` and `"shared"` locks belong to the user agent's own file entries. Another program on the machine does not take them (inference: the standard defines them only for the user agent's handles). The host's `rename` and `watch` answer `unavailable`. | [File System Standard](https://fs.spec.whatwg.org/), Living Standard, last updated 19 October 2026, §2.3 |
| VS Code, desktop and web (`host-vscode`) | `vscode.workspace.fs.writeFile(uri, bytes)` (`packages/host-vscode/src/filesystem.ts:11`) | **No.** The API takes no options: `writeFile(uri: Uri, content: Uint8Array): Thenable<void>` ("replacing its entire contents"). The extension host passes `{ create: true, overwrite: true }` to the provider, or calls `$writeFile`. That reaches `fileService.writeFile(uri, content)` with no `mtime` or `etag`. VS Code's own "dirty write prevention" for its text editors compares mtime and size, then writes in a separate step. It is not exposed to extensions, and it is also two steps. On the desktop's disk provider, `rename(…, { overwrite: false })` and the provider's create-only write also check the target first and then act. | `@types/vscode` 1.90.0 `index.d.ts:9087-9092`. VS Code `main` at [`0eddad13`](https://github.com/microsoft/vscode/tree/0eddad13a4dc3e0c8b708de57f84ef200898bfe5): `src/vs/workbench/api/common/extHostFileSystemConsumer.ts:106-115`, `src/vs/workbench/api/browser/mainThreadFileSystem.ts:113-115`, `src/vs/platform/files/common/fileService.ts:502-536`, `src/vs/platform/files/node/diskFileSystemProvider.ts:333-349` and `:792-850` |
| Browser session copy (`createSessionCopy`) | Memory only | Not needed. No other program can write a page's memory, so the gap cannot occur. | `packages/host-web/src/index.ts:107` |
| Desktop host (Electron, ADR 0013), not built | Node `fs` | Node has an exclusive *create* (`wx`: "fails if the path exists"), which could close the Save As gap for a new destination. It has no compare-and-replace for an existing file. Not counted: the host does not exist. | [Node.js file system flags](https://nodejs.org/api/fs.html#file-system-flags) |

## What this rules out

- **A compare-and-write capability** would be declared by no host today. A host that implemented it as "check, then write" would be making a false promise.
- **A metadata check** (stat the file and compare its time or size before writing, as VS Code does for its own text files) is made at the same moment the editor already compares the bytes. It does not shorten the gap. Time and size can also miss a same-size change.
- **Writing aside and swapping** (rename the file away, compare what was moved, create the new file only if the path is still free, delete the moved copy) would need a rename that never replaces and a create-only write, both bound to the project. The browser host has no rename. VS Code's desktop disk provider checks before it renames, even with `overwrite: false`. In the middle of every save the file would also be missing from its path, so a crash at that moment would leave only the moved copy.
- **Watcher events** cannot tell the editor's own write from another program's. In the reproduction the event arrives and the check behind the save sees only the editor's bytes.
- **Refusing to save** wherever the gap cannot be closed would mean no host could save.
