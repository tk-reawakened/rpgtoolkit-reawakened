// Story 11.4 in VS Code, desktop and browser builds: the real custom editor provider and webview bridge, with VS Code's
// own parts (Explorer's open, the pick list, the modal questions, the Game view's file list) played by the fake
// workbench. One project is navigated from Explorer and from Game into one custom document, a linked visit returns to its
// origin, and an outside asset is copied into its reserved folder. VS Code owns tabs, panels and the file tree, so none of
// them is rebuilt here.
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { listGame } from "@tk-reawakened/editor-model";
import { isEditorHostRequest } from "@tk-reawakened/host-vscode/testing";
import type { NavigationHost } from "../conformance/vscode-host.ts";
import type { Act } from "../conformance/view.ts";

const gam = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const board = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor4.brd", import.meta.url)));
const FILES = {
  "Boards/village.brd": board,
  "Boards/caves/mine.brd": board,
  "Misc/readme.txt": new Uint8Array([2]),
  "Bitmap/old.png": new Uint8Array([4]),
};

let act: Act;
let make: (desktop: boolean) => NavigationHost;

before(async () => {
  GlobalRegistrator.register();
  const { act: preactAct } = await import("preact/test-utils");
  let queue: Promise<void> = Promise.resolve();
  act = (callback) => {
    const run = queue.then(() => preactAct(callback));
    queue = run.catch(() => undefined);
    return run;
  };
  const { createVscodeNavigationHost } = await import("../conformance/vscode-host.ts");
  make = (desktop) => createVscodeNavigationHost(desktop, gam, FILES, act);
});

after(() => GlobalRegistrator.unregister());

for (const [name, desktop] of [["VS Code desktop", true], ["VS Code for the Web", false]] as const) {
  describe(`navigation: ${name}`, () => {
    test("a document opened from Explorer and from the Game view is one custom document", async () => {
      const host = make(desktop);
      const viaExplorer = await host.open("Boards/village.brd");
      equal(host.modelsOpen(), 1);
      const game = await listGame(host.fileSystem(), { projectFolder: "" });
      deepEqual(game.groups.map((group) => group.label), ["Boards", "Animations", "Pictures"]);
      const village = game.groups[0]!.files.find((file) => file.path === "Boards/village.brd");
      ok(village?.openable);
      equal(game.groups[1]!.files[0]?.openable, false, "the readme has no editor: the Game view says so and does nothing");
      // The Game view's file runs `vscode.open`: the workbench asks the provider for the same URI's document.
      const viaGame = await host.open(village.path);
      equal(viaGame.path, viaExplorer.path);
      equal(host.modelsOpen(), 1, "two routes, one model");
      deepEqual(host.openPaths(), ["Boards/village.brd"]);
    });

    test("a linked visit opens the target, returns to the origin, and says so when the origin had to be opened again", async () => {
      const host = make(desktop);
      const origin = await host.open("Boards/village.brd");
      const visited = await origin.remote().visit("boards/CAVES/mine.brd");
      deepEqual(visited, { ok: true, path: "Boards/caves/mine.brd" }, "the link is matched without regard to A-Z case and the stored spelling is used");
      await host.settle();
      deepEqual(host.openPaths(), ["Boards/village.brd", "Boards/caves/mine.brd"]);
      deepEqual(host.script.opened, ["Boards/caves/mine.brd"], "the provider asked the workbench to open the target, never opened a model itself");

      const back = await origin.remote().returnFromVisit();
      deepEqual(back, { ok: true, path: "Boards/village.brd", message: null });
      deepEqual(host.script.opened.at(-1), "Boards/village.brd");

      await origin.remote().visit("Boards/caves/mine.brd");
      await origin.close();
      await host.settle();
      deepEqual(host.openPaths(), ["Boards/caves/mine.brd"], "the origin was closed during the visit");
      const target = await host.open("Boards/caves/mine.brd");
      const reopened = await target.remote().returnFromVisit();
      ok(reopened.ok);
      match(reopened.message ?? "", /opened again from its file/);
      deepEqual([...host.openPaths()].sort(), ["Boards/caves/mine.brd", "Boards/village.brd"]);
      const none = await target.remote().returnFromVisit();
      deepEqual(none, { ok: false, message: "There is no visit to return from." });
    });

    test("a visit to a missing file, or to a file with no editor, is refused and records nothing", async () => {
      const host = make(desktop);
      const origin = await host.open("Boards/village.brd");
      const missing = await origin.remote().visit("Boards/nowhere.brd");
      ok(!missing.ok);
      match(missing.message, /is not in the project/);
      const noEditor = await origin.remote().visit("Misc/readme.txt");
      ok(!noEditor.ok);
      match(noEditor.message, /not a file type the editor opens/);
      deepEqual(host.script.opened, [], "nothing was opened");
      deepEqual(await origin.remote().returnFromVisit(), { ok: false, message: "There is no visit to return from." }, "and no visit was recorded");
    });

    test("an outside asset is copied into its reserved folder only after the user agrees; dismissing the list changes nothing", async () => {
      const host = make(desktop);
      const tab = await host.open("Boards/village.brd");
      ok(host.capabilities.has("pickFile"));

      host.script.picks.push(undefined);
      deepEqual(await tab.remote().pickAsset({ kind: "bitmaps", extensions: [".png"], field: "the hero's picture" }), { chosen: false });
      deepEqual(host.script.pickLists[0]?.labels, ["old.png", "Choose a file from outside the project…"], "the list is the folder's files, then the way in from outside");

      host.script.picks.push("outside");
      host.script.files.push({ name: "hero.png", bytes: new Uint8Array([7, 7]) });
      host.script.answers.push("cancel");
      host.script.picks.push(undefined);
      deepEqual(await tab.remote().pickAsset({ kind: "bitmaps", extensions: [".png"], field: "the hero's picture" }), { chosen: false });
      equal(await host.disk("Bitmap/hero.png"), null, "cancelling the copy writes nothing");

      host.script.picks.push("outside");
      host.script.files.push({ name: "hero.png", bytes: new Uint8Array([7, 7]) });
      host.script.answers.push("copy");
      deepEqual(await tab.remote().pickAsset({ kind: "bitmaps", extensions: [".png"], field: "the hero's picture" }), { chosen: true, reference: "hero.png" });
      deepEqual(await host.disk("Bitmap/hero.png"), new Uint8Array([7, 7]));
      match(host.script.asked.at(-1) ?? "", /Copy hero\.png into Bitmap/);

      host.script.picks.push("file:old.png");
      host.script.answers.push("use");
      deepEqual(await tab.remote().pickAsset({ kind: "bitmaps", extensions: [".png"], field: "the hero's picture" }), { chosen: true, reference: "old.png" });
      deepEqual(await host.disk("Bitmap/old.png"), new Uint8Array([4]), "choosing a file already in the folder writes nothing");
    });

    test("a webview cannot ask for an asset kind, a path or a shape the host did not offer", () => {
      const good = { type: "pick-asset", requestId: "r", request: { kind: "bitmaps", extensions: [".png"], field: "a picture" } };
      ok(isEditorHostRequest(good));
      for (const request of [
        { kind: "../etc", extensions: [], field: "x" },
        { kind: "constructor", extensions: [], field: "x" },
        { kind: "bitmaps", extensions: "png", field: "x" },
        { kind: "bitmaps", extensions: [1], field: "x" },
        { kind: "bitmaps", extensions: [], field: "" },
        null,
      ]) {
        equal(isEditorHostRequest({ ...good, request }), false, JSON.stringify(request));
      }
      equal(isEditorHostRequest({ type: "visit", requestId: "r", path: "" }), false);
      equal(isEditorHostRequest({ type: "visit", requestId: "r" }), false);
      ok(isEditorHostRequest({ type: "visit", requestId: "r", path: "Boards/a.brd" }));
      ok(isEditorHostRequest({ type: "return-visit", requestId: "r" }));
    });
  });
}
