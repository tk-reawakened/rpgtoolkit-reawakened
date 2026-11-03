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
  createEngine,
  hashDrawList,
  hashState,
  IR_VERSION,
  openMainMenu,
  PACKAGE_ROOT,
  writeBoard,
  writeCharacter,
  writeItem,
  writeMainFile,
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
    "Item/potion.itm", "Item/key.itm", "Bitmap/layout.png", "Media/move.wav", "Media/confirm.wav", "Media/cancel.wav",
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
    profilePicture: "layout.png",
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
    menuUseHp: 10,
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
  files.set(assetKey("bitmap/layout.png"), encodePng(1, 1, new Uint8Array([200, 40, 40, 255])));
  for (const name of ["move", "confirm", "cancel"]) files.set(assetKey(`media/${name}.wav`), waveBytes());
  files.set(assetKey("prg/start.prg"), new TextEncoder().encode(options.startup));
  return { files, index: createAssetIndex(paths), main: "main.gam" };
}

type Session = {
  readonly engine: Engine;
  state(): GameState;
  /** Advance until `until` holds, answering every host request with the authored game's files. */
  pump(until: (state: GameState) => boolean, key?: string, limit?: number): GameState;
  readonly requests: string[];
  readonly saves: string[];
};

function boot(options: GameOptions): Session {
  const game = authoredGame(options);
  let latest: GameState | null = null;
  const requests: string[] = [];
  const saves: string[] = [];
  const engine = createEngine({
    seed: 7,
    assetIndex: game.index,
    assetRoot: PACKAGE_ROOT,
    mainFile: game.main,
    gameIdentity: "stock-menu-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: 320,
    height: 240,
    maxTicks: 4000,
    packageCatalogue: catalogue(),
    bundled: BUNDLED,
    phaseRegistrations: [{ phase: "audio", run: (state) => { latest = state; } }],
  });
  const state = (): GameState => {
    if (latest === null) throw new Error("the engine has not advanced");
    return latest;
  };
  function answer(request: { readonly kind: string; readonly reqId: number; readonly key?: string }): InputEvent[] {
    requests.push(request.kind);
    if (request.kind === "asset") return [{ kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key as never) ?? null }];
    if (request.kind === "listBlobs") return [{ kind: "blob.listed", reqId: request.reqId, names: ["slot1.sav"] }];
    if (request.kind === "loadBlob") return [{ kind: "blob.loaded", reqId: request.reqId, bytes: null }];
    if (request.kind === "saveBlob") {
      saves.push("save");
      return [{ kind: "blob.saved", reqId: request.reqId, ok: true }];
    }
    return [];
  }
  function pump(until: (state: GameState) => boolean, key?: string, limit = 150): GameState {
    let replies: InputRecord[] = [];
    let queued = key;
    for (let step = 0; step < limit; step += 1) {
      const report = engine.advance(1, replies);
      const tick = report.tickAfter;
      replies = [];
      if (report.loading) {
        replies = report.requests.flatMap((request) => answer(request as never).map((event) => ({ tick, event })));
        step -= 1;
        continue;
      }
      if (queued !== undefined) {
        const code = queued === "ENTER" ? "Enter" : queued === "ESC" ? "Escape" : queued === "UP" ? "ArrowUp" : queued === "DOWN" ? "ArrowDown" : queued;
        replies.push(
          { tick, event: { kind: "key", name: queued, code, char: null, down: true } },
          { tick, event: { kind: "key", name: queued, code, char: null, down: false } },
        );
        queued = undefined;
      }
      if (until(state())) return state();
    }
    const current = latest;
    throw new Error(`the menu did not reach the expected state: screens=${JSON.stringify(current?.menu.screens ?? null)} threads=${(current?.vm.threads ?? []).map((thread) => `${thread.kind}:${thread.status}:${thread.wait?.kind ?? "-"}`).join(",")} requests=${requests.join(",")}`);
  }
  return { engine, state, pump, requests, saves };
}

/** Send one key on the next tick and let the screen handle it. */
function press(session: Session, key: string): GameState {
  const state = session.state();
  return session.pump((current) => current.time.tick > state.time.tick, key);
}

/** The overlay blit the menu contributes to the draw list (E-80 §4). */
function overlayBlits(engine: Engine): number {
  return engine.drawList().commands.filter((command) => command.kind === "blit" && "surface" in command.source).length;
}

test("the menu key opens the main screen and the menu key closes it", () => {
  const session = boot({ startup: "wait()\n" });
  session.pump((state) => state.vm.threads.some((thread) => thread.kind === "blocking"));
  ok(openMainMenu(session.state()), "the menu key starts the main screen");
  const opened = session.pump((state) => state.menu.screens.length === 1);
  equal(opened.menu.screens[0]!.screen, "main");
  ok(overlayBlits(session.engine) >= 1, "the screen is one overlay blit in the draw list");
  const closed = press(session, "ESC");
  equal(closed.menu.screens.length, 0, "cancel closes the outermost screen");
});

test("every screen opens directly through its facade and the compatibility index", () => {
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
    const session = boot({ startup });
    const state = session.pump((current) => current.menu.screens.length === 1);
    equal(state.menu.screens[0]!.screen, expected, `${startup.trim()} opens ${expected}`);
    ok(overlayBlits(session.engine) >= 1, `${expected} draws its overlay`);
    equal(press(session, "ESC").menu.screens.length, 0, `${expected} closes on cancel`);
  }
});

test("a key item cannot be dropped and an ordinary item is dropped once", () => {
  const session = boot({ startup: 'giveitem("key")\ngiveitem("potion")\nitemmenu()\n' });
  let state = session.pump((current) => current.menu.screens.length === 1);
  equal(state.inventory.items.length, 2);
  // Stack 1 is the key, stack 2 the potion. Confirm opens the action rows, two downs select Drop, confirm drops.
  for (const key of ["ENTER", "DOWN", "DOWN", "ENTER"]) state = press(session, key);
  equal(state.inventory.items.find((entry) => entry.handle === "Brass key")?.quantity, 1, "the key item is still carried");
  ok(session.requests.includes("asset"), "the refusal read the item definition first");
  // Back to the list, move to the potion, and drop it: one unit leaves the stack.
  for (const key of ["ESC", "DOWN", "ENTER", "DOWN", "DOWN", "ENTER"]) state = press(session, key);
  equal(state.inventory.items.find((entry) => entry.handle === "Potion"), undefined, "the potion stack is gone");
  equal(state.inventory.items.find((entry) => entry.handle === "Brass key")?.quantity, 1, "the key is untouched");
});

test("Save is gated by the board's disable-saving flag", () => {
  const session = boot({ startup: "mainmenu()\n", disableSaving: 1 });
  let state = session.pump((current) => current.menu.screens.length === 1);
  for (const key of ["DOWN", "DOWN", "DOWN", "ENTER"]) state = press(session, key);
  equal(session.requests.includes("saveBlob"), false, "a saving-disabled board issues no save");
  equal(session.requests.includes("listBlobs"), false, "the picker is not opened at all");
  equal(state.menu.screens.length, 1, "the menu stays open");
});

test("Save lists the save area and then writes the chosen slot", () => {
  const session = boot({ startup: "mainmenu()\n" });
  let state = session.pump((current) => current.menu.screens.length === 1);
  for (const key of ["DOWN", "DOWN", "DOWN", "ENTER"]) state = press(session, key);
  ok(session.requests.includes("listBlobs"), "the picker reads the save area");
  session.pump(() => session.saves.length === 1, "ENTER");
  equal(session.saves.length, 1, "the chosen slot is written once through the ordinary save path");
});

test("MenuGraphic is stored on the menu section and drawn by the screen", () => {
  const session = boot({ startup: 'menugraphic("layout.png")\nmainmenu()\n' });
  const state = session.pump((current) => current.menu.screens.length === 1);
  equal(state.menu.graphic, "layout.png", "menugraphic writes the menu section through its owner");
  ok(overlayBlits(session.engine) >= 1);
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

test("the same input log replays to the same draw list and state hash", () => {
  const runOnce = (): { readonly draw: string; readonly hash: string } => {
    const session = boot({ startup: "mainmenu()\n", sounds: true });
    let state = session.pump((current) => current.menu.screens.length === 1);
    for (const key of ["DOWN", "DOWN", "ENTER", "ESC", "ESC"]) state = press(session, key);
    return { draw: hashDrawList(session.engine.drawList()), hash: hashState(state) };
  };
  deepEqual(runOnce(), runOnce(), "two runs of one input log agree");
});
