import assert from "node:assert/strict";
import test from "node:test";
import { configurationOfSetup, launchConfiguration, mergeAnswers, resolveLaunch, setupConfigurations, toWorkspacePath, type LaunchPrompts } from "../src/run-configuration.ts";

const ROOTS = ["file:///work/quest", "/work/quest"];

/** Prompts that answer from a script and record what they were asked, in order. */
function scripted(answers: Partial<Record<keyof LaunchPrompts, unknown[]>>): { prompts: LaunchPrompts; asked: string[] } {
  const asked: string[] = [];
  const queue = Object.fromEntries(Object.entries(answers).map(([key, values]) => [key, [...values]]));
  const ask = (name: keyof LaunchPrompts) => async (...args: unknown[]) => {
    asked.push(args.length === 0 ? name : `${name}(${args.join(",")})`);
    const values = queue[name];
    if (values === undefined || values.length === 0) throw new Error(`unexpected prompt ${name}`);
    return values.shift();
  };
  const names: Array<keyof LaunchPrompts> = ["kind", "main", "projectFolder", "program", "board", "coordinate", "party", "font", "fontSize", "windowGraphic"];
  return { prompts: Object.fromEntries(names.map((name) => [name, ask(name)])) as unknown as LaunchPrompts, asked };
}

test("a complete game configuration maps onto a game launch without asking", async () => {
  const { prompts, asked } = scripted({});
  const resolved = await resolveLaunch({ kind: "game", main: "/work/quest/Main/quest.gam", projectFolder: "Game/Quest", seed: 9 }, ROOTS, prompts);
  assert.deepEqual(resolved, { ok: true, launch: { kind: "game", main: "Main/quest.gam", projectFolder: "Game/Quest", seed: 9 } });
  assert.deepEqual(asked, []);
});

test("an empty configuration asks for the launch and every value, in the palette's order", async () => {
  const { prompts, asked } = scripted({
    kind: ["program"], main: ["Main/quest.gam"], projectFolder: ["Game/Quest"], program: ["Game/Quest/Prg/start.prg"],
    board: ["Game/Quest/Boards/village.brd"], coordinate: [2, 3, 1], party: [[]], font: [""], fontSize: [null], windowGraphic: [null],
  });
  const resolved = await resolveLaunch({}, ROOTS, prompts);
  assert.deepEqual(resolved, {
    ok: true,
    launch: {
      kind: "program", main: "Main/quest.gam", projectFolder: "Game/Quest", program: "Game/Quest/Prg/start.prg",
      fixture: { id: "Game/Quest/Prg/start.prg", party: [], start: { board: "Game/Quest/Boards/village.brd", x: 2, y: 3, layer: 1 } },
    },
  });
  assert.deepEqual(asked, ["kind", "main", "projectFolder", "program(Game/Quest)", "board(Game/Quest,fixture)",
    "coordinate(x)", "coordinate(y)", "coordinate(layer)", "party(Game/Quest,false)", "font", "fontSize", "windowGraphic(Game/Quest)"]);
});

test("a board test asks only for what is missing and requires a party", async () => {
  const { prompts, asked } = scripted({ coordinate: [1], party: [["Game/Quest/Chrs/ada.tem"]] });
  const resolved = await resolveLaunch({
    kind: "board", main: "Main/quest.gam", projectFolder: "Game/Quest", start: { board: "Game/Quest/Boards/village.brd", x: 4, y: 5 },
  }, ROOTS, prompts);
  assert.deepEqual(resolved, {
    ok: true,
    launch: { kind: "board", main: "Main/quest.gam", projectFolder: "Game/Quest", start: { board: "Game/Quest/Boards/village.brd", x: 4, y: 5, layer: 1 }, party: ["Game/Quest/Chrs/ada.tem"] },
  });
  assert.deepEqual(asked, ["coordinate(layer)", "party(Game/Quest,true)"]);
});

test("a configured program fixture is a ProgramFixture as written; only its party is asked for", async () => {
  const launch = {
    kind: "program", main: "Main/quest.gam", projectFolder: "", program: "Prg/start.prg",
    fixture: { id: "smoke", party: ["Chrs/ada.tem"], font: "Liberation Sans", fontSize: 18, windowGraphic: "Bitmap/window.png",
      start: { board: "Boards/village.brd", x: 1, y: 1, layer: 1 } },
  };
  // A Launch object is a valid configuration verbatim, and a restart reruns it without asking again.
  const resolved = await resolveLaunch(launch, ROOTS, scripted({}).prompts);
  assert.deepEqual(resolved, { ok: true, launch });
  assert.deepEqual(await resolveLaunch(launchConfiguration(launch as never), ROOTS, scripted({}).prompts), resolved);
  // Absent optional fixture fields mean the default / none / no board; they are not asked for.
  const { prompts, asked } = scripted({ party: [[]] });
  const bare = await resolveLaunch({ kind: "program", main: "Main/quest.gam", projectFolder: "", program: "Prg/start.prg", fixture: {} }, ROOTS, prompts);
  assert.deepEqual(bare, { ok: true, launch: { kind: "program", main: "Main/quest.gam", projectFolder: "", program: "Prg/start.prg", fixture: { id: "Prg/start.prg", party: [] } } });
  assert.deepEqual(asked, ["party(,false)"]);
  const named = await resolveLaunch({ name: "Smoke test", kind: "program", main: "Main/quest.gam", projectFolder: "", program: "Prg/start.prg", fixture: { party: [] } }, ROOTS, scripted({}).prompts);
  assert.ok(named.ok && named.launch.kind === "program" && named.launch.fixture.id === "Smoke test", "a missing fixture.id is the configuration's name (D8.7)");
});

test("a restart keeps the session's answers under a partly given start", () => {
  const previous = { kind: "board", main: "Main/quest.gam", start: { board: "Boards/a.brd", x: 3, y: 4, layer: 1 }, party: ["Chrs/ada.tem"] };
  assert.deepEqual(mergeAnswers(previous, { kind: "board", start: { board: "Boards/b.brd" } }),
    { kind: "board", main: "Main/quest.gam", start: { board: "Boards/b.brd", x: 3, y: 4, layer: 1 }, party: ["Chrs/ada.tem"] });
});

test("cancelling any question cancels the launch", async () => {
  const resolved = await resolveLaunch({ kind: "game" }, ROOTS, scripted({ main: ["Main/quest.gam"], projectFolder: [undefined] }).prompts);
  assert.deepEqual(resolved, { ok: false, cancelled: true });
});

test("a wrong value refuses with the field's name instead of being guessed or asked", async () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ kind: "debug" }, /"kind"/],
    [{ kind: "game", main: "Main/quest.gam", projectFolder: "", seed: 1.5 }, /"seed"/],
    [{ kind: "game", main: "Main/quest.txt", projectFolder: "" }, /"main"/],
    [{ kind: "game", main: "/elsewhere/quest.gam", projectFolder: "" }, /"main"/],
    [{ kind: "game", main: "Main/quest.gam", projectFolder: "Boards" }, /"projectFolder"/],
    [{ kind: "board", main: "Main/quest.gam", projectFolder: "", start: "Boards/a.brd" }, /"start"/],
    [{ kind: "board", main: "Main/quest.gam", projectFolder: "", start: { board: "../x.brd" } }, /"start\.board"/],
    [{ kind: "board", main: "Main/quest.gam", projectFolder: "", start: { board: "Boards/a.brd", x: "1", y: 1, layer: 1 } }, /"start\.x"/],
    [{ kind: "board", main: "Main/quest.gam", projectFolder: "", start: { board: "Boards/a.brd", x: 1, y: 1, layer: 1 }, party: "Chrs/a.tem" }, /"party"/],
    [{ kind: "program", main: "Main/quest.gam", projectFolder: "", program: "Prg/a.prg", fixture: { party: [], fontSize: 0 } }, /"fixture\.fontSize"/],
    [{ kind: "program", main: "Main/quest.gam", projectFolder: "", program: "Prg/a.prg", fixture: { party: [], start: { board: "Boards/a.brd", x: 1, y: 1, layer: 1.5 } } }, /"fixture\.start\.layer"/],
  ];
  for (const [configuration, field] of cases) {
    const resolved = await resolveLaunch(configuration, ROOTS, scripted({}).prompts);
    assert.equal(resolved.ok, false, JSON.stringify(configuration));
    assert.ok(!resolved.ok && !resolved.cancelled && field.test(resolved.message), `${JSON.stringify(configuration)} → ${JSON.stringify(resolved)}`);
  }
});

test("configured paths are made workspace-relative on desktop and web", () => {
  assert.equal(toWorkspacePath("/work/quest/Main/quest.gam", ROOTS), "Main/quest.gam");
  assert.equal(toWorkspacePath("file:///work/quest/Main/quest.gam", ROOTS), "Main/quest.gam");
  assert.equal(toWorkspacePath("C:\\work\\quest\\Main\\quest.gam", ["c:\\work\\quest"]), "Main/quest.gam");
  assert.equal(toWorkspacePath("vscode-test-web://mount/Main/quest.gam", ["vscode-test-web://mount/"]), "Main/quest.gam");
  assert.equal(toWorkspacePath("/work/quest//Boards/a.brd", ROOTS), "Boards/a.brd");
  assert.equal(toWorkspacePath("/work/quest", ROOTS), "");
  assert.equal(toWorkspacePath("./Main/quest.gam", ROOTS), "Main/quest.gam");
  assert.equal(toWorkspacePath("/Main/quest.gam", ["tkr-testfs://proof/", "/"]), "Main/quest.gam");
  assert.equal(toWorkspacePath("tkr-testfs://proof/Main/quest.gam", ["tkr-testfs://proof/", "/"]), "Main/quest.gam");
  assert.equal(toWorkspacePath("/work/questline/Main/quest.gam", ROOTS), undefined);
  assert.equal(toWorkspacePath("Main/../quest.gam", ROOTS), undefined);
});

test("a configuration that names a saved setup uses the setup's fields, with D8.7's fixture id, under any field it gives", async () => {
  const setups = {
    ok: true as const,
    entries: [
      { name: "Smoke", setup: { name: "Smoke", kind: "program" as const, program: "Prg/start.prg", fixture: { party: [], start: { board: "Boards/a.brd", x: 1, y: 1, layer: 1 } } }, problem: null },
      { name: "Broken", setup: null, problem: "\"start\" is missing." },
    ],
  };
  const picked = configurationOfSetup({ type: "tkr", request: "launch", name: "Smoke", configuration: "Smoke", seed: 4, __tkrWorkspace: "x" }, setups);
  assert.deepEqual(picked, { ok: true, configuration: {
    kind: "program", program: "Prg/start.prg", fixture: { id: "Smoke", party: [], start: { board: "Boards/a.brd", x: 1, y: 1, layer: 1 } }, seed: 4,
  } });
  // No open game in VS Code: the setup leaves main and projectFolder out, so they are asked for.
  assert.ok(picked.ok);
  const { prompts, asked } = scripted({ main: ["Main/quest.gam"], projectFolder: [""] });
  const resolved = await resolveLaunch(picked.configuration, ROOTS, prompts);
  assert.ok(resolved.ok && resolved.launch.kind === "program" && resolved.launch.fixture.id === "Smoke");
  assert.deepEqual(asked, ["main", "projectFolder"]);
  assert.deepEqual(configurationOfSetup({ configuration: "Broken" }, setups), { ok: false, message: "The saved setup \"Broken\" cannot be used: \"start\" is missing." });
  assert.deepEqual(configurationOfSetup({ configuration: "Gone" }, setups), { ok: false, message: "There is no saved setup named \"Gone\" in .tkr/launch.json." });
  assert.deepEqual(configurationOfSetup({ configuration: "Smoke" }, { ok: false, problem: ".tkr/launch.json is not valid JSON." }),
    { ok: false, message: ".tkr/launch.json is not valid JSON." });
});

test("Run and Debug lists each usable saved setup by name, in file order", () => {
  assert.deepEqual(setupConfigurations({ ok: true, entries: [
    { name: "Village", setup: { name: "Village", kind: "game" }, problem: null },
    { name: "Broken", setup: null, problem: "bad" },
  ] }, "tkr"), [{ type: "tkr", request: "launch", name: "Village", configuration: "Village" }]);
  assert.deepEqual(setupConfigurations({ ok: false, problem: "bad" }, "tkr"), []);
});
