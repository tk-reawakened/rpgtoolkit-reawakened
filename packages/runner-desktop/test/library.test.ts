import { deepEqual, equal, throws } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { deriveGameId, derivePackageIdentity, utf8Encode, writeDistributionPackage, writeZipArchive } from "@tk-reawakened/core";
import {
  emptyLibrary,
  installSetupBytes,
  libraryRows,
  parseLibrary,
  readLibraryFile,
  registerPackage,
  removeInstalledGame,
  sha256Of,
  verifyEntry,
  writeLibraryFile,
  type LibraryEntry,
} from "../src/library.ts";

const BYTES = new Uint8Array([1, 2, 3, 4, 5]);
const NOW = "2026-11-10T00:00:00.000Z";

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    gameId: "demo",
    title: "Demo",
    version: "1",
    sha256: sha256Of(BYTES),
    size: BYTES.length,
    packageLocation: "/games/demo.tpk",
    installedAt: NOW,
    lastPlayedAt: null,
    ...overrides,
  };
}

test("an empty registry and a well-formed one parse; a malformed one is refused with the field named", () => {
  deepEqual(parseLibrary({ schema: 1, defaultGameId: null, entries: [] }), { ok: true, registry: emptyLibrary() });

  const good = parseLibrary({ schema: 1, defaultGameId: "demo", entries: [entry()] });
  equal(good.ok, true);

  const wrongSchema = parseLibrary({ schema: 2, defaultGameId: null, entries: [] });
  deepEqual(wrongSchema.ok, false);
  equal(wrongSchema.ok ? "" : wrongSchema.error.includes("schema"), true);

  for (const [field, value] of [
    ["sha256", "not-a-hash"],
    ["size", -1],
    ["installedAt", "yesterday"],
    ["packageLocation", ""],
  ] as const) {
    const bad = parseLibrary({ schema: 1, defaultGameId: null, entries: [{ ...entry(), [field]: value }] });
    equal(bad.ok, false);
    equal(bad.ok ? "" : bad.error.includes(field), true);
  }

  const badPlayed = parseLibrary({ schema: 1, defaultGameId: null, entries: [{ ...entry(), lastPlayedAt: 7 }] });
  equal(badPlayed.ok, false);
  equal(badPlayed.ok ? "" : badPlayed.error.includes("lastPlayedAt"), true);
});

test("registering hashes the bytes and replaces the entry for the same game, keeping its install date", () => {
  const first = registerPackage({
    registry: emptyLibrary(),
    bytes: BYTES,
    descriptor: { sha256: sha256Of(BYTES), size: BYTES.length },
    packageLocation: "/games/demo.tpk",
    gameId: "demo",
    title: "Demo",
    version: "1",
    now: "2026-01-01T00:00:00.000Z",
  });
  equal(first.ok, true);
  if (!first.ok) return;
  equal(first.registry.entries.length, 1);
  equal(first.registry.entries[0]?.sha256, sha256Of(BYTES));

  const again = registerPackage({
    registry: first.registry,
    bytes: BYTES,
    descriptor: null,
    packageLocation: "/games/demo-v1.tpk",
    gameId: "demo",
    title: "Demo",
    version: "1",
    now: NOW,
  });
  equal(again.ok, true);
  if (!again.ok) return;
  equal(again.registry.entries.length, 1);
  equal(again.registry.entries[0]?.packageLocation, "/games/demo-v1.tpk");
  equal(again.registry.entries[0]?.installedAt, "2026-01-01T00:00:00.000Z");
});

test("a descriptor that disagrees with its package is refused, naming both values", () => {
  const wrongHash = registerPackage({
    registry: emptyLibrary(),
    bytes: BYTES,
    descriptor: { sha256: "0".repeat(64), size: BYTES.length },
    packageLocation: "/games/demo.tpk",
    gameId: "demo",
    title: "Demo",
    version: "1",
    now: NOW,
  });
  equal(wrongHash.ok, false);
  equal(wrongHash.ok ? "" : wrongHash.error.includes("descriptor's sha256"), true);

  const wrongSize = registerPackage({
    registry: emptyLibrary(),
    bytes: BYTES,
    descriptor: { size: 9 },
    packageLocation: "/games/demo.tpk",
    gameId: "demo",
    title: "Demo",
    version: "1",
    now: NOW,
  });
  equal(wrongSize.ok, false);
  equal(wrongSize.ok ? "" : wrongSize.error.includes("descriptor's size"), true);
});

test("verification refuses a truncated package and a swapped one", () => {
  deepEqual(verifyEntry(entry(), BYTES), { ok: true });

  const truncated = verifyEntry(entry(), BYTES.subarray(0, 4));
  equal(truncated.ok, false);
  equal(truncated.ok ? "" : truncated.reason.includes("size"), true);

  const swapped = verifyEntry(entry(), new Uint8Array([9, 9, 9, 9, 9]));
  equal(swapped.ok, false);
  equal(swapped.ok ? "" : swapped.reason.includes("sha256"), true);
});

test("the library file round-trips, is absent when unset, and a corrupt file is an error rather than an empty library", () => {
  const directory = mkdtempSync(join(tmpdir(), "tkr-library-"));
  try {
    const path = join(directory, "nested", "library.json");
    equal(readLibraryFile(path), null);

    const registry = {
      schema: 1 as const,
      defaultGameId: "demo",
      entries: [entry()],
    };
    writeLibraryFile(path, registry);
    deepEqual(readLibraryFile(path), registry);
    equal(readFileSync(path, "utf8").includes('"schema": 1'), true);
    equal(existsSync(`${path}.tmp`), false);

    writeFileSync(path, "{ not json }");
    throws(() => readLibraryFile(path));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the fallback listing carries no hashes or settings", () => {
  deepEqual(libraryRows({ schema: 1, defaultGameId: null, entries: [entry()] }), [
    { gameId: "demo", title: "Demo", version: "1", lastPlayedAt: null },
  ]);
});

test("a reviewed setup installs only its verified package and removes it without touching saves", () => {
  const userData = mkdtempSync(join(tmpdir(), "tkr-setup-recipient-"));
  try {
    const mainBytes = utf8Encode("authored game");
    const gameFiles = [{ path: "Main/demo.gam", bytes: mainBytes }];
    const game = writeDistributionPackage({
      files: gameFiles,
      manifest: { schema: 1, main: "Main/demo.gam", index: ["Main/demo.gam"] },
    });
    equal(game.ok, true);
    if (!game.ok) return;
    const gameId = deriveGameId(mainBytes, derivePackageIdentity(gameFiles));
    const descriptor = utf8Encode(JSON.stringify({
      schema: 1, file: "Demo.tpk", sha256: sha256Of(game.value), size: game.value.length,
      gameId, title: "Demo", version: "1.0",
    }));
    const setup = writeZipArchive([
      { path: "Demo.tpk", bytes: game.value },
      { path: "Demo.tpk.json", bytes: descriptor },
      { path: "README.txt", bytes: utf8Encode("Install from the player.") },
    ]);
    equal(setup.ok, true);
    if (!setup.ok) return;
    const save = join(userData, "saves", gameId, "slot.sav");
    mkdirSync(join(userData, "saves", gameId), { recursive: true });
    writeFileSync(save, new Uint8Array([9, 8, 7]));
    const installed = installSetupBytes({ bytes: setup.value, userData, now: NOW });
    equal(installed.ok, true);
    if (!installed.ok) return;
    equal(installed.gameId, gameId);
    const packagePath = join(userData, "games", `${gameId}.tpk`);
    const descriptorPath = `${packagePath}.json`;
    deepEqual(new Uint8Array(readFileSync(packagePath)), game.value);
    deepEqual(JSON.parse(readFileSync(descriptorPath, "utf8")), {
      schema: 1, file: `${gameId}.tpk`, sha256: sha256Of(game.value), size: game.value.length,
      gameId, title: "Demo", version: "1.0",
    });
    const entry = installed.registry.entries[0]!;
    equal(verifyEntry(entry, new Uint8Array(readFileSync(packagePath))).ok, true);
    const secondInstall = installSetupBytes({ bytes: setup.value, userData, now: NOW });
    equal(secondInstall.ok, true, "install is idempotent");
    const removed = removeInstalledGame({ userData, gameId });
    equal(removed.ok, true);
    if (!removed.ok) return;
    deepEqual(removed.registry.entries, []);
    equal(existsSync(packagePath), false);
    equal(existsSync(descriptorPath), false);
    deepEqual(new Uint8Array(readFileSync(save)), new Uint8Array([9, 8, 7]));
    const secondRemove = removeInstalledGame({ userData, gameId });
    equal(secondRemove.ok, true, "remove is idempotent");
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

/** A reviewed setup ZIP built the way the editor builds one: a package, its descriptor and README.txt. */
function reviewedSetup(mainText = "authored game") {
  const mainBytes = utf8Encode(mainText);
  const gameFiles = [{ path: "Main/demo.gam", bytes: mainBytes }];
  const game = writeDistributionPackage({
    files: gameFiles,
    manifest: { schema: 1, main: "Main/demo.gam", index: ["Main/demo.gam"] },
  });
  if (!game.ok) throw new Error(game.error.message);
  const gameId = deriveGameId(mainBytes, derivePackageIdentity(gameFiles));
  const descriptor = {
    schema: 1, file: "Demo.tpk", sha256: sha256Of(game.value), size: game.value.length,
    gameId, title: "Demo", version: "1.0",
  };
  const setup = writeZipArchive([
    { path: "Demo.tpk", bytes: game.value },
    { path: "Demo.tpk.json", bytes: utf8Encode(JSON.stringify(descriptor)) },
    { path: "README.txt", bytes: utf8Encode("Install from the player.") },
  ]);
  if (!setup.ok) throw new Error(setup.error.message);
  return { bytes: setup.value, gameId, packageBytes: game.value, descriptor };
}

const ownedStageEntries = (parent: string): string[] =>
  readdirSync(parent).filter((name) => /^\..+\.stage-|^\.install-|^\.remove-/.test(name));

/**
 * Append one directory entry to a valid ZIP, the way a producer other than this project's writer could. The writer
 * refuses directory entries, so this hostile archive is built here to prove the installer checks the central directory.
 */
function withDirectoryEntry(zip: Uint8Array, name: string): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  if (view.getUint32(eocd, true) !== 0x06054b50) throw new Error("the fixture ZIP has no end-of-central-directory record");
  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const nameBytes = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + nameBytes.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(6, 0x0800, true);
  localView.setUint16(10, 0, true);
  localView.setUint16(12, 0x0021, true);
  localView.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  const central = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(8, 0x0800, true);
  centralView.setUint16(14, 0x0021, true);
  centralView.setUint16(28, nameBytes.length, true);
  centralView.setUint32(38, 0x10, true);
  centralView.setUint32(42, cdOffset, true);
  central.set(nameBytes, 46);
  const out = new Uint8Array(zip.length + local.length + central.length);
  out.set(zip.subarray(0, cdOffset), 0);
  out.set(local, cdOffset);
  out.set(zip.subarray(cdOffset, cdOffset + cdSize), cdOffset + local.length);
  out.set(central, cdOffset + local.length + cdSize);
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const at = out.length - 22;
  out.set(zip.subarray(zip.length - 22), at);
  outView.setUint16(at + 8, total + 1, true);
  outView.setUint16(at + 10, total + 1, true);
  outView.setUint32(at + 12, cdSize + central.length, true);
  outView.setUint32(at + 16, cdOffset + local.length, true);
  return out;
}

test("install refuses an unreadable library rather than replacing it with an empty one", () => {
  const userData = mkdtempSync(join(tmpdir(), "tkr-setup-library-"));
  try {
    const { bytes } = reviewedSetup();
    const registryPath = join(userData, "library.json");
    mkdirSync(registryPath);
    writeFileSync(join(registryPath, "kept.bin"), "kept");
    const refused = installSetupBytes({ bytes, userData, now: NOW });
    equal(refused.ok, false);
    equal(refused.ok ? "" : refused.error.includes("game library is invalid"), true);
    equal(readFileSync(join(registryPath, "kept.bin"), "utf8"), "kept", "the unreadable registry is never replaced");
    equal(existsSync(join(userData, "games")), false, "nothing is installed when the registry cannot be read");

    const target = join(userData, "elsewhere.json");
    writeLibraryFile(target, { schema: 1, defaultGameId: null, entries: [] });
    const linked = join(userData, "linked");
    mkdirSync(linked);
    symlinkSync(target, join(linked, "library.json"));
    const throughLink = installSetupBytes({ bytes, userData: linked, now: NOW });
    equal(throughLink.ok, false, "a linked registry is not trusted as an empty library");
    equal(existsSync(join(linked, "games")), false);
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

test("install owns its staging paths, leaves an unrelated staging file intact, and cleans a partial registry write", () => {
  const userData = mkdtempSync(join(tmpdir(), "tkr-setup-stage-"));
  try {
    const { bytes, gameId, packageBytes } = reviewedSetup();
    const games = join(userData, "games");
    mkdirSync(games, { recursive: true });
    const foreignTmp = `${join(games, `${gameId}.tpk`)}.tmp`;
    writeFileSync(foreignTmp, "not ours");
    writeFileSync(join(userData, "library.json.tmp"), "also not ours");
    const installed = installSetupBytes({ bytes, userData, now: NOW });
    equal(installed.ok, true);
    if (!installed.ok) return;
    equal(readFileSync(foreignTmp, "utf8"), "not ours", "a fixed .tmp path is never truncated");
    equal(readFileSync(join(userData, "library.json.tmp"), "utf8"), "also not ours");

    const registryPath = join(userData, "library.json");
    const before = readFileSync(registryPath, "utf8");
    throws(
      () => writeLibraryFile(registryPath, { ...installed.registry, defaultGameId: gameId }, () => { throw new Error("disk full"); }),
      /disk full/,
      "a failed write reports the cause",
    );
    equal(readFileSync(registryPath, "utf8"), before, "the previous registry survives a partial write");
    deepEqual(ownedStageEntries(userData).filter((name) => name.startsWith(".library.json.stage-")), [], "no owned staging directory is left behind");
    deepEqual(ownedStageEntries(games), [], "no install staging directory is left behind");
    deepEqual(new Uint8Array(readFileSync(join(games, `${gameId}.tpk`))), packageBytes, "the installed package is intact");
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

test("removal restores the package and registry entry when the registry write fails", () => {
  const userData = mkdtempSync(join(tmpdir(), "tkr-setup-remove-"));
  try {
    const { bytes, gameId } = reviewedSetup();
    const installed = installSetupBytes({ bytes, userData, now: NOW });
    equal(installed.ok, true);
    const games = join(userData, "games");
    const packagePath = join(games, `${gameId}.tpk`);
    const descriptorPath = `${packagePath}.json`;
    const packageBytes = new Uint8Array(readFileSync(packagePath));
    const registryBefore = readFileSync(join(userData, "library.json"), "utf8");
    const failed = removeInstalledGame({ userData, gameId }, () => { throw new Error("disk full"); });
    equal(failed.ok, false);
    equal(failed.ok ? "" : failed.error.includes("disk full"), true);
    deepEqual(new Uint8Array(readFileSync(packagePath)), packageBytes, "the package copy is put back");
    equal(existsSync(descriptorPath), true, "the descriptor copy is put back");
    equal(readFileSync(join(userData, "library.json"), "utf8"), registryBefore, "the old row is still playable");
    deepEqual(ownedStageEntries(games), [], "no removal staging directory is left behind");
    equal(removeInstalledGame({ userData, gameId }).ok, true, "a retry removes the game");
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

test("an identical reinstall keeps the existing registration instead of resetting it", () => {
  const userData = mkdtempSync(join(tmpdir(), "tkr-setup-reinstall-"));
  try {
    const first = reviewedSetup("first game");
    const second = reviewedSetup("second game");
    const installed = installSetupBytes({ bytes: first.bytes, userData, now: NOW });
    const other = installSetupBytes({ bytes: second.bytes, userData, now: NOW });
    equal(installed.ok && other.ok, true);
    if (!installed.ok || !other.ok) return;
    const registryPath = join(userData, "library.json");
    const played = {
      ...other.registry,
      entries: other.registry.entries.map((entry) => entry.gameId === installed.gameId
        ? { ...entry, lastPlayedAt: "2026-11-20T10:00:00.000Z", customSettings: { volumeMaster: 0.5 } }
        : entry),
    };
    writeLibraryFile(registryPath, played);
    const again = installSetupBytes({ bytes: first.bytes, userData, now: "2026-12-01T00:00:00.000Z" });
    equal(again.ok, true);
    if (!again.ok) return;
    deepEqual(again.registry, played, "a byte-identical reinstall changes no library metadata or order");
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

test("setup install refuses extra paths, directory entries, and each tampered descriptor field", () => {
  const userData = mkdtempSync(join(tmpdir(), "tkr-setup-reject-"));
  try {
    const { bytes, packageBytes, descriptor } = reviewedSetup();
    const extra = writeZipArchive([
      { path: "Demo.tpk", bytes: packageBytes },
      { path: "Demo.tpk.json", bytes: utf8Encode(JSON.stringify(descriptor)) },
      { path: "README.txt", bytes: utf8Encode("help") },
      { path: "nested/escape.bin", bytes: utf8Encode("not extracted") },
    ]);
    equal(extra.ok, true);
    if (!extra.ok) return;
    const extraResult = installSetupBytes({ bytes: extra.value, userData, now: NOW });
    equal(extraResult.ok, false);
    equal(extraResult.ok ? "" : extraResult.error.includes("exactly"), true, "an extra path is refused by name");

    const directoryResult = installSetupBytes({ bytes: withDirectoryEntry(bytes, "unreviewed/"), userData, now: NOW });
    equal(directoryResult.ok, false);
    equal(directoryResult.ok ? "" : directoryResult.error.includes("no directory entries"), true, "the central directory is checked, not just decoded files");

    const tampered = (patch: Record<string, unknown>): Uint8Array => {
      const zip = writeZipArchive([
        { path: "Demo.tpk", bytes: packageBytes },
        { path: "Demo.tpk.json", bytes: utf8Encode(JSON.stringify({ ...descriptor, ...patch })) },
        { path: "README.txt", bytes: utf8Encode("help") },
      ]);
      if (!zip.ok) throw new Error(zip.error.message);
      return zip.value;
    };
    const wrongHash = installSetupBytes({ bytes: tampered({ sha256: "0".repeat(64) }), userData, now: NOW });
    equal(wrongHash.ok, false);
    equal(wrongHash.ok ? "" : wrongHash.error.includes("SHA-256"), true, "the digest is checked with the derived game id");
    const wrongSize = installSetupBytes({ bytes: tampered({ size: packageBytes.length + 1 }), userData, now: NOW });
    equal(wrongSize.ok, false);
    equal(wrongSize.ok ? "" : wrongSize.error.includes("size"), true, "the size is checked on its own");
    equal(existsSync(join(userData, "library.json")), false);
    equal(existsSync(join(userData, "games")), false, "no refused install writes anything");
    equal(installSetupBytes({ bytes, userData, now: NOW }).ok, true, "the untampered setup still installs");
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

test("a setup ZIP larger than the ZIP tail window still installs", () => {
  const userData = mkdtempSync(join(tmpdir(), "tkr-setup-large-"));
  try {
    // A deterministic high-entropy payload: neither the package nor the setup ZIP can compress it away.
    const payload = new Uint8Array(70 * 1024);
    let state = 0x2545f491;
    for (let index = 0; index < payload.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      payload[index] = state & 0xff;
    }
    const mainBytes = utf8Encode("large game");
    const gameFiles = [{ path: "Main/demo.gam", bytes: mainBytes }, { path: "Bitmap/noise.tbm", bytes: payload }];
    const game = writeDistributionPackage({
      files: gameFiles,
      manifest: { schema: 1, main: "Main/demo.gam", index: gameFiles.map(({ path }) => path) },
    });
    if (!game.ok) throw new Error(game.error.message);
    const gameId = deriveGameId(mainBytes, derivePackageIdentity(gameFiles));
    const descriptor = utf8Encode(JSON.stringify({
      schema: 1, file: "Large.tpk", sha256: sha256Of(game.value), size: game.value.length,
      gameId, title: "Large", version: "1.0",
    }));
    const setup = writeZipArchive([
      { path: "Large.tpk", bytes: game.value },
      { path: "Large.tpk.json", bytes: descriptor },
      { path: "README.txt", bytes: utf8Encode("Install from the player.") },
    ]);
    if (!setup.ok) throw new Error(setup.error.message);
    // Larger than the end-of-central-directory search window plus its ZIP64 margin: the locator must get the whole tail.
    equal(setup.value.length > 65_577, true, "the fixture must exceed the ZIP tail window");
    const installed = installSetupBytes({ bytes: setup.value, userData, now: NOW });
    equal(installed.ok, true, installed.ok ? "" : installed.error);
    equal(installed.ok ? installed.gameId : "", gameId);
    deepEqual(new Uint8Array(readFileSync(join(userData, "games", `${gameId}.tpk`))), game.value);
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});
