import { deepEqual, equal, throws } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("setup install rejects extra paths and tampered descriptors before writing", () => {
  const userData = mkdtempSync(join(tmpdir(), "tkr-setup-reject-"));
  try {
    const packageBytes = writeDistributionPackage({
      files: [{ path: "Main/demo.gam", bytes: utf8Encode("game") }],
      manifest: { schema: 1, main: "Main/demo.gam", index: ["Main/demo.gam"] },
    });
    equal(packageBytes.ok, true);
    if (!packageBytes.ok) return;
    const descriptor = utf8Encode(JSON.stringify({
      schema: 1, file: "Demo.tpk", sha256: sha256Of(packageBytes.value), size: packageBytes.value.length,
      gameId: "demo", title: "Demo", version: "1",
    }));
    const extra = writeZipArchive([
      { path: "Demo.tpk", bytes: packageBytes.value },
      { path: "Demo.tpk.json", bytes: descriptor },
      { path: "README.txt", bytes: utf8Encode("help") },
      { path: "nested/escape.bin", bytes: utf8Encode("not extracted") },
    ]);
    equal(extra.ok, true);
    if (!extra.ok) return;
    equal(installSetupBytes({ bytes: extra.value, userData, now: NOW }).ok, false);
    const mismatch = writeZipArchive([
      { path: "Demo.tpk", bytes: packageBytes.value },
      { path: "Demo.tpk.json", bytes: utf8Encode(JSON.stringify({ schema: 1, file: "Demo.tpk", sha256: "0".repeat(64), size: packageBytes.value.length, gameId: "demo", title: "Demo", version: "1" })) },
      { path: "README.txt", bytes: utf8Encode("help") },
    ]);
    equal(mismatch.ok, true);
    if (!mismatch.ok) return;
    equal(installSetupBytes({ bytes: mismatch.value, userData, now: NOW }).ok, false);
    equal(existsSync(join(userData, "library.json")), false);
    equal(existsSync(join(userData, "games")), false);
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});
