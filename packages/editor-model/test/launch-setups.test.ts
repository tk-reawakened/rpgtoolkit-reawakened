import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { deleteLaunchSetup, LAUNCH_SETUPS_PATH, launchOfSetup, readLaunchSetups, saveLaunchSetup } from "../src/index.ts";

// docs/adr/0022-shared-editor-authoring-contracts.md D8.7

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const fsWith = (file?: unknown) => createMemoryPlatformServices({ files: file === undefined ? {} : { [LAUNCH_SETUPS_PATH]: encode(file) } }).fs;
const readText = async (fs: ReturnType<typeof fsWith>): Promise<string> => {
  const read = await fs.read(LAUNCH_SETUPS_PATH);
  ok(read.ok);
  return new TextDecoder().decode(read.value);
};
const OPEN = { main: "Main/example.gam", projectFolder: "Game/Example" };

test("a missing file has no setups, and the first save creates it in the D8.7 layout", async () => {
  const fs = fsWith();
  deepEqual(await readLaunchSetups(fs), { ok: true, entries: [] });
  deepEqual(await saveLaunchSetup(fs, { name: "Village", kind: "board", start: { board: "Boards/village.brd", x: 2, y: 3, layer: 1 }, party: ["ada.tem"], seed: 23 }), { ok: true });
  equal(await readText(fs), `${JSON.stringify({ version: 1, configurations: [{ name: "Village", kind: "board", seed: 23, start: { board: "Boards/village.brd", x: 2, y: 3, layer: 1 }, party: ["ada.tem"] }] }, null, 2)}\n`);
});

test("entries are read in file order; a bad or duplicate entry is unavailable with its reason and the rest still work", async () => {
  const fs = fsWith({
    version: 1,
    configurations: [
      { name: "Game", kind: "game" },
      { name: "Broken", kind: "board", start: { board: "Boards/a.brd", x: 1, y: 1, layer: 0 }, party: [] },
      { name: "Game", kind: "game", seed: 4 },
      { name: "Fixture", kind: "program", program: "Prg/a.prg", fixture: { party: ["ada.tem"], fontSize: 12 } },
    ],
  });
  const read = await readLaunchSetups(fs);
  ok(read.ok);
  deepEqual(read.entries.map((entry) => [entry.name, entry.problem]), [
    ["Game", null],
    ["Broken", "start.layer must be a whole number from 1."],
    ["Game", 'Another setup is already named "Game".'],
    ["Fixture", null],
  ]);
});

test("a file that is not JSON or has another version is reported and never overwritten", async () => {
  for (const [file, reason] of [["{ nope", "is not valid JSON"], [{ version: 2, configurations: [] }, "has version 2"]] as const) {
    const fs = fsWith(file);
    const before = await readText(fs);
    const read = await readLaunchSetups(fs);
    ok(!read.ok && read.problem.includes(reason), reason);
    const saved = await saveLaunchSetup(fs, { name: "Game", kind: "game" });
    ok(!saved.ok && saved.message.endsWith("It was not changed."));
    equal(await readText(fs), before, "the unreadable file is left as it was");
  }
});

test("changing a setup keeps its place and the fields the editor does not know; renaming onto another name is refused", async () => {
  const fs = fsWith({
    version: 1,
    host: { vscode: true },
    configurations: [
      { name: "A", kind: "game" },
      { name: "B", kind: "program", program: "Prg/a.prg", fixture: { party: [], font: "Old", note: "kept" }, colour: "red" },
      { name: "C", kind: "game" },
    ],
  });
  deepEqual(await saveLaunchSetup(fs, { name: "B2", kind: "program", program: "Prg/b.prg", fixture: { party: ["ada.tem"] } }, "B"), { ok: true });
  const file = JSON.parse(await readText(fs)) as { host: unknown; configurations: unknown[] };
  deepEqual(file.host, { vscode: true });
  deepEqual(file.configurations, [
    { name: "A", kind: "game" },
    { name: "B2", kind: "program", program: "Prg/b.prg", fixture: { party: ["ada.tem"], note: "kept" }, colour: "red" },
    { name: "C", kind: "game" },
  ]);
  const clash = await saveLaunchSetup(fs, { name: "A", kind: "game" }, "C");
  deepEqual(clash, { ok: false, message: 'Another setup is already named "A".' });
  deepEqual(await deleteLaunchSetup(fs, "A"), { ok: true });
  const after = await readLaunchSetups(fs);
  ok(after.ok);
  deepEqual(after.entries.map((entry) => entry.name), ["B2", "C"]);
});

test("a setup becomes a launch with the open game's main file and folder, seed 0 and the name as fixture id", () => {
  deepEqual(launchOfSetup({ name: "Game", kind: "game" }, OPEN), { ...OPEN, seed: 0, kind: "game" });
  deepEqual(
    launchOfSetup({ name: "Shop", kind: "program", main: "Main/other.gam", program: "Prg/shop.prg", fixture: { party: ["ada.tem"] } }, OPEN),
    { main: "Main/other.gam", projectFolder: "Game/Example", seed: 0, kind: "program", program: "Prg/shop.prg", fixture: { id: "Shop", party: ["ada.tem"] } },
  );
});
