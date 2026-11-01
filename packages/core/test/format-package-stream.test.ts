// The pieces a host uses to validate a package it cannot hold whole (issue #934): the windowed directory readers, the
// per-entry local-header check, the chunked entry decoder, and the identity and manifest functions split so a host can
// fold them one file at a time. Each is held to the whole-memory path: a package read piece by piece must be accepted
// and refused exactly as `readZip` accepts and refuses it, with the same rules and the same values.
import { test } from "node:test";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { TextEncoder } from "node:util";
import { deflateSync } from "fflate/browser";
import {
  checkZipLocalHeader,
  createZipEntryDecoder,
  deriveGameId,
  deriveGameIdFromContentHash,
  derivePackageIdentity,
  err,
  fnv1a64,
  foldPackageIdentity,
  loadPackage,
  locateZipDirectory,
  ok as success,
  packageIdentityRecord,
  readDistributionManifest,
  readDistributionManifestFrom,
  readZipDirectory,
  writeDistributionPackage,
  zipLocalHeaderBytesNeeded,
  zipTailRange,
  ZIP_LOCAL_HEADER_BYTES,
} from "../src/index.ts";
import type { FormatError, PackageFile, Result, ZipEntry } from "../src/index.ts";

const encoder = new TextEncoder();

function bytesOf(text: string): Uint8Array {
  return encoder.encode(text);
}

/** A deterministic byte stream (xorshift32); a small `alphabet` makes it compressible. */
function noise(length: number, seed: number, alphabet = 256, base = 0): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = seed >>> 0 || 1;
  for (let index = 0; index < length; index += 1) {
    let next = state;
    next ^= next << 13;
    next ^= next >>> 17;
    next ^= next << 5;
    state = next >>> 0;
    bytes[index] = base + ((state >>> 8) % alphabet);
  }
  return bytes;
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error.message}`);
  return result.value;
}

function pack(files: readonly PackageFile[], main: string): Uint8Array {
  return unwrap(
    writeDistributionPackage({ files, manifest: { schema: 1, main, index: files.map((file) => file.path) } }),
  );
}

/**
 * Read a package the way a host that holds only windows of it does: the archive's tail, then its central directory,
 * then each entry's header and data in `chunk`-byte pieces — handing `core` nothing it could not have fetched by range.
 */
function readInPieces(bytes: Uint8Array, chunk: number): Result<readonly PackageFile[]> {
  const tailRange = zipTailRange(bytes.length);
  const located = locateZipDirectory(bytes.slice(tailRange.start, tailRange.end), bytes.length, "pieces.tpk");
  if (!located.ok) return located;
  const directory = readZipDirectory(bytes.slice(located.value.cdOffset), located.value, bytes.length, "pieces.tpk");
  if (!directory.ok) return directory;
  const files: PackageFile[] = [];
  for (const entry of directory.value) {
    if (entry.directory) continue;
    const fixed = bytes.slice(entry.localOffset, Math.min(entry.localOffset + ZIP_LOCAL_HEADER_BYTES, bytes.length));
    const header = bytes.slice(entry.localOffset, Math.min(entry.localOffset + zipLocalHeaderBytesNeeded(fixed), bytes.length));
    const checked = checkZipLocalHeader(entry, header, bytes.length);
    if (!checked.ok) return checked;
    const decoder = createZipEntryDecoder(entry);
    if (!decoder.ok) return decoder;
    const data = bytes.slice(checked.value, checked.value + entry.compressedSize);
    let failure: FormatError | null = null;
    if (data.length === 0) failure = decoder.value.push(data, true);
    for (let at = 0; at < data.length && failure === null; at += chunk) {
      failure = decoder.value.push(data.slice(at, at + chunk), at + chunk >= data.length);
    }
    if (failure !== null) return err(failure);
    const finished = decoder.value.finish();
    if (!finished.ok) return finished;
    files.push({ path: entry.path, bytes: finished.value });
  }
  return success(files);
}

const FILES: readonly PackageFile[] = [
  { path: "Boards/a.brd", bytes: noise(60_000, 3, 12, 65) },
  { path: "Main/game.gam", bytes: bytesOf("main") },
  { path: "Media/big.mid", bytes: noise(90_000, 7) },
  { path: "Media/empty.dat", bytes: new Uint8Array(0) },
  { path: "Tiles/set.tst", bytes: bytesOf("tiles") },
];

test("a package read by windows and chunks yields exactly the files readZip yields, whatever the chunking", () => {
  const bytes = pack(FILES, "Main/game.gam");
  ok(bytes.length > 65_557 + 20, "the archive is longer than the tail window, so the tail is a strict suffix");
  const whole = unwrap(loadPackage({ kind: "tpk", name: "whole.tpk", bytes }));
  for (const chunk of [7, 1_000, 65_536, 1_000_000]) {
    const pieces = unwrap(readInPieces(bytes, chunk));
    deepEqual(
      pieces.map((file) => file.path),
      whole.files.map((file) => file.path),
      `chunk ${chunk}`,
    );
    for (const [index, file] of whole.files.entries()) {
      ok(pieces[index]?.bytes.length === file.bytes.length, `${file.path} at chunk ${chunk}`);
      deepEqual(pieces[index]?.bytes, file.bytes, `${file.path} at chunk ${chunk}`);
    }
  }
});

test("every one-byte corruption is accepted or refused by the piecewise reader exactly as readZip does", () => {
  const bytes = pack(
    [
      { path: "Data/a.txt", bytes: bytesOf("a small text file, deflate may or may not shrink it") },
      { path: "Data/b.bin", bytes: noise(90, 11) },
      { path: "Main/game.gam", bytes: bytesOf("main") },
    ],
    "Main/game.gam",
  );
  let accepted = 0;
  for (let at = 0; at < bytes.length; at += 1) {
    const corrupt = bytes.slice();
    corrupt[at] = (corrupt[at] ?? 0) ^ 0xff;
    const whole = loadPackage({ kind: "tpk", name: "whole.tpk", bytes: corrupt });
    const pieces = readInPieces(corrupt, 5);
    equal(pieces.ok, whole.ok, `corrupting byte ${at}`);
    if (pieces.ok && whole.ok) {
      accepted += 1;
      deepEqual(pieces.value, whole.value.files, `corrupting byte ${at}`);
    } else if (!pieces.ok && !whole.ok) {
      equal(pieces.error.section, whole.error.section);
    }
  }
  ok(accepted > 0 && accepted < bytes.length);
});

test("an end-of-central-directory record whose two entry counts disagree is refused (L19), not left to fflate", () => {
  const bytes = pack(FILES, "Main/game.gam").slice();
  // The end record is the last 22 bytes (this writer writes no comment): the this-disk count sits 8 bytes in.
  const record = bytes.length - 22;
  bytes[record + 8] = (bytes[record + 8] ?? 0) - 1;
  const whole = loadPackage({ kind: "tpk", name: "whole.tpk", bytes });
  equal(whole.ok, false);
  const pieces = readInPieces(bytes, 4096);
  equal(pieces.ok, false);
  if (!pieces.ok) {
    ok(pieces.error.message.includes("L19") && pieces.error.message.includes("one count"), pieces.error.message);
  }
});

test("a window of the wrong length is the caller's bug and throws; a directory is not decodable", () => {
  const bytes = pack(FILES, "Main/game.gam");
  throws(() => locateZipDirectory(bytes.slice(0, 10), bytes.length, "x.tpk"), TypeError);
  const tail = zipTailRange(bytes.length);
  const located = unwrap(locateZipDirectory(bytes.slice(tail.start, tail.end), bytes.length, "x.tpk"));
  throws(() => readZipDirectory(bytes.slice(located.cdOffset + 1), located, bytes.length, "x.tpk"), TypeError);
  const directoryEntry: ZipEntry = {
    storedName: "d/",
    path: "d/",
    directory: true,
    method: 0,
    flags: 0,
    crc: 0,
    compressedSize: 0,
    uncompressedSize: 0,
    localOffset: 0,
  };
  throws(() => createZipEntryDecoder(directoryEntry), TypeError);
});

test("the decoder stops at the first byte past the declaration, and a stream that lies is the same L17 rule readZip names", () => {
  const payload = new Uint8Array(10_000);
  const compressed = deflateSync(payload);
  const entry: ZipEntry = {
    storedName: "lie.bin",
    path: "lie.bin",
    directory: false,
    method: 8,
    flags: 0,
    crc: 0,
    compressedSize: compressed.length,
    uncompressedSize: 1000,
    localOffset: 0,
  };
  const decoder = unwrap(createZipEntryDecoder(entry));
  const failure = decoder.push(compressed, true);
  ok(failure !== null && failure.message.includes("L17") && failure.message.includes("inflates to 1001 bytes"), String(failure?.message));
  equal(decoder.push(new Uint8Array(0), true), failure, "a failed decoder answers the same failure");
  const finished = decoder.finish();
  ok(!finished.ok && finished.error === failure);

  // A stream shorter than its declaration is also L17, named with the length it really holds.
  const shortEntry: ZipEntry = { ...entry, uncompressedSize: 20_000 };
  const shorter = unwrap(createZipEntryDecoder(shortEntry));
  equal(shorter.push(compressed, true), null);
  const result = shorter.finish();
  ok(!result.ok && result.error.message.includes("inflates to 10000 bytes but its header declares 20000"), JSON.stringify(result));

  // A stored entry's two sizes must agree, and its CRC-32 must be the header's (L18).
  const stored: ZipEntry = { ...entry, method: 0, compressedSize: 5, uncompressedSize: 6 };
  const mismatch = createZipEntryDecoder(stored);
  ok(!mismatch.ok && mismatch.error.message.includes("L17"));
  const crcEntry: ZipEntry = { ...entry, method: 0, compressedSize: 3, uncompressedSize: 3, crc: 1 };
  const crcDecoder = unwrap(createZipEntryDecoder(crcEntry));
  equal(crcDecoder.push(bytesOf("abc"), true), null);
  const crcResult = crcDecoder.finish();
  ok(!crcResult.ok && crcResult.error.message.includes("L18"));

  // More data than the header's compressed size is the host's bug.
  const overfed = unwrap(createZipEntryDecoder({ ...crcEntry, crc: 0x352441c2 }));
  throws(() => overfed.push(bytesOf("abcd"), true), RangeError);
});

test("a decoded entry is a fresh array, and an empty entry decodes to an empty one", () => {
  const empty: ZipEntry = {
    storedName: "e.dat",
    path: "e.dat",
    directory: false,
    method: 0,
    flags: 0,
    crc: 0,
    compressedSize: 0,
    uncompressedSize: 0,
    localOffset: 0,
  };
  const decoder = unwrap(createZipEntryDecoder(empty));
  equal(decoder.push(new Uint8Array(0), true), null);
  const done = unwrap(decoder.finish());
  equal(done.length, 0);

  const given = bytesOf("abc");
  const entry: ZipEntry = { ...empty, compressedSize: 3, uncompressedSize: 3, crc: 0x352441c2 };
  const text = unwrap(createZipEntryDecoder(entry));
  text.push(given, true);
  const out = unwrap(text.finish());
  deepEqual(out, given);
  ok(out !== given && out.buffer !== given.buffer);
});

test("the package identity folds from per-file records exactly as derivePackageIdentity derives it, in any order", () => {
  const files = FILES.filter((file) => file.path !== "Main/game.gam");
  const whole = derivePackageIdentity(files);
  const records = files.map((file) => packageIdentityRecord(file.path, fnv1a64(file.bytes)));
  equal(foldPackageIdentity(records), whole);
  equal(foldPackageIdentity([...records].reverse()), whole);
  equal(foldPackageIdentity([]), derivePackageIdentity([]));
  ok(foldPackageIdentity(records.slice(1)) !== whole);

  const main = bytesOf("main");
  equal(deriveGameIdFromContentHash(fnv1a64(main), whole), deriveGameId(main, whole));
  throws(() => deriveGameIdFromContentHash(fnv1a64(main), ""), TypeError);
  throws(() => deriveGameId(main, ""), TypeError);
});

test("the manifest reads from its bytes and the file paths exactly as it reads from a loaded package", () => {
  const bytes = pack(FILES, "Main/game.gam");
  const loaded = unwrap(loadPackage({ kind: "tpk", name: "m.tpk", bytes }));
  const paths = loaded.files.map((file) => file.path);
  const manifestBytes = loaded.files.find((file) => file.path === "manifest.json")?.bytes;
  deepEqual(readDistributionManifestFrom("m.tpk", manifestBytes, paths), readDistributionManifest(loaded));

  // The refusals say the same thing from either side.
  const withoutManifest = { ...loaded, files: loaded.files.filter((file) => file.path !== "manifest.json") };
  const missing = readDistributionManifest(withoutManifest);
  deepEqual(
    readDistributionManifestFrom("m.tpk", undefined, withoutManifest.files.map((file) => file.path)),
    missing,
  );
  ok(!missing.ok && missing.error.message.includes("has no manifest.json"));

  const unlisted = readDistributionManifestFrom("m.tpk", manifestBytes, [...paths, "Extra/new.bin"]);
  ok(!unlisted.ok && unlisted.error.message.includes("every file must be indexed"), JSON.stringify(unlisted));
  const garbled = readDistributionManifestFrom("m.tpk", bytesOf("{not json"), paths);
  ok(!garbled.ok && garbled.error.message.includes("not valid UTF-8 JSON"));
});
