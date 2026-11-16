// A retention change made in the running browser Preferences panel reaches the project's history policy without reopening
// the project (ADR 0022 D6.3, D12.8; #2839). It goes through the real project constructors and the real settings model.
import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { HISTORY_SETTING_IDS } from "@tk-reawakened/editor-model";
import { createFolderProject, programPreferencesModelFor } from "@tk-reawakened/host-web";
import { MemoryDirectory, type WriteControl } from "../conformance/memory-directory.ts";

function userStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => { items.clear(); },
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => { items.delete(key); },
    setItem: (key, value) => { items.set(key, value); },
  } as Storage;
}

test("changing retention in the Preferences panel changes this project's history policy at once", async () => {
  const control: WriteControl = { refuse: false, refuseNames: undefined, hold: null, tick: 0 };
  const root = new MemoryDirectory("project", control);
  root.put("Main/example.gam", new Uint8Array([1]));
  const dialogs = { ask: async () => "ok", pickSavePath: async () => null } as unknown as Parameters<typeof createFolderProject>[2] extends { dialogs?: infer D } ? D : never;
  const project = createFolderProject(root as unknown as FileSystemDirectoryHandle, { id: "web:retention", name: "Retention" }, { dialogs, userSettings: userStorage() });
  const big = new Uint8Array(2 * 1024 * 1024);
  equal(project.workspace.history.coverage("Boards/x.brd", big.length).covered, true, "an 8 MiB cap covers a 2 MiB board by default");
  const preferences = programPreferencesModelFor(project);
  await preferences.refresh();
  const written = await preferences.set(HISTORY_SETTING_IDS.maxFileMiB, "user", 1);
  ok(written.ok);
  const after = project.workspace.history.coverage("Boards/x.brd", big.length);
  equal(after.covered, false, "the new 1 MiB cap applies in the same session");
  equal(after.covered ? "" : after.reason, "size");
  equal(project.sessionCopy, false);
  project.deactivate();
});
