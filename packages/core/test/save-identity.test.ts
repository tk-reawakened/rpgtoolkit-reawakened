// AD-17 (`_bmad-output/…/architecture-rpgtoolkit-reawakened.md`, "Host boundary,
// saves and sandbox"): `GameId` is derived in core as a hash of the main file
// plus the package identity, and is the save-area key in every host. The host
// supplies the identity — there is no fallback — so these tests pin the canonical
// derivation, the encoding's injectivity, the isolation properties, the explicit
// refusal when no identity exists, and stability across reset and load.
import { deepEqual, equal, ok } from "node:assert/strict";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  deriveGameId,
  derivePackageIdentity,
  PACKAGE_ROOT,
  writeBoard,
  writeMainFile,
  type AssetKey,
  type InputRecord,
} from "../src/index.ts";

const encoder = new TextEncoder();

type Files = Map<AssetKey, Uint8Array>;

/** A main file whose `start.prg` saves and ends, so boot parks on `saveBlob`. */
function savingMain(initBoard: string, projectPath = ""): Uint8Array {
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    projectPath,
    startupPrg: "start.prg",
    initBoard,
  };
  const written = writeMainFile(main);
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

function board(ambientRed: number): Uint8Array {
  const empty = createEmptyBoard();
  const written = writeBoard({ ...empty, properties: { ...empty.properties, ambient: { r: ambientRed, g: 0, b: 0 }, start: { x: 32, y: 32, layer: 1 } } });
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

/** Boot the real engine and return the save-area path the `Save("slot")` call used. */
function savePathFor(main: Uint8Array, extra: Files, paths: readonly string[], gameIdentity: string): string {
  const files: Files = new Map(extra);
  files.set(assetKey("main.gam"), main);
  const engine = createEngine({
    seed: 3,
    assetIndex: createAssetIndex([...paths]),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity,
    width: 64,
    height: 64,
    maxTicks: 100,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
  });
  let replies: InputRecord[] = [];
  for (let guard = 0; guard < 200; guard += 1) {
    const report = engine.advance(1, replies);
    replies = [];
    const save = report.requests.find((request) => request.kind === "saveBlob");
    if (save !== undefined) return save.blob.path;
    if (report.loading) {
      replies = report.requests.flatMap((request) => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
        : []);
    }
  }
  throw new Error("the engine never issued a saveBlob request");
}

const START = encoder.encode('Save("slot")\nend()\n');
const PATHS = ["main.gam", "boards/start.brd", "prg/start.prg"];

test("the package identity hashes sorted path/content records injectively", () => {
  const a = new Uint8Array([1]);
  const b = new Uint8Array([2]);
  const one = derivePackageIdentity([{ path: "Boards/a.brd", bytes: a }, { path: "Prg/b.prg", bytes: b }]);
  equal(derivePackageIdentity([{ path: "Boards/a.brd", bytes: a }, { path: "Prg/b.prg", bytes: b }]), one, "stable for equal input");
  equal(
    derivePackageIdentity([{ path: "Prg/b.prg", bytes: b }, { path: "Boards/a.brd", bytes: a }]),
    one,
    "archive order does not change the identity",
  );
  ok(derivePackageIdentity([{ path: "Boards/a.brd", bytes: b }, { path: "Prg/b.prg", bytes: a }]) !== one, "swapped contents differ");
  ok(derivePackageIdentity([{ path: "Boards/a.brd", bytes: a }, { path: "Prg/b.prg", bytes: b }, { path: "Media/c.mid", bytes: a }]) !== one, "an extra file differs");

  // Length-prefixed fields: the boundary between path and content cannot be moved.
  ok(
    derivePackageIdentity([{ path: "ab", bytes: a }, { path: "c", bytes: a }]) !==
      derivePackageIdentity([{ path: "a", bytes: a }, { path: "bc", bytes: a }]),
    "re-splitting a path at a different point is a different package",
  );
});

test("the GameId folds the host identity with the main-file bytes", () => {
  const main = savingMain("start.brd");
  const same = deriveGameId(main, "demo");
  equal(deriveGameId(new Uint8Array(main), "demo"), same, "equal inputs give equal ids");
  ok(deriveGameId(main, "demo2") !== same, "a different host identity differs");
  ok(deriveGameId(savingMain("start.brd", "elsewhere"), "demo") !== same, "different main bytes differ");
  ok(deriveGameId(main, "dem") !== deriveGameId(main, "demo"), "a prefix identity differs");
});

test("same main-file path and different bytes save into different areas", () => {
  const extra: Files = new Map([
    [assetKey("boards/start.brd"), board(0)],
    [assetKey("prg/start.prg"), START],
  ]);
  const first = savePathFor(savingMain("start.brd"), extra, PATHS, "demo");
  const second = savePathFor(savingMain("start.brd", "elsewhere"), extra, PATHS, "demo");
  ok((first) !== (second), "the main bytes separate the areas");
  equal(first, `${deriveGameId(savingMain("start.brd"), "demo")}/saved/slot.sav`);
  ok(first !== "main.gam/saved/slot.sav", "the area is the derived GameId, never the asset path");
});

test("two packages with identical paths and main bytes but different contents save into different areas", () => {
  const main = savingMain("start.brd");
  const firstFiles = [
    { path: "main.gam", bytes: main },
    { path: "boards/start.brd", bytes: board(0) },
    { path: "prg/start.prg", bytes: START },
  ];
  const secondFiles = firstFiles.map((file) => file.path === "boards/start.brd" ? { ...file, bytes: board(1) } : file);
  const firstIdentity = derivePackageIdentity(firstFiles);
  const secondIdentity = derivePackageIdentity(secondFiles);
  ok((firstIdentity) !== (secondIdentity), "the package identity follows the contents");

  const extra = new Map<AssetKey, Uint8Array>(firstFiles.filter((file) => file.path !== "main.gam").map((file) => [assetKey(file.path), file.bytes]));
  const first = savePathFor(main, extra, PATHS, firstIdentity);
  const second = savePathFor(main, extra, PATHS, secondIdentity);
  ok((first) !== (second), "the two packages get separate save areas");
});

test("a scene engine without a game identity refuses Save explicitly", () => {
  const engine = createEngine({
    seed: 5,
    assetIndex: createAssetIndex(["Boards/start.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "start.brd",
    width: 64,
    height: 64,
    maxTicks: 20,
    program: 'Save("slot")\nend()\n',
  });
  let replies: InputRecord[] = [];
  const diagnostics: { readonly code: string; readonly message: string }[] = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const report = engine.advance(4, replies);
    replies = [];
    diagnostics.push(...report.diagnostics);
    equal(report.requests.some((request) => request.kind === "saveBlob"), false, "no saveBlob request is ever issued");
    if (report.loading) {
      replies = report.requests.flatMap((request) => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: board(0) } }]
        : []);
    } else if (!report.loading && report.ticksRun === 0 && report.requests.length === 0) {
      break;
    }
  }
  const refusal = diagnostics.find((diagnostic) => diagnostic.code === "save.no-game-identity");
  ok(refusal !== undefined, "the refusal is a located diagnostic");
  ok(refusal.message.includes("docs/spec/formats/save-game.md"), refusal.message);
});

test("a boot engine's save area is stable across reset and a load", () => {
  const main = savingMain("start.brd");
  const gameIdentity = "stable-game";
  const files: Files = new Map([
    [assetKey("main.gam"), main],
    [assetKey("boards/start.brd"), board(0)],
    [assetKey("prg/start.prg"), START],
  ]);
  const saved: string[] = [];
  let resetPosted = false;
  const engine = createEngine({
    seed: 3,
    assetIndex: createAssetIndex(PATHS),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity,
    width: 64,
    height: 64,
    maxTicks: 100,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    // Post one `reset` after the first save; the restarted start-up program saves
    // again, so both save calls must land in the same area.
    phaseRegistrations: [{
      phase: "audio",
      run: (_state, post) => {
        if (resetPosted || saved.length === 0) return;
        resetPosted = true;
        post?.("engine", { thread: 0, name: "reset", kind: "state-write", args: [], out: {}, result: null, patch: null, wait: null, request: null });
      },
    }],
  });
  let replies: InputRecord[] = [];
  for (let guard = 0; guard < 400; guard += 1) {
    const report = engine.advance(1, replies);
    replies = [];
    for (const request of report.requests) {
      if (request.kind !== "saveBlob") continue;
      saved.push(request.blob.path);
      replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
    }
    if (saved.length === 2) break;
    if (report.loading && replies.length === 0) {
      replies = report.requests.flatMap((request): InputRecord[] => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
        : []);
    }
  }
  const expected = `${deriveGameId(main, gameIdentity)}/saved/slot.sav`;
  equal(saved.length, 2, "both Save calls reached the host");
  equal(saved[0], expected);
  equal(saved[1], expected, "a reset() does not move the save area");

  // Same main bytes and identity, with a start-up program that loads instead of saving.
  const loadFiles: Files = new Map([
    [assetKey("main.gam"), main],
    [assetKey("boards/start.brd"), board(0)],
    [assetKey("prg/start.prg"), encoder.encode('Load("slot")\nend()\n')],
  ]);
  const loading = createEngine({
    seed: 3,
    assetIndex: createAssetIndex(PATHS),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity,
    width: 64,
    height: 64,
    maxTicks: 100,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
  });
  let loadingReplies: InputRecord[] = [];
  const loadedPaths: string[] = [];
  for (let guard = 0; guard < 200 && loadedPaths.length === 0; guard += 1) {
    const report = loading.advance(1, loadingReplies);
    loadingReplies = [];
    for (const request of report.requests) {
      if (request.kind === "loadBlob") loadedPaths.push(request.blob.path);
    }
    if (report.loading) {
      loadingReplies = report.requests.flatMap((request): InputRecord[] => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: loadFiles.get(request.key) ?? null } }]
        : []);
    }
  }
  equal(loadedPaths.length, 1, "the loader issued one loadBlob");
  equal(loadedPaths[0], expected, "a load reads the same area");
});

test("a boot engine refuses to start when a caller omits the identity at runtime", () => {
  const main = savingMain("start.brd");
  const files: Files = new Map([
    [assetKey("main.gam"), main],
    [assetKey("boards/start.brd"), board(0)],
    [assetKey("prg/start.prg"), START],
  ]);
  // A JavaScript caller can omit a required field; the engine must fail loudly.
  const init = {
    seed: 3,
    assetIndex: createAssetIndex(PATHS),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    width: 64,
    height: 64,
    maxTicks: 20,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" as const }), restored: () => false },
    },
  };
  const engine = createEngine(init as unknown as Parameters<typeof createEngine>[0]);
  let replies: InputRecord[] = [];
  const diagnostics: { readonly code: string }[] = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const report = engine.advance(2, replies);
    replies = [];
    diagnostics.push(...report.diagnostics);
    if (report.loading) {
      replies = report.requests.flatMap((request) => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
        : []);
    }
  }
  equal(diagnostics.some((diagnostic) => diagnostic.code === "startup.no-game-identity"), true);
});
