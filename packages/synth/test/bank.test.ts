// The SoundFont layers and the bank cache (docs/spec/engine/audio-media.md#soundfont-layers, #soundfont-user-bank,
// #audio-soundfont-cache). The bank under test is the path that ships: `media/soundfonts/TK-16.sf2`, whose hash the
// notice records — so these tests also prove the notice and the file still agree.

import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { BankRef } from "../src/protocol.ts";
import {
  BANK_SIZE_CEILING,
  BUNDLED_BANK,
  BankCache,
  BankError,
  effectiveBank,
  isSoundBankContainer,
  sha256Hex,
  validateBankBytes,
  type BankLayers,
} from "../src/bank.ts";

const here = dirname(fileURLToPath(import.meta.url));
const bankPath = resolve(here, "..", "..", "..", "media", "soundfonts", "TK-16.sf2");
const bankBytes = new Uint8Array(readFileSync(bankPath));

const bundled: BankRef = { source: "bundled", id: "TK-16", sha256: "5419f02b0a9e63534b35332842e29decbc53c5352236be85b92cc87d0267f62a" };
const runner: BankRef = { source: "bundled", id: "runner-choice", sha256: null };
const author: BankRef = { source: "game", id: "media/game.sf2", sha256: null };
const player: BankRef = { source: "user", id: "player-bank", sha256: null };

test("the four ranks resolve in precedence order, and there is no fifth", () => {
  const all: BankLayers = { player, author, runner, bundled };
  deepEqual(effectiveBank(all), { rank: "player", bank: player });
  deepEqual(effectiveBank({ ...all, player: null }), { rank: "author", bank: author });
  deepEqual(effectiveBank({ ...all, player: null, author: null }), { rank: "runner", bank: runner });
  deepEqual(effectiveBank({ ...all, player: null, author: null, runner: null }), { rank: "bundled", bank: bundled });
  deepEqual(effectiveBank({ player: null, author: null, runner: null, bundled: null }), { rank: null, bank: null });
});

test("the bundled bank is TK-16 and its hash matches the file on disk", () => {
  equal(BUNDLED_BANK.id, "media/soundfonts/TK-16.sf2");
  equal(sha256Hex(bankBytes), BUNDLED_BANK.sha256, "the notice's SHA-256 is the file's");
  ok(isSoundBankContainer(bankBytes), "TK-16 is a RIFF sfbk container");
  equal(validateBankBytes(bankBytes), bankBytes);
});

test("the SHA-256 implementation matches the published vectors", () => {
  equal(sha256Hex(new Uint8Array(0)), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  equal(sha256Hex(new Uint8Array([0x61, 0x62, 0x63])), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  // A length that crosses the padding boundary: 56 bytes needs a second block.
  equal(sha256Hex(new Uint8Array(56)).length, 64);
});

test("a container that is not a bank is bank.invalid, and one over the ceiling is bank.unavailable", () => {
  const notABank = new Uint8Array(16);
  notABank.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF, but the type is not sfbk
  try {
    validateBankBytes(notABank);
    ok(false, "a non-sfbk container must be refused");
  } catch (error) {
    equal((error as BankError).code, "bank.invalid");
  }
  const oversized = new Uint8Array(BANK_SIZE_CEILING + 1);
  oversized.set(bankBytes.subarray(0, 12));
  try {
    validateBankBytes(oversized);
    ok(false, "an oversized bank must be refused");
  } catch (error) {
    equal((error as BankError).code, "bank.unavailable");
  }
  try {
    validateBankBytes(new Uint8Array(0));
    ok(false, "an empty bank must be refused");
  } catch (error) {
    equal((error as BankError).code, "bank.missing");
  }
});

test("a bank whose bytes do not match its declared hash is refused, not trusted", () => {
  const cache = new BankCache({ load: () => bankBytes });
  try {
    cache.acquire({ source: "bundled", id: "TK-16", sha256: "00".repeat(32) });
    ok(false, "a mismatched hash must be refused");
  } catch (error) {
    equal((error as BankError).code, "bank.invalid");
  }
});

test("two games naming the same bytes share one cache entry and one load", () => {
  const cache = new BankCache({ load: () => bankBytes });
  const first = cache.acquire(bundled);
  const second = cache.acquire({ source: "game", id: "media/copied.sf2", sha256: null });
  equal(first, second, "the same bytes are one entry");
  equal(cache.loads.length, 1, "the bank was loaded once");
  equal(cache.entries.length, 1);
  equal(cache.entries[0]?.users, 2, "both games hold it");
});

test("eviction never removes the bank in use", () => {
  const other = new Uint8Array(64);
  other.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x73, 0x66, 0x62, 0x6b]);
  const blobs = new Map<string, Uint8Array>([[`bundled:${bundled.id}`, bankBytes], ["bundled:other", other]]);
  const cache = new BankCache({ capacity: 1, load: (ref) => blobs.get(`${ref.source}:${ref.id}`) ?? null });

  const inUse = cache.acquire(bundled);
  ok(inUse.length > 0);
  // A second bank arrives while the first is pinned: the cache cannot grow by evicting the pinned one, so it keeps both.
  cache.acquire({ source: "bundled", id: "other", sha256: null });
  equal(cache.entries.length, 2, "the pinned bank stayed");
  deepEqual(cache.evictions, []);

  // Once the first is released, the next acquisition may evict the least recently used *unpinned* entry.
  cache.release(cache.entries[0]!.sha256);
  cache.acquire({ source: "bundled", id: "other", sha256: null });
  equal(cache.entries.some((entry) => entry.sha256 === BUNDLED_BANK.sha256), true, "released but still cached until pressure");
  cache.sweep();
  equal(cache.entries.some((entry) => entry.sha256 === BUNDLED_BANK.sha256), false, "a sweep drops what nobody holds");
});

test("an unreadable bank is bank.missing, never a silent fallback", () => {
  const cache = new BankCache({ load: () => null });
  try {
    cache.acquire(bundled);
    ok(false, "an unreadable bank must throw");
  } catch (error) {
    equal((error as BankError).code, "bank.missing");
  }
});
