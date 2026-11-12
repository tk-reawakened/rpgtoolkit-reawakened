// E-56 text-cell coordinate layout probe (docs/spec/engine/rpgcode-functions.md#e-56,
// #reawakened-text-cell-size; issue #1046, corrected for #1244): a `text` cell coordinate
// keeps its fraction, is scaled to the logical-pixel origin ((x - 1) × size, (y - 1) × size)
// and only that pixel origin is truncated toward zero; `pixeltext` keeps pixel coordinates.
// The probe asserts fractional positive, sub-1, negative and multi-row runs, then replays the
// demo game's title/menu program and compares each run with independently derived font-unit
// advances and reference glyph pixels, so layout-rule violations are distinguishable from
// the program's own coordinates.
import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  applyUiEffect,
  assetKey,
  composeUi,
  createAssetIndex,
  createEngine,
  createGameState,
  PACKAGE_ROOT,
  type GameState,
  type TextCommand,
} from "../src/index.ts";


const S = 18;

test("text keeps a fractional cell coordinate and truncates the scaled pixel origin (E-56)", () => {
  const state = createGameState({ seed: 0 });
  applyUiEffect(state, "fontsize", [S]);
  applyUiEffect(state, "text", [3.5, 4.5, "A"]);
  deepEqual((state.ui.draws ?? [])[0], { x: Math.trunc((3.5 - 1) * S), y: Math.trunc((4.5 - 1) * S), cell: true, text: "A", font: state.ui.font, rgb: state.ui.color, underline: false }, "trunc(2.5×18)=45 and trunc(3.5×18)=63: the fraction is kept until the pixel origin is computed");
});

test("text keeps a sub-1 cell coordinate, so the scaled origin lands above or left of the surface (E-56)", () => {
  const state = createGameState({ seed: 0 });
  applyUiEffect(state, "fontsize", [S]);
  applyUiEffect(state, "text", [0.5, 0.5, "A"]);
  equal((state.ui.draws ?? [])[0]?.x, Math.trunc((0.5 - 1) * S), "trunc(−0.5×18)=−9, half a cell left of the surface, not a whole cell");
});

test("text truncates a negative scaled pixel origin toward zero (E-56)", () => {
  const state = createGameState({ seed: 0 });
  applyUiEffect(state, "fontsize", [S]);
  applyUiEffect(state, "text", [-1.3, -2.7, "A"]);
  deepEqual([(state.ui.draws ?? [])[0]?.x, (state.ui.draws ?? [])[0]?.y], [Math.trunc((-1.3 - 1) * S), Math.trunc((-2.7 - 1) * S)], "trunc(−2.3×18)=−41 and trunc(−3.7×18)=−66 toward zero");
});

test("fractional cell text lays out multi-row, explicit-newline runs from the scaled origin", () => {
  const state = createGameState({ seed: 0 });
  applyUiEffect(state, "fontsize", [S]);
  applyUiEffect(state, "text", [2.5, 1, "AB\nCD\nEF"]);
  const lines = composeUi(state.ui, 800, 600).filter((entry): entry is TextCommand => entry.kind === "text");
  equal(lines.length, 3);
  deepEqual(lines.map((line) => line.y), [0, S, 2 * S], "one cell row per newline, s pixels apart, from the scaled pixel origin");
  equal(new Set(lines.map((line) => line.x)).size, 1, "every line starts at the same first-glyph x");
  deepEqual(lines.every((line) => line.x === Math.trunc((2.5 - 1) * S)), true, "the fractional 2.5 keeps its half cell, so x is trunc(1.5×18)=27");
  deepEqual(lines[0]!.advances.every((advance) => advance.advance === S), true, "equal per-glyph advance (tracking) with the bitmap cell");
});

test("pixeltext keeps arrived coordinates as pixels without cell mapping (E-56 difference)", () => {
  const state = createGameState({ seed: 0 });
  applyUiEffect(state, "fontsize", [S]);
  applyUiEffect(state, "pixeltext", [2.5, 3.5, "A"]);
  deepEqual((state.ui.draws ?? [])
    .map((entry) => ({ x: entry.x, y: entry.y, cell: entry.cell }))[0], { x: 2.5, y: 3.5, cell: false }, "pixeltext keeps pixel coordinates verbatim: the E-56 truncation is a `text` cell-write rule");
});

// --- The demo title-menu probe (G5 rule 4: fetched corpus, never committed) -------------------

const legacyRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures", "legacy");
const haveLegacy = existsSync(legacyRoot);

function listFiles(root: string): string[] {
  const found: string[] = [];
  for (const path of readdirSync(root, { recursive: true }).map((entry) => entry.split("\\").join("/")).sort()) {
    try { readFileSync(join(root, path)); found.push(path); } catch { /* a directory */ }
  }
  return found;
}

function sampleGame(name: string) {
  const root = join(legacyRoot, name);
  if (!existsSync(root)) return null;
  const relativePaths = listFiles(root);
  const lower = (path: string): string => path.toLowerCase();
  const main = relativePaths.find((path) => lower(path) === "demo.gam");
  if (main === undefined) return null;
  const files = new Map<string, Uint8Array>();
  const paths = relativePaths;
  for (const path of relativePaths) files.set(assetKey(path), new Uint8Array(readFileSync(join(root, path))));
  return { files, index: createAssetIndex(paths), main };
}

interface DemoRun {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly cell: boolean;
  readonly size: number;
}

interface DemoPixelReference {
  readonly fontSha256: string;
  readonly regions: readonly { readonly name: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rows: readonly string[] }[];
}

test("the demo title menu's text runs land on their E-56 cell origins with uniform tracking", { skip: haveLegacy ? false : "run pnpm fixtures:fetch" }, () => {
  const sample = sampleGame("demo");
  if (sample === null) throw new Error("fixtures/legacy/demo has no authored demo.gam; run pnpm fixtures:fetch with the Demo main fixture pin");
  const players: unknown[] = [];
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 3,
    assetIndex: sample.index,
    assetRoot: PACKAGE_ROOT,
    mainFile: sample.main,
    bundled: new Map([
      [assetKey("media/fonts/LiberationSans-Regular.ttf"), new Uint8Array(readFileSync(join(legacyRoot, "..", "..", "media", "fonts", "LiberationSans-Regular.ttf")))],
      [assetKey("media/fonts/tkr-8x8.fnt"), new Uint8Array(readFileSync(join(legacyRoot, "..", "..", "media", "fonts", "tkr-8x8.fnt")))],
    ]),
    gameIdentity: "ui-text-coordinates-demo-probe",
    startup: { presence: { hasPlayer: () => players.length > 0 }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: 640,
    height: 480,
    maxTicks: 600,
    effectAppliers: [{ section: "sprites", applier: (effect) => { if (effect.name === "createplayer") players.push(effect.args[0] ?? null); } }],
    cameraTarget: { getPlayerPosition: () => null, getEntityPosition: () => null },
    phaseRegistrations: [{ phase: "audio", run: (state: GameState) => { latest = state; } }],
  });
  const files = sample.files;
  const diagnostics: string[] = [];
  let remaining = 30;
  let replies: unknown[] = [];
  for (let guard = 0; guard < 400; guard += 1) {
    const report = engine.advance(remaining, replies as never);
    replies = [];
    remaining -= report.ticksRun;
    for (const entry of report.diagnostics) diagnostics.push(entry.code);
    if (report.loading) {
      replies = report.requests.flatMap((request) => (request.kind === "asset" ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }] : []));
      continue;
    }
    if (remaining <= 0 || report.ticksRun === 0) break;
  }
  const state: GameState = latest ?? (() => { throw new Error("the demo never reached a phase tick"); })();
  deepEqual(diagnostics.filter((code) => code.startsWith("asset.") || code.startsWith("startup.") || code.startsWith("program.")), []);
  const ui = state.ui;
  equal(ui.font.size, S, "the demo menu runs at font size 18 like the authoring cells");
  equal(ui.font.asset, assetKey("media/fonts/LiberationSans-Regular.ttf"), "the initial face is bundled Liberation Sans");
  equal(ui.font.bold, true, "the unmodified startup program enables bold");
  equal(ui.font.italic, false);
  deepEqual(ui.draws.map((entry) => [entry.font.asset, entry.font.size, entry.font.bold]), Array.from({ length: 4 }, () => [assetKey("media/fonts/LiberationSans-Regular.ttf"), 18, true]));
  const sansBytes = new Uint8Array(readFileSync(join(legacyRoot, "..", "..", "media", "fonts", "LiberationSans-Regular.ttf")));
  const expectedRuns = [
    { text: "Test Game", x: 36, y: 36 },
    { text: "New Game", x: 288, y: 171 },
    { text: "Load Game", x: 288, y: 198 },
    { text: "Quit", x: 288, y: 225 },
  ] as const;
  const commands = engine.drawList().commands.filter((entry): entry is TextCommand => entry.kind === "text");
  equal(commands.length, expectedRuns.length, "the Demo title and all three menu labels are drawn");
  // Independently extracted with fontTools (cmap/hmtx, 2048 units/em).
  // The font's default GPOS script has no kern feature. Each pair is
  // [glyph ID, round(advance * 18 / 2048) + synthetic-bold pixel].
  const expectedAdvances = [
    [[55,12],[72,11],[86,10],[87,6],[3,6],[42,15],[68,11],[80,16],[72,11]],
    [[49,14],[72,11],[90,14],[3,6],[42,15],[68,11],[80,16],[72,11]],
    [[47,11],[82,11],[68,11],[71,11],[3,6],[42,15],[68,11],[80,16],[72,11]],
    [[52,15],[88,11],[76,5],[87,6]],
  ].map((run) => run.map(([glyph, advance]) => ({ glyph: glyph!, advance: advance! })));
  deepEqual(commands.map((command) => command.text), expectedRuns.map((run) => run.text));
  deepEqual(commands.map((command) => command.advances), expectedAdvances, "glyph IDs and advances match the independent font reference");
  let pixels: Uint8Array | null = null;
  for (let rev = 0; rev < 64 && pixels === null; rev += 1) pixels = engine.surfacePixels(0 as never, rev)?.rgba ?? null;
  if (pixels === null) throw new Error("the Demo screen surface is unavailable");
  // Independent pixel reference (fixtures/demo-title-menu-freetype-reference.json): FreeType's exact-area
  // coverage of the unmodified Demo's four runs, not this project's rasteriser and not `textInk`. The
  // whole 640×480 surface is compared, so ink outside the title/menu rectangles, misplaced edges and
  // any shifted glyph (for example TrueType `startX` ± 1) are caught, not only the pixels a model predicts.
  const reference = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "demo-title-menu-freetype-reference.json"), "utf8")) as DemoPixelReference;
  equal(createHash("sha256").update(sansBytes).digest("hex"), reference.fontSha256, "the reference was generated from the bundled Liberation Sans Regular");
  const expectedAlpha = new Uint8Array(640 * 480);
  for (const region of reference.regions) {
    equal(region.rows.length, region.height, `${region.name} reference has every row`);
    region.rows.forEach((row, rowIndex) => {
      let column = 0;
      for (const token of row.split(" ")) {
        if (token.startsWith("-")) { column += Number(token.slice(1)); continue; }
        for (let at = 0; at < token.length; at += 2, column += 1) expectedAlpha[(region.y + rowIndex) * 640 + region.x + column] = Number.parseInt(token.slice(at, at + 2), 16);
      }
      equal(column, region.width, `${region.name} reference row ${rowIndex} spans the region`);
    });
  }
  equal(expectedAlpha.some((value) => value === 255), true, "the independent title/menu reference contains solid glyph pixels");
  // The project flattens outlines to within 0.25 px in 1/64-pixel fixed point; against FreeType's exact areas the
  // actual Demo differs by at most 34 levels with a summed difference of 5676. A one-pixel shift of any glyph
  // gives a summed difference above 220000 and more than 1400 pixels over 40 levels.
  const mismatches: string[] = [];
  let totalDifference = 0;
  for (let pixel = 0; pixel < 640 * 480; pixel += 1) {
    const actual = pixels[pixel * 4 + 3]!;
    const expected = expectedAlpha[pixel]!;
    totalDifference += Math.abs(actual - expected);
    if (expected === 0 ? actual > 2 : Math.abs(actual - expected) > 40) mismatches.push(`(${pixel % 640},${Math.floor(pixel / 640)}) actual ${actual} expected ${expected}`);
    if (actual > 0) deepEqual([pixels[pixel * 4], pixels[pixel * 4 + 1], pixels[pixel * 4 + 2]], [255, 255, 255], `straight-alpha white glyph pixel ${pixel % 640},${Math.floor(pixel / 640)}`);
  }
  deepEqual(mismatches.slice(0, 8), [], `${mismatches.length} screen pixels differ from the independent reference`);
  equal(totalDifference <= 6500, true, `summed coverage difference ${totalDifference} exceeds the 6500 flattening budget`);
  cellProbe: {
    equal(Array.isArray(ui.draws), true);
    const runs: readonly DemoRun[] = (ui.draws ?? []).map((entry) => ({ text: entry.text as string, x: entry.x as number, y: entry.y as number, cell: entry.cell as boolean, size: (entry.font as { size: number }).size }));
    deepEqual(runs.map((run) => run.text), ["Test Game", "New Game", "Load Game", "Quit"]);
    // Pinned corpus rev (tools/fixtures/sources.json): the title/menu program's own cell
    // rows (3,3; 17,10.5; 17,12; 17,13.5) are what it writes; the probe pins that they land
    // on their E-56 origins so a layout-rule regression cannot silently reuse these values.
    // The fractional 10.5/13.5 rows keep their half cell: trunc(9.5×18)=171 and trunc(12.5×18)=225.
    deepEqual(runs.map((run) => [run.x, run.y, run.cell]), [[36, 36, true], [288, 171, true], [288, 198, true], [288, 225, true]]);
    deepEqual(runs.every((run) => Number.isInteger(run.x) && Number.isInteger(run.y)), true, "every run starts at a whole-pixel origin: the fraction is kept as a cell, then the scaled pixel is truncated — E-56 holds for fractional cells");
  }
  alignProbe: {
    // Alignment observation (issue #1046's second independent contributor): the program's own
    // cursor-map points and text rows — recorded in pixels by `cursormapadd` — are kept verbatim;
    // the hand tip draws at point − (40, 10). With the fractional rows kept, the first point
    // (180) is exactly the centre of the row starting at 171 (171 + 9).
    const points = (ui.cursorMaps ?? []).flatMap((map) => map.points.map((point) => [point.x, point.y]));
    deepEqual(points, [[295, 180], [295, 210], [295, 230]], "the authored cursor points; the 180 point centres the 171 row — program data, not a core layout rule");
  }
});
