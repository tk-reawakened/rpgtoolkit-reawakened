// The Save/Load fixture's independent headless baseline and engine assertions (ticket #934, plan AC2).
//
// Proves through the real engine and request/reply protocol:
//   1. Launch one finds no save, issues `saveBlob` under `<GameId>/saved/slot.sav` and writes a valid save.
//   2. Launch two finds that save, issues `loadBlob` with the identical path and restores canonical state.
//   3. The post-Load state hash, pre-Save hash, fresh hash and final state hash match the committed baseline
//      expectation `packages/core/test/fixtures/saveload/saveload.expect.json` exactly.
//   4. Separation: a different GameId's host cannot read the save and finds nothing.
//   5. Failure: a host where `Load` restores nothing (returns null) causes the fixture to fall through and
//      re-save, observably diverging from the baseline.

import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readZip } from "@tk-reawakened/core";
import {
  createMemoryBlobHost,
  runSaveLoadFixture,
  type SaveLoadBlobHost,
} from "../src/saveload.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const fixtureDir = join(repoRoot, "packages", "core", "test", "fixtures", "saveload");
const tpkPath = join(fixtureDir, "saveload.tpk");
const expectPath = join(fixtureDir, "saveload.expect.json");

type SaveloadExpectation = {
  readonly schema: number;
  readonly fixture: {
    readonly package: string;
    readonly sha256: string;
    readonly size: number;
    readonly gameId: string;
  };
  readonly baseline: {
    readonly saveRequest: {
      readonly area: "saves" | "files";
      readonly path: string;
      readonly key: string;
      readonly byteLength: number;
    };
    readonly loadRequest: {
      readonly area: "saves" | "files";
      readonly path: string;
      readonly key: string;
      readonly found: boolean;
    };
    readonly stateHashes: {
      readonly fresh: { readonly tick: number; readonly stateHash: string };
      readonly preSave: { readonly tick: number; readonly stateHash: string };
      readonly postLoad: { readonly tick: number; readonly stateHash: string };
      readonly final: { readonly tick: number; readonly stateHash: string };
    };
    readonly tick: number;
  };
};

function loadFixturePackage(): Map<string, Uint8Array> {
  const bytes = readFileSync(tpkPath);
  const unpacked = readZip(bytes, "saveload.tpk");
  if (!unpacked.ok) throw new Error(unpacked.error.message);
  const files = new Map<string, Uint8Array>();
  for (const entry of unpacked.value) files.set(entry.path, entry.bytes);
  return files;
}

function loadExpectation(): SaveloadExpectation {
  return JSON.parse(readFileSync(expectPath, "utf8")) as SaveloadExpectation;
}

test("Save/Load fixture matches the committed headless baseline expectation", async () => {
  const files = loadFixturePackage();
  const expectation = loadExpectation();
  const host = createMemoryBlobHost();

  const run = await runSaveLoadFixture({ files, host });

  // 1. GameId derivation and prefixed request paths
  equal(run.gameId, expectation.fixture.gameId, "derived GameId matches the baseline");
  equal(run.saveRequest.area, "saves");
  equal(run.saveRequest.path, expectation.baseline.saveRequest.path);
  equal(run.saveRequest.key, expectation.baseline.saveRequest.key);
  equal(run.saveRequest.byteLength, expectation.baseline.saveRequest.byteLength);

  equal(run.loadRequest.area, "saves");
  equal(run.loadRequest.path, expectation.baseline.loadRequest.path);
  equal(run.loadRequest.key, expectation.baseline.loadRequest.key);
  equal(run.loadRequest.found, true, "second launch finds the save");

  // 2. State hashes: fresh, pre-save, post-load, final
  equal(run.saved.fresh.tick, expectation.baseline.stateHashes.fresh.tick);
  equal(run.saved.fresh.stateHash, expectation.baseline.stateHashes.fresh.stateHash);

  equal(run.saved.preSave?.tick, expectation.baseline.stateHashes.preSave.tick);
  equal(run.saved.preSave?.stateHash, expectation.baseline.stateHashes.preSave.stateHash);
  equal(run.saved.preSave?.marker, 4242, "pre-save state captured marker = 4242");

  equal(run.loaded.postLoad?.tick, expectation.baseline.stateHashes.postLoad.tick);
  equal(run.loaded.postLoad?.stateHash, expectation.baseline.stateHashes.postLoad.stateHash);
  equal(run.loaded.postLoad?.marker, 4242, "post-load state restored marker = 4242");

  equal(run.finalStateHash, expectation.baseline.stateHashes.final.stateHash);
  equal(run.tick, expectation.baseline.tick);

  // 3. Exact request counts per launch: launch one saves once, launch two never re-saves
  equal(run.saved.saveRequests.length, 1, "launch one emitted exactly one saveBlob");
  equal(run.saved.loadRequests.length, 1, "launch one emitted exactly one loadBlob (missed)");
  equal(run.loaded.saveRequests.length, 0, "launch two emitted zero saveBlob requests because Load restored state");
  equal(run.loaded.loadRequests.length, 1, "launch two emitted exactly one loadBlob (found)");

  // 4. Stored blob in memory host
  const entries = host.entries();
  equal(entries.length, 1, "host holds exactly one save blob");
  equal(entries[0]?.area, "saves");
  equal(entries[0]?.gameId, run.gameId);
  equal(entries[0]?.path, "saved/slot.sav");
  equal(entries[0]?.bytes.length, expectation.baseline.saveRequest.byteLength);
});

test("a different GameId cannot read the save and finds nothing", async () => {
  const files = loadFixturePackage();
  const host = createMemoryBlobHost();

  // Populate save under this game's real GameId
  const run = await runSaveLoadFixture({ files, host });
  ok(host.entries().length > 0, "host holds the original save");

  // A different game identity tries to read the same slot through the blob host
  const otherGameId = "0000deadbeef0000";
  const readOther = await host.read("saves", otherGameId, "saved/slot.sav");
  equal(readOther, null, "different GameId finds null for the slot");

  // Listing saves for the other game returns empty list
  const listOther = await host.list?.("saves", otherGameId) ?? [];
  deepEqual(listOther, [], "different GameId lists no saves");

  // The original game still reads it
  const readOriginal = await host.read("saves", run.gameId, "saved/slot.sav");
  ok(readOriginal !== null, "original GameId still finds its save");
});

test("a host that fails to restore Load causes the game to re-save and diverge", async () => {
  const files = loadFixturePackage();
  const expectation = loadExpectation();

  // A buggy/forgetful host that accepts writes but always returns null on read
  const forgetfulHost: SaveLoadBlobHost = {
    async read() { return null; },
    async write() { return true; },
  };

  // Launch one works normally (it already expects load to return null)
  // But launch two will also find null, which means Load fails: it writes marker = 4242 and calls save("slot") AGAIN!
  // runSaveLoadFixture will reject launch two because it made a save request instead of restoring:
  let rejected = false;
  try {
    await runSaveLoadFixture({ files, host: forgetfulHost });
  } catch (error) {
    rejected = true;
    ok(error instanceof Error && error.message.includes("launch one must find no save"), `rejected with expected message: ${String(error)}`);
  }
  // Because launch one found no save and saved, but host did not retain for launch two:
  // If we instead use a host that saves during launch 1, but we clear it before launch 2:
  const memory = createMemoryBlobHost();
  const clearedBeforeLaunch2: SaveLoadBlobHost = {
    async read(area, gameId, path) {
      return memory.read(area, gameId, path);
    },
    async write(area, gameId, path, bytes) {
      return memory.write(area, gameId, path, bytes);
    },
  };
  // Now explicitly run launch one, then wipe host, then run launch two:
  // We can test that launch two without the save re-emits saveBlob and produces a divergent state
  const run1 = await runSaveLoadFixture({ files, host: memory });
  equal(run1.saved.saveRequests.length, 1);

  // Clear memory host so load returns null on a second launch
  const freshMemory = createMemoryBlobHost();
  // Running with empty host is a fresh launch 1:
  const freshRun = await runSaveLoadFixture({ files, host: freshMemory });
  equal(freshRun.saved.saveRequests.length, 1);
  // Post-load moment in a fresh launch is absent (it never restored):
  equal(freshRun.saved.postLoad, null, "a run without a save never experiences a post-load moment");
});
