// The stock menu screens end to end (E-80; docs/spec/engine/plugins-and-battle.md#e-80-stock-menu, #585).
//
// Each test boots a whole authored game with the real `stock_menu` package and drives it with key events, so the
// assertions are about what a player sees and what the owners hold: the menu stack, the overlay blit in the draw
// list, inventory state, the host requests a screen issues, and the cue a key posts to the `ui` track.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyItem,
  createEmptyMainFile,
  createEmptySpecialMove,
  createEngine,
  fnv1a64,
  hashDrawList,
  hashState,
  IR_VERSION,
  inputPhaseRegistration,
  PACKAGE_ROOT,
  startThread,
  writeBoard,
  writeCharacter,
  writeItem,
  writeMainFile,
  writeSpecialMove,
  type AssetIndex,
  type AssetKey,
  type Engine,
  type GameState,
  type InputEvent,
  type InputRecord,
  type PackageCatalogueEntry,
} from "../src/index.ts";
import { encodePng } from "./battle-ui-rig.ts";

type Files = Map<string, Uint8Array>;
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const STOCK_MENU = (() => {
  const folder = join(repoRoot, "stock", "stock_menu");
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as {
    readonly name: string;
    readonly version: string;
    readonly namespace: string;
    readonly requests: PackageCatalogueEntry["requests"];
    readonly program: string;
  };
  return { manifest, source: readFileSync(join(folder, manifest.program), "utf8") };
})();

function catalogue(): readonly PackageCatalogueEntry[] {
  const { manifest, source } = STOCK_MENU;
  return [{
    name: manifest.name,
    version: manifest.version,
    namespace: manifest.namespace,
    requests: manifest.requests,
    definition: { id: manifest.name, version: manifest.version, commands: [] },
    startup: { kind: "inline", text: source, ir: IR_VERSION, dialect: "tk3" },
  }];
}

/** The engine's bundled `media/` files: the default bitmap font and the bundled TrueType faces. */
function bundledFiles(): Map<AssetKey, Uint8Array> {
  const bundled = new Map<AssetKey, Uint8Array>();
  for (const name of readdirSync(join(repoRoot, "media", "fonts"))) {
    bundled.set(assetKey(`media/fonts/${name}`), new Uint8Array(readFileSync(join(repoRoot, "media", "fonts", name))));
  }
  for (const name of readdirSync(join(repoRoot, "media", "cursors"))) {
    bundled.set(assetKey(`media/cursors/${name}`), new Uint8Array(readFileSync(join(repoRoot, "media", "cursors", name))));
  }
  return bundled;
}
const BUNDLED = bundledFiles();

function boardBytes(disableSaving: number): Uint8Array {
  const empty = createEmptyBoard();
  return unwrap(writeBoard({
    ...empty,
    sizeX: 40,
    sizeY: 30,
    sizeL: 1,
    tileMatrix: Array.from({ length: 40 * 30 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 40 * 30, marker: true }],
    layerTitles: ["", ""],
    properties: { ...empty.properties, start: { x: 64, y: 64, layer: 1 }, disableSaving },
  }));
}

/** A 16-bit mono PCM wave with `samples` silent frames: enough for the audio owner to compute a length. */
function waveBytes(samples = 256): Uint8Array {
  const data = samples * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) bytes[at + index] = text.charCodeAt(index);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + data, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, data, true);
  return bytes;
}

type GameOptions = {
  readonly startup: string;
  readonly disableSaving?: number;
  readonly sounds?: boolean;
};

function authoredGame(options: GameOptions): { readonly files: Files; readonly index: AssetIndex; readonly main: string } {
  const files: Files = new Map();
  const paths = [
    "main.gam", "Boards/start.brd", "Chrs/hero.tem", "Prg/start.prg",
    "Item/potion.itm", "Item/key.itm", "Item/sword.itm", "Bitmap/layout.png", "Bitmap/ghost.png", "Media/move.wav", "Media/confirm.wav", "Media/cancel.wav",
    "SpcMove/fire.spc", "Prg/fire.prg",
  ];
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
    initChar: "hero.tem",
    packagePlugins: ["stock_menu"],
    ...(options.sounds === true ? { cursorMoveSound: "move.wav", cursorSelectSound: "confirm.wav", cursorCancelSound: "cancel.wav" } : {}),
  };
  files.set(assetKey("main.gam"), unwrap(writeMainFile(main)));
  files.set(assetKey("boards/start.brd"), boardBytes(options.disableSaving ?? 0));
  files.set(assetKey("chrs/hero.tem"), unwrap(writeCharacter({
    ...createEmptyCharacter(),
    minor: 5,
    name: "Hero",
    stats: { ...createEmptyCharacter().stats, hp: 10, maxHp: 20, level: 1 },
    bodySlots: [0, 1, 1, 1, 1, 1, 1],
    profilePicture: "layout.png",
    hasSpecialMoves: 0,
    specialMoves: createEmptyCharacter().specialMoves.map((slot, index) => index === 0 ? { ...slot, file: "fire.spc" } : slot),
    movementAnimations: Array(8).fill(""),
    battleStances: ["", "", "", "", "", ""],
  })));
  files.set(assetKey("item/potion.itm"), unwrap(writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    name: "Potion",
    description: "Restores 10 HP",
    menuUsable: 1,
    equipable: 1,
    equipSlots: [0, 1, 0, 0, 0, 0, 0, 0],
    menuUseHp: 10,
  })));
  files.set(assetKey("item/sword.itm"), unwrap(writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    name: "Iron sword",
    description: "Cuts things",
    equipable: 1,
    // Stored slot order: the hands are swapped, so index 4 is the canonical right hand (docs/spec: slotLocation).
    equipSlots: [0, 0, 0, 0, 1, 0, 0, 0],
  })));
  files.set(assetKey("item/key.itm"), unwrap(writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    name: "Brass key",
    description: "Opens the cellar",
    menuUsable: 1,
    keyItem: 1,
  })));
  files.set(assetKey("spcmove/fire.spc"), unwrap(writeSpecialMove({
    ...createEmptySpecialMove(), minor: 3, name: "Fire", description: "A spark", program: "fire.prg",
  })));
  files.set(assetKey("prg/fire.prg"), new TextEncoder().encode("abilityused = 1\n"));
  files.set(assetKey("bitmap/layout.png"), encodePng(1, 1, new Uint8Array([200, 40, 40, 255])));
  for (const name of ["move", "confirm", "cancel"]) files.set(assetKey(`media/${name}.wav`), waveBytes());
  files.set(assetKey("prg/start.prg"), new TextEncoder().encode("end()\n"));
  return { files, index: createAssetIndex(paths), main: "main.gam" };
}

type Session = {
  readonly engine: Engine;
  state(): GameState;
  /** Advance until `until` holds, answering every host request with the authored game's files. */
  pump(until: (state: GameState) => boolean, key?: string, limit?: number): GameState;
  readonly requests: string[];
  readonly loads: string[];
  readonly diagnostics: string[];
  readonly saves: string[];
};

function boot(options: GameOptions): Session {
  const game = authoredGame(options);
  let latest: GameState | null = null;
  const requests: string[] = [];
  const saves: string[] = [];
  const loads: string[] = [];
  const diagnostics: string[] = [];
  const engine = createEngine({
    seed: 7,
    assetIndex: game.index,
    assetRoot: PACKAGE_ROOT,
    mainFile: game.main,
    gameIdentity: "stock-menu-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: 320,
    height: 240,
    input: { bindings: { keys: { KeyM: "menu", Escape: "cancel", Enter: "confirm", ArrowUp: "up", ArrowDown: "down", ArrowRight: "right" } } },
    maxTicks: 4000,
    packageCatalogue: catalogue(),
    bundled: BUNDLED,
    phaseRegistrations: [inputPhaseRegistration(), { phase: "audio", run: (state) => { latest = state; } }],
  });
  const state = (): GameState => {
    if (latest === null) throw new Error("the engine has not advanced");
    return latest;
  };
  function answer(request: { readonly kind: string; readonly reqId: number; readonly key?: string; readonly blob?: { readonly path: string } }): InputEvent[] {
    requests.push(request.kind);
    if (request.kind === "asset") return [{ kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key as never) ?? null }];
    if (request.kind === "listBlobs") return [{ kind: "blob.listed", reqId: request.reqId, names: ["files/other.sav", "saved/not-a-save.txt", "saved/slot1.sav"] }];
    if (request.kind === "loadBlob") {
      loads.push(request.blob?.path ?? "");
      return [{ kind: "blob.loaded", reqId: request.reqId, bytes: null }];
    }
    if (request.kind === "saveBlob") {
      saves.push(request.blob?.path ?? "");
      return [{ kind: "blob.saved", reqId: request.reqId, ok: true }];
    }
    return [];
  }
  function pump(until: (state: GameState) => boolean, key?: string, limit = 20): GameState {
    let replies: InputRecord[] = [];
    let queued = key;
    let keyEndTick: number | null = null;

    for (let step = 0; step < limit; step += 1) {
      if (queued !== undefined && latest !== null) {
        const tick = state().time.tick;
        const code = queued === "ENTER" ? "Enter" : queued === "ESC" ? "Escape" : queued === "UP" ? "ArrowUp" : queued === "DOWN" ? "ArrowDown" : queued === "M" ? "KeyM" : queued;
        replies.push(
          { tick, event: { kind: "key", name: queued, code, char: null, down: true } },
          { tick: tick + 1, event: { kind: "key", name: queued, code, char: null, down: false } },
        );
        keyEndTick = tick + 1;
        queued = undefined;
      }
      const report = engine.advance(keyEndTick !== null && replies.some((record) => record.event.kind === "key") ? 2 : 1, replies);
      diagnostics.push(...report.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`));
      replies = report.requests.flatMap((request) => answer(request as never).map((event) => ({ tick: report.tickAfter, event })));
      if (report.loading) continue;
      const ready = state().menu.screens.length === 0 || state().vm.threads.some((thread) => thread.status === "waiting" && (thread.wait?.kind === "input.key" || thread.wait?.kind === "render.msgbox"));
      if (queued === undefined && replies.length === 0 && ready && (keyEndTick === null || state().time.tick > keyEndTick) && until(state())) return state();
    }
    const current = latest;
    throw new Error(`the menu did not reach the expected state: screens=${JSON.stringify(current?.menu.screens ?? null)} threads=${(current?.vm.threads ?? []).map((thread) => `${thread.kind}:${thread.status}:${thread.wait?.kind ?? "-"}`).join(",")} requests=${requests.join(",")} diagnostics=${diagnostics.join("; ")}`);
  }
  const session = { engine, state, pump, requests, saves, loads, diagnostics };
  pump((current) => current.engine.boot?.stage === "running" && !current.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished"));
  if (options.startup !== "end()\n") {
    startThread(state().vm, { ref: { kind: "inline", text: options.startup, ir: IR_VERSION }, kind: "blocking", owner: "script" });
  }
  return session;
}

/** Send one key on the next tick and let the screen handle it. */
function press(session: Session, key: string): GameState {
  const tick = session.state().time.tick;
  return session.pump((current) => current.time.tick > tick, key);
}

/** The overlay blit the menu contributes to the draw list (E-80 §4). */
function overlayBlits(engine: Engine): number {
  return engine.drawList().commands.filter((command) => command.kind === "blit" && "surface" in command.source).length;
}

test("three separately delivered keys move the selection in order", () => {
  const session = boot({ startup: "mainmenu()\n" });
  equal(session.pump((state) => state.menu.screens.length === 1).menu.screens[0]!.selection, 0);
  equal(press(session, "DOWN").menu.screens[0]!.selection, 1);
  equal(press(session, "DOWN").menu.screens[0]!.selection, 2);
  equal(press(session, "UP").menu.screens[0]!.selection, 1);
});

test("the menu key opens the main screen and the menu key closes it", () => {
  const session = boot({ startup: "end()\n" });
  session.pump((state) => state.engine.boot?.stage === "running" && !state.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished"));
  const opened = session.pump((state) => state.menu.screens.length === 1, "M");
  equal(opened.menu.screens[0]!.screen, "main");
  ok(overlayBlits(session.engine) >= 1, "the screen is one overlay blit in the draw list");
  const closed = press(session, "ESC");
  equal(closed.menu.screens.length, 0, "cancel closes the outermost screen");
});

test("a direction pressed on the tick the menu key opens the menu queues no movement", () => {
  const session = boot({ startup: "end()\n" });
  const before = session.state().sprites.players[0]!;
  const tick = session.state().time.tick;
  session.engine.advance(1, [
    { tick, event: { kind: "key", name: "M", code: "KeyM", char: null, down: true } },
    { tick, event: { kind: "key", name: "ArrowRight", code: "ArrowRight", char: null, down: true } },
  ]);
  const after = session.state().sprites.players[0]!;
  ok(session.state().vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished"), "the menu key started the menu thread");
  deepEqual(after.queue.moves, [], "no step is queued behind the menu");
  equal(after.movement.active, null);
  deepEqual([after.x, after.y], [before.x, before.y]);
});

for (const [startup, expected] of [
    ["mainmenu()\n", "main"],
    ["itemmenu()\n", "items"],
    ["equipmentmenu()\n", "equipment"],
    ["abilitiesmenu()\n", "abilities"],
    ["internalmenu(0)\n", "main"],
    ["internalmenu(1)\n", "items"],
    ["internalmenu(2)\n", "equipment"],
    ["internalmenu(4)\n", "abilities"],
] as const) {
  test(`${startup.trim()} opens ${expected} directly`, () => {
    const session = boot({ startup });
    const state = session.pump((current) => current.menu.screens.length === 1);
    equal(state.menu.screens[0]!.screen, expected, `${startup.trim()} opens ${expected}`);
    ok(overlayBlits(session.engine) >= 1, `${expected} draws its overlay`);
    equal(press(session, "ESC").menu.screens.length, 0, `${expected} closes on cancel`);
  });
}

/** Every screen depth of the stock menu, as the keys that reach it from the main screen (E-80 #menu-navigation rule 2). */
const NESTED_DEPTHS: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  ["items list", ["ENTER"], ["main", "items"]],
  ["items action", ["ENTER", "ENTER"], ["main", "items"]],
  ["items member", ["ENTER", "ENTER", "ENTER"], ["main", "items"]],
  ["items info", ["ENTER", "ENTER", "DOWN", "ENTER"], ["main", "items"]],
  ["equipment member", ["DOWN", "ENTER"], ["main", "equipment"]],
  ["equipment slot", ["DOWN", "ENTER", "ENTER"], ["main", "equipment"]],
  ["equipment item", ["DOWN", "ENTER", "ENTER", "ENTER"], ["main", "equipment"]],
  ["abilities member", ["DOWN", "DOWN", "ENTER"], ["main", "abilities"]],
  ["abilities list", ["DOWN", "DOWN", "ENTER", "ENTER"], ["main", "abilities"]],
  ["abilities action", ["DOWN", "DOWN", "ENTER", "ENTER", "ENTER"], ["main", "abilities"]],
  ["abilities info", ["DOWN", "DOWN", "ENTER", "ENTER", "ENTER", "DOWN", "ENTER"], ["main", "abilities"]],
  ["save picker", ["DOWN", "DOWN", "DOWN", "ENTER"], ["main"]],
  ["load picker", ["DOWN", "DOWN", "DOWN", "DOWN", "ENTER"], ["main"]],
];
for (const [label, keys, stack] of NESTED_DEPTHS) {
  test(`the menu key closes the whole stack from the ${label}`, () => {
    const session = boot({ startup: 'giveitem("potion")\nmainmenu()\n' });
    session.pump((state) => state.menu.screens.length === 1);
    for (const key of keys) press(session, key);
    deepEqual(session.state().menu.screens.map((screen) => screen.screen), stack, `${label} is open before the menu key`);
    const closed = press(session, "M");
    equal(closed.menu.screens.length, 0, `${label}: the menu key closed every screen`);
    equal(session.saves.length + session.loads.length, 0, "closing wrote and read no save");
    // A later menu opens and behaves normally, so the unwinding left nothing behind.
    startThread(session.state().vm, { ref: { kind: "inline", text: "mainmenu()\n", ir: IR_VERSION }, kind: "blocking", owner: "script" });
    equal(session.pump((state) => state.menu.screens.length === 1).menu.screens[0]!.screen, "main");
    equal(press(session, "DOWN").menu.screens[0]!.selection, 1, "the reopened menu still takes input");
  });
}

test("a child screen returns to the same usable main menu", () => {
  const session = boot({ startup: "mainmenu()\n" });
  session.pump((state) => state.menu.screens.length === 1);
  equal(press(session, "ENTER").menu.screens.at(-1)?.screen, "items");
  equal(press(session, "ESC").menu.screens.at(-1)?.screen, "main");
  equal(press(session, "DOWN").menu.screens[0]?.selection, 1);
  deepEqual(session.diagnostics, []);
});

test("a key item cannot be dropped and an ordinary item is dropped once", () => {
  const session = boot({ startup: 'giveitem("key")\ngiveitem("potion")\nitemmenu()\n' });
  let state = session.pump((current) => current.menu.screens.length === 1);
  equal(state.inventory.items.length, 2);
  // Stack 1 is the key, stack 2 the potion. Confirm opens the action rows, two downs select Drop, confirm drops.
  for (const key of ["ENTER", "DOWN", "DOWN", "ENTER"]) state = press(session, key);
  equal(state.inventory.items.find((entry) => entry.handle === "Brass key")?.quantity, 1, "the key item is still carried");
  equal(state.inventory.items.length, 2, "the attempted drop did not remove any stack");
  // Back to the list, move to the potion, and drop it: one unit leaves the stack.
  for (const key of ["ESC", "DOWN", "ENTER", "DOWN", "DOWN", "ENTER"]) state = press(session, key);
  equal(state.inventory.items.find((entry) => entry.handle === "Potion"), undefined, "the potion stack is gone");
  equal(state.inventory.items.find((entry) => entry.handle === "Brass key")?.quantity, 1, "the key is untouched");
});

test("item info returns to actions and item use consumes the chosen stack", () => {
  const session = boot({ startup: 'giveitem("potion")\nitemmenu()\n' });
  session.pump((state) => state.menu.screens.length === 1);
  for (const key of ["ENTER", "DOWN", "ENTER"]) press(session, key);
  equal(session.state().inventory.items[0]?.quantity, 1, "Info does not consume the item");
  for (const key of ["ESC", "UP", "ENTER", "ENTER"]) press(session, key);
  equal(session.state().inventory.items.length, 0, "Use consumes the item");
  equal(session.state().actors.actors[0]?.stats.hp, 20, "Use applies the menu HP effect");
  deepEqual(session.diagnostics, []);
});

test("equipment selects a member, slot and item, then removes it", () => {
  const session = boot({ startup: 'giveitem("potion")\nequipmentmenu()\n' });
  session.pump((state) => state.menu.screens.length === 1);
  for (const key of ["ENTER", "ENTER", "ENTER"]) press(session, key);
  equal(session.state().inventory.equipment[0]?.slot, "head", "the selected item is equipped in the head slot");
  for (const key of ["ENTER", "ENTER"]) press(session, key);
  equal(session.state().inventory.equipment.length, 0, "Remove clears the slot");
  equal(session.state().inventory.items[0]?.quantity, 1, "Remove returns the item to inventory");
  deepEqual(session.diagnostics, []);
});

/** The horizontal extent of the ink drawn in one 16-pixel text band between two columns, or null when the row is blank there. */
function inkExtent(session: Session, y: number, fromX: number, toX: number): number | null {
  const state = session.state();
  const entry = state.surfaces.entries[String(state.surfaces.renderNow)];
  if (entry === undefined) throw new Error("the render-now surface does not exist");
  const surface = session.engine.surfacePixels(entry.id, entry.rev);
  if (surface === null) throw new Error("the drawn menu pixels are not available");
  let first = -1;
  let last = -1;
  for (let x = fromX; x < toX; x += 1) {
    for (let row = y; row < y + 16; row += 1) {
      const at = (row * surface.w + x) * 4;
      const background = (row * surface.w + toX) * 4;
      const differs = [0, 1, 2].some((channel) => surface.rgba[at + channel] !== surface.rgba[background + channel]);
      if (differs) {
        if (first < 0) first = x;
        last = x;
      }
    }
  }
  return first < 0 ? null : last - first + 1;
}

test("equipment offers only items whose own slot flag fits, including both hands", () => {
  const session = boot({ startup: 'giveitem("potion")\ngiveitem("potion")\ngiveitem("sword")\nequipmentmenu()\n' });
  session.pump((state) => state.menu.screens.length === 1);
  // Head: the Potion fits and the sword does not, so the list has one row and `down` stays on it.
  for (const key of ["ENTER", "ENTER", "DOWN"]) press(session, key);
  equal(session.state().menu.screens.at(-1)?.selection, 0, "the head list holds only the potion");
  press(session, "ENTER");
  // Right hand: the sword fits and the potion (one still carried) does not.
  for (const key of ["DOWN", "DOWN", "ENTER", "DOWN"]) press(session, key);
  equal(session.state().menu.screens.at(-1)?.selection, 0, "the right-hand list holds only the sword");
  press(session, "ENTER");
  deepEqual(session.state().inventory.equipment.map((entry) => [entry.slot, entry.itemId]), [["head", 1], ["right-hand", 2]]);
  // Left hand: neither carried item fits it, so confirming changes nothing.
  for (const key of ["DOWN", "ENTER", "ENTER"]) press(session, key);
  equal(session.state().inventory.equipment.length, 2, "nothing fits the left hand");
  deepEqual(session.diagnostics, []);
});

test("an equipped item whose every unit is worn still prints its name on the slot row", () => {
  const session = boot({ startup: 'giveitem("sword")\nequipmentmenu()\n' });
  session.pump((state) => state.menu.screens.length === 1);
  for (const key of ["ENTER", "DOWN", "DOWN", "ENTER", "ENTER"]) press(session, key);
  deepEqual(session.state().inventory.equipment.map((entry) => entry.slot), ["right-hand"]);
  equal(session.state().inventory.items[0]?.quantity, 0, "the only unit is worn");
  const worn = inkExtent(session, 52 + 20 * 2, 152, 300);
  const empty = inkExtent(session, 52 + 20 * 3, 152, 300);
  ok(worn !== null && worn > 40, `the worn sword's name is drawn (ink width ${String(worn)})`);
  ok(empty !== null && empty <= 16, `an empty slot draws only the dash (ink width ${String(empty)})`);
});

test("abilities show info and run a board-usable move", () => {
  const session = boot({ startup: "abilitiesmenu()\n" });
  session.pump((state) => state.menu.screens.length === 1);
  for (const key of ["ENTER", "ENTER", "DOWN", "ENTER", "ESC", "UP", "ENTER"]) press(session, key);
  equal(session.state().vm.globals.abilityused, 1, "Use runs the move's board program");
  deepEqual(session.diagnostics, []);
});

test("Save is gated by the board's disable-saving flag", () => {
  const session = boot({ startup: "mainmenu()\n", disableSaving: 1 });
  let state = session.pump((current) => current.menu.screens.length === 1);
  for (const key of ["DOWN", "DOWN", "DOWN", "ENTER"]) state = press(session, key);
  equal(session.requests.includes("saveBlob"), false, "a saving-disabled board issues no save");
  equal(session.requests.includes("listBlobs"), false, "the picker is not opened at all");
  equal(state.menu.screens.length, 1, "the menu stays open");
});

test("Save overwrites and Load requests the same listed save path", () => {
  const session = boot({ startup: "mainmenu()\n" });
  session.pump((current) => current.menu.screens.length === 1);
  for (const key of ["DOWN", "DOWN", "DOWN", "ENTER"]) press(session, key);
  ok(session.requests.includes("listBlobs"), "the picker reads the save area");
  session.pump(() => session.saves.length === 1, "ENTER");
  const savedPath = session.saves[0]!;
  ok(/^[^/]+\/saved\/slot1\.sav$/.test(savedPath), `overwrite path: ${savedPath}`);
  for (const key of ["DOWN", "ENTER", "ENTER"]) press(session, key);
  deepEqual(session.loads, [savedPath], "Load requests the same path Save overwrote");
  deepEqual(session.diagnostics, []);
});

test("Load lists the save area and requests the chosen save", () => {
  const session = boot({ startup: "mainmenu()\n" });
  session.pump((current) => current.menu.screens.length === 1);
  for (const key of ["UP", "UP", "ENTER"]) press(session, key);
  ok(session.requests.includes("listBlobs"), "Load lists the save area");
  press(session, "ENTER");
  equal(session.loads.length, 1, "Load reads one selected save");
  ok(session.loads[0]!.endsWith("/slot1.sav"), `selected save: ${session.loads[0]}`);
  equal(session.saves.length, 0);
});

test("dirsav can be entered directly and returns the selected base name", () => {
  const session = boot({ startup: 'choice = dirsav("Load", 0, 0, 0, "")\n' });
  session.pump((state) => session.requests.includes("listBlobs") && state.vm.threads.some((thread) => thread.wait?.kind === "input.key"));
  const state = press(session, "ENTER");
  equal(state.vm.globals.choice, "slot1");
  deepEqual(session.diagnostics, []);
});

test("MenuGraphic is stored on the menu section and drawn by the screen", () => {
  const session = boot({ startup: 'menugraphic("layout.png")\nmainmenu()\n' });
  const state = session.pump((current) => current.menu.screens.length === 1);
  equal(state.menu.graphic, "layout.png", "menugraphic writes the menu section through its owner");
  const entry = state.surfaces.entries[String(state.surfaces.renderNow)];
  ok(entry, "the render-now surface exists");
  const surface = session.engine.surfacePixels(entry.id, entry.rev);
  ok(surface, "the drawn menu pixels are available");
  const offset = (15 * 320 + 15) * 4;
  deepEqual([...surface.rgba.subarray(offset, offset + 4)], [200, 40, 40, 255], "the custom image is drawn behind the rows");
});

for (const [label, reference, detail] of [
  ["a graphic that is not in the asset index", "absent.png", "is not in the asset index"],
  ["a graphic the host cannot supply bytes for", "ghost.png", "asset not found"],
] as const) {
  test(`a named MenuGraphic that is ${label} reports one diagnostic and the engine keeps running`, () => {
    const session = boot({ startup: `menugraphic("${reference}")\nmainmenu()\n` });
    session.pump((current) => current.menu.screens.length === 1);
    // Every key redraws the panel, so a diagnostic per draw would show here.
    press(session, "DOWN");
    const state = press(session, "DOWN");
    equal(state.menu.screens[0]!.selection, 2, "the menu still takes input after the failed picture");
    equal(state.engine.boot?.stage, "running", "the engine did not stop");
    ok(state.engine.failed !== true, "the engine did not fail");
    const missing = session.diagnostics.filter((entry) => entry.startsWith("asset.missing"));
    equal(missing.length, 1, session.diagnostics.join("; "));
    ok(missing[0]!.includes(detail), missing[0]);
    equal(session.diagnostics.length, 1, "nothing else is reported");
  });
}

test("Quit closes the screen and sends the normal host request", () => {
  const session = boot({ startup: "mainmenu()\n" });
  session.pump((state) => state.menu.screens.length === 1);
  press(session, "UP");
  const state = press(session, "ENTER");
  equal(state.menu.screens.length, 0);
  session.pump(() => session.requests.includes("quit"));
  equal(session.requests.filter((kind) => kind === "quit").length, 1);
});

/** The files the `ui` track has started, most recent last. */
function uiFiles(state: GameState): string[] {
  const track = state.audio.tracks.find((candidate) => candidate.name === "ui");
  if (track === undefined) return [];
  return track.voices.flatMap((voice) => (voice.state === "playing" ? [voice.file as string] : []));
}

test("a cursor move plays the main file's move sound on the ui track, and no name is silent", () => {
  const loud = boot({ startup: "mainmenu()\n", sounds: true });
  loud.pump((state) => state.menu.screens.length === 1);
  const loudState = press(loud, "DOWN");
  ok(uiFiles(loudState).includes(assetKey("media/move.wav")), `the move cue plays: ${uiFiles(loudState).join(",")}`);

  const silent = boot({ startup: "mainmenu()\n" });
  silent.pump((state) => state.menu.screens.length === 1);
  const silentState = press(silent, "DOWN");
  deepEqual(uiFiles(silentState), [], "without a main-file name the move is silent");
});

test("confirm and cancel play their configured ui cues", () => {
  const session = boot({ startup: "mainmenu()\n", sounds: true });
  session.pump((state) => state.menu.screens.length === 1);
  ok(uiFiles(press(session, "ENTER")).includes(assetKey("media/confirm.wav")), "confirm plays its cue");
  ok(uiFiles(press(session, "ESC")).includes(assetKey("media/cancel.wav")), "cancel plays its cue");
});

test("the same input log replays to the same draw list and state hash", () => {
  const runOnce = (first: string): { readonly draw: string; readonly pixels: string; readonly hash: string } => {
    const session = boot({ startup: "mainmenu()\n", sounds: true });
    let state = session.pump((current) => current.menu.screens.length === 1);
    state = press(session, first);
    const entry = state.surfaces.entries[String(state.surfaces.renderNow)];
    ok(entry);
    const surface = session.engine.surfacePixels(entry.id, entry.rev);
    ok(surface);
    return { draw: hashDrawList(session.engine.drawList()), pixels: fnv1a64(surface.rgba), hash: hashState(state) };
  };
  deepEqual(runOnce("DOWN"), runOnce("DOWN"), "two runs of one input log agree");
});
