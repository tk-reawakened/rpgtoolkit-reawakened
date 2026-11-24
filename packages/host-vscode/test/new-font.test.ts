// The new-font question of the VS Code host (T-65): the model makes the file, the host only asks, and the suggestion is the
// project's own Font folder from the game's main file, so a `Main/` + `Game/<project>/` game gets the right path.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createEmptyMainFile, writeMainFile } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { fontProjectLayout, runNewFont, type NewFontUi } from "../src/new-font.ts";

const text = (value: string): Uint8Array => Uint8Array.from(value, (ch) => ch.charCodeAt(0));

function ask(answer: string | undefined): { readonly ui: NewFontUi; readonly seen: { value: string; validate: (value: string) => string | null }[] } {
  const seen: { value: string; validate: (value: string) => string | null }[] = [];
  return {
    seen,
    ui: {
      input: (question) => {
        seen.push({ value: question.value, validate: question.validate });
        return Promise.resolve(answer === undefined ? undefined : answer === "" ? question.value : answer);
      },
    },
  };
}

/** A main file whose own project folder is `projectPath` ("" for a root-layout game). */
function mainFileWith(projectPath: string): Uint8Array {
  const written = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath, movementControls: 5, movementScanCodes: [0xcd, 0, 0xd0, 0, 0xcb, 0, 0xc8, 0] });
  if (!written.ok) throw new Error(written.error.message);
  return new Uint8Array(written.value);
}

test("the suggested path is the game's own Font folder, so a project game keeps its folder", async () => {
  // A game laid out as Main/ plus Game/<project>/: the main file says which folder holds its type folders.
  const host = createMemoryPlatformServices({
    files: {
      "Main/test.gam": mainFileWith("Example"),
      "Game/Example/Font/existing.fnt": text("x"),
    },
  });
  const layout = await fontProjectLayout(host.fs, "memory-project");
  equal(layout.projectFolder, "Game/Example", "the main file's own project folder");
  const { ui, seen } = ask("");
  const outcome = await runNewFont({ fs: host.fs, layout, ui });
  deepEqual(outcome, { ok: true, path: "Game/Example/Font/new-font.fnt" });
  equal(seen[0]!.value, "Game/Example/Font/new-font.fnt");
  ok(host.bytesOf("Game/Example/Font/new-font.fnt") !== undefined);
});

test("a root layout game suggests Font/, a taken name gets the next one, and a dismissed question writes nothing", async () => {
  const host = createMemoryPlatformServices({ files: { "Main/test.gam": mainFileWith(""), "Font/new-font.fnt": text("x") } });
  equal((await fontProjectLayout(host.fs, "memory-project")).projectFolder, "", "a game with no project folder keeps the root");
  const { ui, seen } = ask("");
  const outcome = await runNewFont({ fs: host.fs, layout: { projectFolder: "" }, ui });
  deepEqual(outcome, { ok: true, path: "Font/new-font 2.fnt" });
  equal(seen[0]!.value, "Font/new-font 2.fnt");
  const dismissed = ask(undefined);
  const cancelled = await runNewFont({ fs: host.fs, layout: { projectFolder: "" }, ui: dismissed.ui });
  deepEqual(cancelled, { ok: false, reason: "cancelled", message: "No font was created." });
});

test("a path outside a Font folder is refused with the reason, and the question validates the extension", async () => {
  const host = createMemoryPlatformServices();
  const { ui, seen } = ask("Prg/retro.fnt");
  const outcome = await runNewFont({ fs: host.fs, layout: { projectFolder: "" }, ui });
  ok(!outcome.ok);
  equal(outcome.reason, "refused");
  ok(/Font folder/.test(outcome.message), outcome.message);
  equal(seen[0]!.validate("Font/retro.fnt"), null);
  equal(seen[0]!.validate("Font/retro.png"), "A font's name ends in .fnt.");
});
