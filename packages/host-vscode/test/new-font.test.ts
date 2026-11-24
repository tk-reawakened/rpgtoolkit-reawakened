// The new-font question of the VS Code host (T-65): the model makes the file, the host only asks, and the suggestion is the
// active game's own Font folder, so a `Main/` + `Game/<project>/` game gets the right path — a project with several games
// asks which one instead of taking whichever the listing reached first.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createEmptyMainFile, writeMainFile } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { fontDestinationProblem } from "@tk-reawakened/editor-model";
import { fontGames, runNewFont, type NewFontUi } from "../src/new-font.ts";

const text = (value: string): Uint8Array => Uint8Array.from(value, (ch) => ch.charCodeAt(0));

function ask(answer: string | undefined): { readonly ui: NewFontUi; readonly seen: { title: string; prompt: string; value: string; validate: (value: string) => string | null }[] } {
  const seen: { title: string; prompt: string; value: string; validate: (value: string) => string | null }[] = [];
  return {
    seen,
    ui: {
      input: (question) => {
        seen.push({ title: question.title, prompt: question.prompt, value: question.value, validate: question.validate });
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

test("the suggested path is the active game's own Font folder, so a project game keeps its folder", async () => {
  // A game laid out as Main/ plus Game/<project>/: the main file says which folder holds its type folders.
  const host = createMemoryPlatformServices({
    files: {
      "Main/test.gam": mainFileWith("Example"),
      "Game/Example/Font/existing.fnt": text("x"),
    },
  });
  const games = await fontGames(host.fs, "memory-project");
  deepEqual(games.map((game) => game.main), ["Main/test.gam"]);
  equal(games[0]!.layout.projectFolder, "Game/Example", "the main file's own project folder");
  const { ui, seen } = ask("");
  const outcome = await runNewFont({ fs: host.fs, projectId: "memory-project", activeGame: "Main/test.gam", ui });
  deepEqual(outcome, { ok: true, path: "Game/Example/Font/new-font.fnt" });
  equal(seen[0]!.value, "Game/Example/Font/new-font.fnt");
  ok(host.bytesOf("Game/Example/Font/new-font.fnt") !== undefined);
});

test("two games are never guessed: the open one is used, and with none open the question names both and takes an answer", async () => {
  const host = createMemoryPlatformServices({
    files: {
      "Main/one.gam": mainFileWith("One"),
      "Main/two.gam": mainFileWith("Two"),
      "Game/One/Font/one.fnt": text("x"),
      "Game/Two/Font/two.fnt": text("x"),
    },
  });
  const games = await fontGames(host.fs, "memory-project");
  deepEqual(games.map((game) => [game.main, game.layout.projectFolder]), [["Main/one.gam", "Game/One"], ["Main/two.gam", "Game/Two"]]);
  // The host knows which game is open: no question about it.
  const open = ask("");
  deepEqual(await runNewFont({ fs: host.fs, projectId: "memory-project", activeGame: "Main/two.gam", ui: open.ui }), { ok: true, path: "Game/Two/Font/new-font.fnt" });
  equal(open.seen.length, 1, "only the path question");
  equal(open.seen[0]!.value, "Game/Two/Font/new-font.fnt");
  // None open: the game is asked, then the path.
  const asked = ask("Main/one.gam");
  const created = await runNewFont({ fs: host.fs, projectId: "memory-project", ui: { input: (question) => {
    asked.seen.push({ title: question.title, prompt: question.prompt, value: question.value, validate: question.validate });
    const answer = question.title.includes("which game") ? "Main/one.gam" : question.value;
    return Promise.resolve(answer);
  } } });
  deepEqual(created, { ok: true, path: "Game/One/Font/new-font.fnt" });
  ok(asked.seen[0]!.prompt.includes("Main/one.gam") && asked.seen[0]!.prompt.includes("Main/two.gam"), asked.seen[0]!.prompt);
  equal(asked.seen[0]!.validate("Main/three.gam"), "Type one of: Main/one.gam, Main/two.gam.");
  equal(asked.seen[0]!.validate("main/ONE.gam"), null, "a game is matched without regard to A-Z case");
});

test("the active game's path folds ASCII case without conflating Unicode filenames", async () => {
  const host = createMemoryPlatformServices({ files: {
    "Main/Élan.gam": mainFileWith("Game/Upper"),
    "Main/élan.gam": mainFileWith("Game/Lower"),
    "Game/Upper/Boards/start.brd": text(""),
    "Game/Lower/Boards/start.brd": text(""),
  } });
  for (const [main, folder] of [["MAIN/ÉLAN.GAM", "Upper"], ["MAIN/éLAN.GAM", "Lower"]] as const) {
    const picked = ask("");
    deepEqual(await runNewFont({ fs: host.fs, projectId: "memory-project", activeGame: main, ui: picked.ui }), { ok: true, path: `Game/${folder}/Font/new-font.fnt` });
    equal(picked.seen.length, 1, "the active game was found");
  }
});

test("a root layout game suggests Font/, a taken name gets the next one, and a dismissed question writes nothing", async () => {
  const host = createMemoryPlatformServices({ files: { "Main/test.gam": mainFileWith(""), "Font/new-font.fnt": text("x") } });
  const games = await fontGames(host.fs, "memory-project");
  equal(games[0]!.layout.projectFolder, "", "a game with no project folder keeps the root");
  const { ui, seen } = ask("");
  const outcome = await runNewFont({ fs: host.fs, projectId: "memory-project", activeGame: "Main/test.gam", ui });
  deepEqual(outcome, { ok: true, path: "Font/new-font 2.fnt" });
  equal(seen[0]!.value, "Font/new-font 2.fnt");
  const dismissed = ask(undefined);
  const cancelled = await runNewFont({ fs: host.fs, projectId: "memory-project", ui: dismissed.ui });
  deepEqual(cancelled, { ok: false, reason: "cancelled", message: "No font was created." });
});

test("a path outside the chosen game's folders, or outside a Font folder, is refused with the reason", async () => {
  const host = createMemoryPlatformServices({ files: { "Main/one.gam": mainFileWith("One"), "Main/two.gam": mainFileWith("Two"), "Game/One/Font/one.fnt": text("x"), "Game/Two/Font/two.fnt": text("x") } });
  const layout = (await fontGames(host.fs, "memory-project")).find((game) => game.main === "Main/one.gam")!.layout;
  equal(fontDestinationProblem("Game/Two/Font/retro.fnt", layout), "A font for this game goes in Game/One/Font.", "another game's folder is another game's");
  equal(fontDestinationProblem("Game/One/Misc/Font/retro.fnt", layout), "A font for this game goes in Game/One/Font.");
  equal(fontDestinationProblem("Game/One/Font/retro.fnt", { projectFolder: "" }), "A font for this game goes in Font.");
  equal(fontDestinationProblem("Prg/retro.fnt", layout), "A font goes in a Font folder, such as Font/retro.fnt.");
  equal(fontDestinationProblem("Game/One/Font/Heading/retro.fnt", layout), "A font goes in a Font folder, such as Font/retro.fnt.", "the model's rule is a font directly in Font/");
  const { ui, seen } = ask("Game/Two/Font/retro.fnt");
  const outcome = await runNewFont({ fs: host.fs, projectId: "memory-project", activeGame: "Main/one.gam", ui });
  ok(!outcome.ok);
  equal(outcome.reason, "refused");
  equal(seen[0]!.validate("Game/One/Font/retro.fnt"), null);
  equal(seen[0]!.validate("Game/One/Font/retro.png"), "A font's name ends in .fnt.");
});
