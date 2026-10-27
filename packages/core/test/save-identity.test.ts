// AD-17 (`_bmad-output/…/architecture-rpgtoolkit-reawakened.md`, "Host boundary,
// saves and sandbox"): `GameId` is derived in core as a hash of the main file
// plus the package identity, and is the save-area key in every host. These
// tests pin the derivation and prove the three isolation properties the rule
// exists for: a same-named main file with different bytes, a same-bytes package
// tree that differs, and stability across a `reset()`.
import { equal, notEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  deriveGameId,
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

function board(start: string): Uint8Array {
  const empty = createEmptyBoard();
  const written = writeBoard({ ...empty, properties: { ...empty.properties, start: { x: 32, y: 32, layer: 1 } }, start });
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

/** Boot the real engine and return the save area the `Save("slot")` call used. */
function savePathFor(main: Uint8Array, extra: Files, paths: readonly string[]): string {
  const files: Files = new Map(extra);
  files.set(assetKey("main.gam"), main);
  const engine = createEngine({
    seed: 3,
    assetIndex: createAssetIndex([...paths]),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
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

test("the GameId hashes the main file bytes and the package identity, deterministically", () => {
  const index = createAssetIndex(["main.gam", "boards/start.brd", "prg/start.prg"]);
  const main = savingMain("start.brd");
  const same = deriveGameId(main, PACKAGE_ROOT, index);
  equal(deriveGameId(main, PACKAGE_ROOT, index), same, "the same inputs derive the same id");
  equal(deriveGameId(new Uint8Array(main), PACKAGE_ROOT, index), same, "equal bytes derive the same id");

  const otherMain = savingMain("other.brd");
  notEqual(deriveGameId(otherMain, PACKAGE_ROOT, index), same, "different main bytes derive a different id");

  const otherTree = createAssetIndex(["main.gam", "boards/start.brd", "prg/start.prg", "media/extra.mid"]);
  notEqual(deriveGameId(main, PACKAGE_ROOT, otherTree), same, "a different package tree derives a different id");
  const reordered = createAssetIndex(["prg/start.prg", "boards/start.brd", "main.gam"]);
  equal(deriveGameId(main, PACKAGE_ROOT, reordered), same, "the package identity does not depend on the index order");

  notEqual(
    deriveGameId(main, { kind: "game", projectPath: "one" }, index),
    deriveGameId(main, { kind: "game", projectPath: "two" }, index),
    "two game folders with the same files are distinct games",
  );
});

test("two games with the same main-file path and different content save into different areas", () => {
  const paths = ["main.gam", "boards/start.brd", "prg/start.prg"];
  const extra: Files = new Map([
    [assetKey("boards/start.brd"), board("start")],
    [assetKey("prg/start.prg"), START],
  ]);
  const first = savePathFor(savingMain("start.brd"), extra, paths);
  const second = savePathFor(savingMain("start.brd", "elsewhere"), extra, paths);
  notEqual(first, second, "the main bytes carry the identity, not the main-file path");
  ok(first.endsWith("/saved/slot.sav") && second.endsWith("/saved/slot.sav"));
  ok(first !== "main.gam/saved/slot.sav", "the save area is the derived identity, not the asset path");
});

test("two packages carrying identical main bytes save into different areas", () => {
  const main = savingMain("start.brd");
  const extra: Files = new Map([
    [assetKey("boards/start.brd"), board("start")],
    [assetKey("prg/start.prg"), START],
  ]);
  const plain = savePathFor(main, extra, ["main.gam", "boards/start.brd", "prg/start.prg"]);
  const withMedia = savePathFor(main, extra, ["main.gam", "boards/start.brd", "prg/start.prg", "media/theme.mid"]);
  notEqual(plain, withMedia, "the package identity separates the two save areas");
});

test("reset keeps the game's save area", () => {
  const paths = ["main.gam", "boards/start.brd", "prg/start.prg"];
  const main = savingMain("start.brd");
  const files: Files = new Map([
    [assetKey("main.gam"), main],
    [assetKey("boards/start.brd"), board("start")],
    [assetKey("prg/start.prg"), encoder.encode('Save("slot")\nReset()\nSave("slot")\nend()\n')],
  ]);
  const engine = createEngine({
    seed: 3,
    assetIndex: createAssetIndex(paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    width: 64,
    height: 64,
    maxTicks: 100,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
  });
  const saved: string[] = [];
  let replies: InputRecord[] = [];
  for (let guard = 0; guard < 400; guard += 1) {
    const report = engine.advance(1, replies);
    replies = [];
    for (const request of report.requests) {
      if (request.kind === "saveBlob") saved.push(request.blob.path);
      if (request.kind === "saveBlob") replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
    }
    if (saved.length === 2) break;
    if (report.loading && replies.length === 0) {
      replies = report.requests.flatMap((request) => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
        : []);
    }
  }
  equal(saved.length, 2, "both Save calls reached the host");
  equal(saved[0], saved[1], "a reset() does not move the game's save area");
  equal(saved[0], `${deriveGameId(main, PACKAGE_ROOT, createAssetIndex(paths))}/saved/slot.sav`);
});
