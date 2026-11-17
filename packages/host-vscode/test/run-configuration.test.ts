import assert from "node:assert/strict";
import test from "node:test";
import { launchConfiguration, resolveLaunch, toWorkspacePath, type LaunchPrompts } from "../src/run-configuration.ts";

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
  const resolved = await resolveLaunch({ launch: "game", main: "/work/quest/Main/quest.gam", projectFolder: "Game/Quest", seed: 9 }, ROOTS, prompts);
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
    launch: "board", main: "Main/quest.gam", projectFolder: "Game/Quest", board: "Game/Quest/Boards/village.brd", x: 4, y: 5,
  }, ROOTS, prompts);
  assert.deepEqual(resolved, {
    ok: true,
    launch: { kind: "board", main: "Main/quest.gam", projectFolder: "Game/Quest", start: { board: "Game/Quest/Boards/village.brd", x: 4, y: 5, layer: 1 }, party: ["Game/Quest/Chrs/ada.tem"] },
  });
  assert.deepEqual(asked, ["coordinate(layer)", "party(Game/Quest,true)"]);
});

test("a full program fixture is taken from the configuration", async () => {
  const resolved = await resolveLaunch({
    launch: "program", main: "Main/quest.gam", projectFolder: "", program: "Prg/start.prg", board: "Boards/village.brd", x: 1, y: 1, layer: 1,
    party: ["Chrs/ada.tem"], font: "Liberation Sans", fontSize: 18, windowGraphic: "Bitmap/window.png",
  }, ROOTS, scripted({}).prompts);
  assert.ok(resolved.ok);
  assert.deepEqual(resolved.launch, {
    kind: "program", main: "Main/quest.gam", projectFolder: "", program: "Prg/start.prg",
    fixture: { id: "Prg/start.prg", party: ["Chrs/ada.tem"], font: "Liberation Sans", fontSize: 18, windowGraphic: "Bitmap/window.png",
      start: { board: "Boards/village.brd", x: 1, y: 1, layer: 1 } },
  });
  // A restart reruns exactly this launch without asking again.
  const again = await resolveLaunch(launchConfiguration(resolved.launch), ROOTS, scripted({}).prompts);
  assert.deepEqual(again, resolved);
});

test("cancelling any question cancels the launch", async () => {
  const resolved = await resolveLaunch({ launch: "game" }, ROOTS, scripted({ main: ["Main/quest.gam"], projectFolder: [undefined] }).prompts);
  assert.deepEqual(resolved, { ok: false, cancelled: true });
});

test("a wrong value refuses with the field's name instead of being guessed or asked", async () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ launch: "debug" }, /"launch"/],
    [{ launch: "game", main: "Main/quest.gam", projectFolder: "", seed: 1.5 }, /"seed"/],
    [{ launch: "game", main: "Main/quest.txt", projectFolder: "" }, /"main"/],
    [{ launch: "game", main: "/elsewhere/quest.gam", projectFolder: "" }, /"main"/],
    [{ launch: "game", main: "Main/quest.gam", projectFolder: "Boards" }, /"projectFolder"/],
    [{ launch: "board", main: "Main/quest.gam", projectFolder: "", board: "../x.brd" }, /"board"/],
    [{ launch: "board", main: "Main/quest.gam", projectFolder: "", board: "Boards/a.brd", x: "1", y: 1, layer: 1 }, /"x"/],
    [{ launch: "board", main: "Main/quest.gam", projectFolder: "", board: "Boards/a.brd", x: 1, y: 1, layer: 1, party: "Chrs/a.tem" }, /"party"/],
    [{ launch: "program", main: "Main/quest.gam", projectFolder: "", program: "Prg/a.prg", board: "Boards/a.brd", x: 1, y: 1, layer: 1, party: [], font: "", fontSize: 0 }, /"fontSize"/],
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
