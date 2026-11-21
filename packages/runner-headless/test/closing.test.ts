// The closing suite over the fetched sample games (ticket 4.28). `pnpm closing` replays all eight games; this test
// replays the 3.1 `demo` game, the cheapest real one, and audits the committed files for the rest.
import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compareRgbaWithPng, parseClosingPlan, runClosingGame, runClosingFrames, type ClosingBaseline } from "@tk-reawakened/runner-harness";
import { loadGameFiles, runClosing } from "../src/closing.ts";

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const haveLegacy = existsSync(join(repoRoot, "fixtures", "legacy"));
const plan = parseClosingPlan(readFileSync(join(repoRoot, "golden", "closing", "plan.json"), "utf8"));
const baseline: ClosingBaseline = JSON.parse(readFileSync(join(repoRoot, "golden", "regression", "closing.json"), "utf8"));

test("the plan lists both 3.1 games and the six Toolkit 2 games, each with a committed baseline", () => {
  deepEqual(plan.games.map((game) => game.name).sort(), ["Basic", "BusDriver", "Caoquest", "ChimeranEmpire", "FinalDestiny", "LittleMan", "School2Demo", "demo"]);
  deepEqual(Object.keys(baseline.games).sort(), plan.games.map((game) => game.name).sort());
  for (const game of plan.games) {
    const recorded = baseline.games[game.name];
    ok(recorded !== undefined);
    equal(recorded.outcome, game.expect.outcome, `${game.name}: committed outcome is not the planned one`);
    if (game.expect.outcome !== "boots") ok(recorded.diagnostics.length > 0, `${game.name}: an expected failure must carry its located diagnostic`);
    for (const diagnostic of recorded.diagnostics) ok(diagnostic.code !== "" && diagnostic.message !== "", `${game.name}: a diagnostic lacks its code or message`);
  }
});

test("every committed closing PNG exists, is a regression baseline in the ledger and is no independent reference", () => {
  const ledger: { readonly goldens: readonly { readonly path: string; readonly suite?: string; readonly class: string; readonly gating: boolean }[] } = JSON.parse(readFileSync(join(repoRoot, "golden", "ledger.json"), "utf8"));
  const rows = ledger.goldens.filter((row) => row.suite === "closing");
  const frames = Object.values(baseline.games).flatMap((game) => game.frames.flatMap((frame) => (frame.png === undefined ? [] : [frame.png])));
  deepEqual(rows.map((row) => row.path).sort(), [...frames].sort());
  for (const row of rows) {
    equal(row.class, "regression-baseline");
    equal(row.gating, true);
    ok(row.path.startsWith("golden/regression/closing/"));
    ok(existsSync(join(repoRoot, row.path)), `${row.path} is missing`);
  }
});

test("the demo sample game boots through the real engine and matches its committed baseline", { skip: haveLegacy ? false : "run pnpm fixtures:fetch" }, () => {
  const demo = plan.games.find((game) => game.name === "demo");
  ok(demo !== undefined);
  const bundled = new Map<string, Uint8Array>();
  for (const folder of plan.bundled) for (const [path, bytes] of loadGameFiles(join(repoRoot, folder))) bundled.set(`${folder}/${path}`, bytes);
  const run = runClosingGame(plan, demo, loadGameFiles(join(repoRoot, "fixtures", "legacy", "demo")), bundled);
  deepEqual(run.batchProblems, []);
  deepEqual(run.record, baseline.games.demo);
  equal(run.record.outcome, "boots");
  equal(run.record.board, "boards/start.brd");
  deepEqual(run.record.diagnostics, []);
  for (const [path, image] of run.images) {
    const comparison = compareRgbaWithPng(image, new Uint8Array(readFileSync(join(repoRoot, path))));
    equal(comparison.error, null);
    equal(comparison.equal, true, `${path}: ${JSON.stringify(comparison.firstDifference)}`);
  }
});

test("Final Destiny draws its title button and a slot click reaches the game board", { skip: haveLegacy ? false : "run pnpm fixtures:fetch" }, () => {
  const game = plan.games.find((entry) => entry.name === "FinalDestiny");
  ok(game !== undefined);
  const bundled = new Map<string, Uint8Array>();
  for (const folder of plan.bundled) for (const [path, bytes] of loadGameFiles(join(repoRoot, folder))) bundled.set(`${folder}/${path}`, bytes);
  const files = loadGameFiles(join(repoRoot, "fixtures", "legacy", "FinalDestiny"));
  const titlePlan = { ...plan, keys: [], frames: plan.frames.map((frame) => frame.label === "title" ? { ...frame, tick: 300 } : frame) };
  const initial = runClosingFrames(titlePlan, game, files, bundled);
  const initialTitle = initial.frames.find((frame) => frame.label === "title");
  ok(initialTitle !== undefined);
  const button = initialTitle.drawList.commands.find((entry) => entry.kind === "blit" && entry.key?.r === 255 && entry.key?.g === 0 && entry.key?.b === 255);
  ok(button?.kind === "blit" && "asset" in button.source, `title frame has no keyed button image: ${JSON.stringify(initial.diagnostics)}`);
  if (button?.kind !== "blit" || !("asset" in button.source)) return;
  equal(button.source.asset, "bitmap/new.jpg");
  let visibleButtonPixel = false;
  for (let py = button.dst.y; py < button.dst.y + button.dst.h; py++) {
    for (let px: number = button.dst.x; px < button.dst.x + button.dst.w; px++) {
      const offset = (py * initialTitle.width + px) * 4;
      if (initialTitle.pixels[offset] !== 0 || initialTitle.pixels[offset + 1] !== 0 || initialTitle.pixels[offset + 2] !== 0) {
        visibleButtonPixel = true;
        break;
      }
    }
    if (visibleButtonPixel) break;
  }
  ok(visibleButtonPixel, "New Game image contributed no visible pixels");
  const x = button.dst.x + Math.floor(button.dst.w / 2);
  const y = button.dst.y + Math.floor(button.dst.h / 2);
  const run = runClosingFrames(titlePlan, game, files, bundled, {
    pointers: [{ tick: 300, x, y, buttons: 1 }, { tick: 301, x, y, buttons: 0 }],
  });
  equal(run.stalled, false);
  ok(run.board !== null && run.board !== initial.board, "New Game click did not reach a different board");
  ok(!run.diagnostics.some((diagnostic) => diagnostic.code === "arity.mismatch" && diagnostic.message.toLowerCase().includes("checkbutton")), "title click reported a CheckButton arity error");
});


test("closing reports a missing fixtures directory instead of passing", () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (message: string) => { errors.push(message); };
  try {
    equal(runClosing([join(repoRoot, "golden")]), 1);
  } finally {
    console.error = original;
  }
  ok(errors[0]?.includes("fixtures directory not found"), errors.join("\n"));
});

test("closing trace rejects missing paths, existing inputs and golden recording before running", () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (message: string) => { errors.push(message); };
  try {
    equal(runClosing(["--trace"]), 1);
    equal(runClosing(["--trace", join(repoRoot, "package.json")]), 1);
    equal(runClosing(["--trace", "/tmp/never-written-trace-614.json", "--record"]), 1);
  } finally {
    console.error = original;
  }
  ok(errors.some((error) => error.includes("requires one new .json")));
  ok(errors.some((error) => error.includes("already exists")));
  ok(errors.some((error) => error.includes("cannot be combined with --record")));
});
