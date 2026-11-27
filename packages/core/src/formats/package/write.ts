/**
 * Writing the project's own distribution package (docs/spec/formats/packaging-and-paths.md, AD-6).
 *
 * A distribution package is a `.tpk`-compatible ZIP — the same container the
 * reader in `zip.ts` accepts — holding the game files plus `manifest.json`
 * `{ schema, main, index }` at the archive root (AD-6). The manifest is the
 * package's descriptor, so a consumer can find the main file and know the asset
 * index without listing the archive:
 *
 * * `schema` — the project-level integer schema version (AD-23).
 * * `main` — the in-package path of the main file (the `.gam`, docs/spec/formats/README.md#paths-inside-files and docs/spec/formats/packaging-and-paths.md. A
 *   package ignores the main file's `projectPath` (AD-5), so this names the file
 *   rather than a game-folder root.
 * * `index` — the relative paths the resolver keys on (AD-5): every game file in
 *   the tree, once each, written in code-unit order rather than the caller's.
 *   `manifest.json` is the descriptor itself, so it is not part of the index the
 *   writer takes; the reader's index does list it, being built from every
 *   archive entry.
 *
 * The writer's contract is that a package it emits is always one the landed
 * reader (`readZip`) accepts: every entry carries a CRC-32, entries are ordered
 * deterministically so the same input is byte-identical (G3), a per-entry
 * compression method is chosen so the docs/spec/formats/packaging-and-paths.md limits hold (a highly compressible
 * entry is stored rather than emitting a ratio above L5), and the finished bytes
 * are read back through `readZip` before they are returned. Anything that would
 * breach a limit or the path rules is a located `FormatError` naming the rule
 * (AD-17, AD-18); nothing here throws.
 *
 * `fflate/browser` is the only runtime dependency (AD-6): the synchronous
 * `deflateSync` (compression) and `strToU8` (names and the manifest's UTF-8
 * bytes). The ZIP container is laid out here rather than by `fflate`'s `zipSync`,
 * because `zipSync` stamps a DOS timestamp from the local clock and time zone —
 * `Date`'s local getters, which G3 bans in `core`. Every field the writer emits
 * comes from the input alone, so two writes are byte-identical (G3).
 */

import { deflateSync, strToU8 } from "fflate/browser";
import { crc32 } from "../image/crc32.ts";
import { foldPath, toSlashes } from "../main-file/layout.ts";
import { err, ok, type FormatError, type Result } from "../result.ts";
import { PACKAGE_LIMITS } from "./limits.ts";
import {
  checkFilePath,
  checkIndex,
  checkManifest,
  MANIFEST_FILE_NAME,
  type DistributionManifest,
} from "./manifest.ts";
import { checkEntryPath } from "./path-rules.ts";
import { readZip } from "./zip.ts";
import type { PackageFile } from "./model.ts";

/** The format specification section every failure here cites. */
const SECTION = "docs/spec/formats/packaging-and-paths.md";

// The ZIP container's structure (PKZIP APPNOTE 4.3, docs/spec/formats/packaging-and-paths.md: the signatures the
// reader looks for, the two header sizes and the UTF-8 name flag. The writer
// emits the container itself rather than calling `fflate`'s `zipSync`, because
// `zipSync` stamps a DOS timestamp derived from the local clock and time zone
// (`Date`'s local getters), which G3 bans in `core`; these fixed fields are the
// ZIP epoch (1980-01-01 00:00:00), independent of any clock or zone.
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;
const VERSION_NEEDED = 20;
const FLAG_UTF8_NAME = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
/** 1980-01-01, in the DOS date packing the ZIP fields use. */
const DOS_DATE = 0x0021;
/** 00:00:00, in the DOS time packing the ZIP fields use. */
const DOS_TIME = 0x0000;

/** The deflate level used when an entry is compressed. */
const DEFLATE_LEVEL = 6;

/** The asset tree and manifest a distribution package is written from (AD-6). */
export interface DistributionInput {
  /** Every game file: its in-package relative path and its bytes (AD-6). */
  readonly files: readonly PackageFile[];
  /** The manifest written to `manifest.json` (AD-6). */
  readonly manifest: DistributionManifest;
}

/** A located failure citing docs/spec/formats/packaging-and-paths.md (AD-18). */
function failure(offset: number, message: string): FormatError {
  return { offset, section: SECTION, message };
}

/**
 * Compress one entry, returning the method and the body to write: deflate only
 * when it actually shrinks the entry *and* stays within the reader's
 * compression-ratio limit (L5), otherwise store it. A highly compressible entry
 * (say 200,000 zero bytes, which deflates far past 100:1) is therefore stored,
 * so the writer cannot emit a package its own reader would reject as a zip bomb.
 * One deflate per entry, reused as the body when it is chosen.
 */
function compress(bytes: Uint8Array): { method: number; body: Uint8Array } {
  if (bytes.length === 0) return { method: METHOD_STORED, body: bytes };
  const deflated = deflateSync(bytes, { level: DEFLATE_LEVEL });
  const ratio = Math.round(bytes.length / Math.max(deflated.length, 1));
  if (deflated.length < bytes.length && ratio <= PACKAGE_LIMITS.maxCompressionRatio) {
    return { method: METHOD_DEFLATE, body: deflated };
  }
  return { method: METHOD_STORED, body: bytes };
}

/** Whether two byte arrays hold the same bytes. */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Whether a read-back set of files matches the writer's, path for path. */
function sameTree(read: readonly PackageFile[], written: readonly PackageFile[]): boolean {
  if (read.length !== written.length) return false;
  for (let index = 0; index < written.length; index += 1) {
    const left = read[index] as PackageFile;
    const right = written[index] as PackageFile;
    if (left.path !== right.path || !sameBytes(left.bytes, right.bytes)) return false;
  }
  return true;
}

/** Write a little-endian 16-bit field at `at`. */
function putU16(target: Uint8Array, at: number, value: number): void {
  target[at] = value & 0xff;
  target[at + 1] = (value >>> 8) & 0xff;
}

/** Write a little-endian 32-bit field at `at`. */
function putU32(target: Uint8Array, at: number, value: number): void {
  target[at] = value & 0xff;
  target[at + 1] = (value >>> 8) & 0xff;
  target[at + 2] = (value >>> 16) & 0xff;
  target[at + 3] = (value >>> 24) & 0xff;
}

/** One entry as it will be laid out in the archive. */
interface PreparedEntry {
  readonly name: Uint8Array;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly body: Uint8Array;
  readonly size: number;
  readonly offset: number;
}

/**
 * Write already-ordered entries into a ZIP container (PKZIP APPNOTE 4.3, docs/spec/formats/packaging-and-paths.md:
 * a local header and body per entry, then the central directory, then the
 * end-of-central-directory record.
 *
 * The container is built here rather than by `fflate`'s `zipSync`, whose DOS
 * timestamp comes from the local clock and time zone and would make the bytes
 * depend on when and where they were written (G3). Every field is derived from
 * the input alone: the store/deflate choice keeps the reader's ratio limit (L5),
 * the CRC-32 is `formats/image/crc32.ts`'s, and the entries appear in the order
 * given (path order). The result is bounded by the reader's L1 limit, which is
 * checked as each entry is compressed: a tree over the limit is refused without
 * paying to compress whatever is left of it.
 */
function buildZip(entries: readonly PackageFile[]): Result<Uint8Array> {
  const names = entries.map((entry) => strToU8(entry.path));
  let centralBytes = 0;
  let headerBytes = 0;
  for (const name of names) {
    centralBytes += CENTRAL_HEADER_BYTES + name.length;
    headerBytes += LOCAL_HEADER_BYTES + name.length;
  }

  const prepared: PreparedEntry[] = [];
  let localBytes = 0;
  let headersSoFar = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as PackageFile;
    const name = names[index] as Uint8Array;
    const { method, body } = compress(entry.bytes);
    prepared.push({
      name,
      // fflate's own rule: flag bit 11 says the name is UTF-8; ASCII names need
      // no flag, and the reader decodes with the same rule, so names round-trip.
      flags: name.length === entry.path.length ? 0 : FLAG_UTF8_NAME,
      method,
      crc: crc32(entry.bytes),
      body,
      size: entry.bytes.length,
      offset: localBytes,
    });
    localBytes += LOCAL_HEADER_BYTES + name.length + body.length;
    headersSoFar += LOCAL_HEADER_BYTES + name.length;

    // The finished container's length is known from the headers alone, and this
    // is a lower bound on it: the entries compressed so far, the local headers
    // still to come, the whole central directory and the record. It never
    // over-states the finished size and is exact at the last entry, so checking
    // it here refuses a tree over the L1 limit at the entry that crosses it,
    // instead of after every entry has been compressed: the saving is the work of
    // the entries past the crossing (small for a tree of few large entries, large
    // for a tree of many), and the cost is one addition per entry.
    const lowerBound = localBytes + (headerBytes - headersSoFar) + centralBytes + EOCD_BYTES;
    if (lowerBound > PACKAGE_LIMITS.maxCompressedInputBytes) {
      return err(
        failure(
          0,
          `The written package would be at least ${lowerBound} bytes; the limit is ${PACKAGE_LIMITS.maxCompressedInputBytes} bytes (max compressed input, L1).`,
        ),
      );
    }
  }

  const totalBytes = localBytes + centralBytes + EOCD_BYTES;
  const out = new Uint8Array(totalBytes);
  for (const entry of prepared) {
    const at = entry.offset;
    putU32(out, at, LOCAL_SIGNATURE);
    putU16(out, at + 4, VERSION_NEEDED);
    putU16(out, at + 6, entry.flags);
    putU16(out, at + 8, entry.method);
    putU16(out, at + 10, DOS_TIME);
    putU16(out, at + 12, DOS_DATE);
    putU32(out, at + 14, entry.crc);
    putU32(out, at + 18, entry.body.length);
    putU32(out, at + 22, entry.size);
    putU16(out, at + 26, entry.name.length);
    putU16(out, at + 28, 0);
    out.set(entry.name, at + LOCAL_HEADER_BYTES);
    out.set(entry.body, at + LOCAL_HEADER_BYTES + entry.name.length);
  }

  let cursor = localBytes;
  for (const entry of prepared) {
    putU32(out, cursor, CENTRAL_SIGNATURE);
    putU16(out, cursor + 4, VERSION_NEEDED);
    putU16(out, cursor + 6, VERSION_NEEDED);
    putU16(out, cursor + 8, entry.flags);
    putU16(out, cursor + 10, entry.method);
    putU16(out, cursor + 12, DOS_TIME);
    putU16(out, cursor + 14, DOS_DATE);
    putU32(out, cursor + 16, entry.crc);
    putU32(out, cursor + 20, entry.body.length);
    putU32(out, cursor + 24, entry.size);
    putU16(out, cursor + 28, entry.name.length);
    putU16(out, cursor + 30, 0);
    putU16(out, cursor + 32, 0);
    putU16(out, cursor + 34, 0);
    putU16(out, cursor + 36, 0);
    putU32(out, cursor + 38, 0);
    putU32(out, cursor + 42, entry.offset);
    out.set(entry.name, cursor + CENTRAL_HEADER_BYTES);
    cursor += CENTRAL_HEADER_BYTES + entry.name.length;
  }

  putU32(out, cursor, EOCD_SIGNATURE);
  putU16(out, cursor + 4, 0);
  putU16(out, cursor + 6, 0);
  putU16(out, cursor + 8, prepared.length);
  putU16(out, cursor + 10, prepared.length);
  putU32(out, cursor + 12, centralBytes);
  putU32(out, cursor + 16, localBytes);
  putU16(out, cursor + 20, 0);

  return ok(out);
}

/**
 * Write a plain ZIP from files that are not a distribution package (for example the reviewed setup bundle). Paths,
 * sizes and archive structure use the same bounded reader contract as game packages; no manifest is added.
 */
export function writeZipArchive(files: readonly PackageFile[]): Result<Uint8Array> {
  if (!Array.isArray(files) || files.length === 0 || files.length > PACKAGE_LIMITS.maxEntries) {
    return err(failure(0, `The archive needs 1–${PACKAGE_LIMITS.maxEntries} files (max entry count, L2).`));
  }
  const seen = new Set<string>();
  let total = 0;
  const ordered: PackageFile[] = [];
  for (const file of files) {
    if (typeof file.path !== "string" || !(file.bytes instanceof Uint8Array)) {
      return err(failure(0, "Every ZIP entry must have a string path and Uint8Array bytes."));
    }
    const pathProblem = checkEntryPath(file.path);
    if (pathProblem !== null || file.path.endsWith("/")) {
      return err(failure(0, `${pathProblem ?? `ZIP entry "${file.path}" must name a file`}.`));
    }
    const path = toSlashes(file.path);
    const folded = foldPath(path);
    if (seen.has(folded)) return err(failure(0, `ZIP entry "${path}" duplicates another path (case-insensitive duplicates, L10).`));
    seen.add(folded);
    if (file.bytes.length > PACKAGE_LIMITS.maxEntryUncompressedBytes) {
      return err(failure(0, `ZIP entry "${path}" exceeds the max entry size (L3).`));
    }
    total += file.bytes.length;
    if (total > PACKAGE_LIMITS.maxTotalUncompressedBytes) {
      return err(failure(0, "ZIP entries exceed the max total uncompressed size (L4)."));
    }
    ordered.push({ path, bytes: file.bytes });
  }
  ordered.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const built = buildZip(ordered);
  if (!built.ok) return built;
  const reread = readZip(built.value, "the ZIP archive");
  if (!reread.ok) return err(failure(0, `The writer produced a ZIP its reader rejects: ${reread.error.message}`));
  return built;
}

/**
 * Write the project's distribution package (docs/spec/formats/packaging-and-paths.md, AD-6): a
 * `.tpk`-compatible ZIP carrying `input.files` plus `manifest.json` at the
 * archive root.
 *
 * The manifest's `schema`, `main` and `index` are validated (an integer project
 * schema, a main file that is in the tree, an index that matches it) and every
 * file is checked against the same `PACKAGE_LIMITS` and path rules the reader
 * applies, so the writer cannot emit a package the reader would refuse. Entries
 * are ordered by path, the manifest's `index` is written in the same code-unit
 * order rather than the caller's, and each entry is compressed or stored
 * deterministically, so the same input always yields byte-identical output (G3).
 * The finished bytes are read back through `readZip` before being returned.
 * Never throws (AD-18).
 */
export function writeDistributionPackage(input: DistributionInput): Result<Uint8Array> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return err(
      failure(
        0,
        "The distribution input is missing; it must hold the asset tree and the manifest (distribution input, AD-6).",
      ),
    );
  }
  const rawManifest: unknown = input.manifest;
  if (typeof rawManifest !== "object" || rawManifest === null || Array.isArray(rawManifest)) {
    return err(
      failure(
        0,
        `The manifest is missing; a distribution package requires ${MANIFEST_FILE_NAME} { schema, main, index } (manifest, AD-6).`,
      ),
    );
  }
  const manifestProblem = checkManifest(rawManifest as DistributionManifest);
  if (manifestProblem !== null) return err(failure(0, `${manifestProblem}.`));

  if (!Array.isArray(input.files)) {
    return err(
      failure(0, "The asset tree is missing; files must be an array of { path, bytes } (asset tree, AD-6)."),
    );
  }
  const files: readonly unknown[] = input.files;
  const manifest = rawManifest as DistributionManifest;

  // The manifest is an entry too, so the tree's files plus it must fit L2 (and
  // comfortably below the ZIP 16-bit count field, which maxEntries already is).
  if (files.length + 1 > PACKAGE_LIMITS.maxEntries) {
    return err(
      failure(
        0,
        `The asset tree has ${files.length} files plus the manifest; the limit is ${PACKAGE_LIMITS.maxEntries} entries (max entry count, L2).`,
      ),
    );
  }

  const tree = new Map<string, string>();
  const ordered: PackageFile[] = [];
  for (const raw of files) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return err(
        failure(
          0,
          "The asset tree holds a non-object entry; every entry must be { path, bytes } (asset tree, AD-6).",
        ),
      );
    }
    const file = raw as { readonly path?: unknown; readonly bytes?: unknown };
    if (typeof file.path !== "string") {
      return err(
        failure(
          0,
          `The asset tree holds an entry whose path is a ${typeof file.path}; every entry's path must be a string (asset tree, AD-6).`,
        ),
      );
    }
    if (!(file.bytes instanceof Uint8Array)) {
      return err(
        failure(
          0,
          `The asset tree holds "${file.path}" whose bytes are not a Uint8Array; every entry's bytes must be a Uint8Array (asset tree, AD-6).`,
        ),
      );
    }
    const pathProblem = checkEntryPath(file.path);
    if (pathProblem !== null) return err(failure(0, `${pathProblem}.`));
    const shapeProblem = checkFilePath(file.path);
    if (shapeProblem !== null) return err(failure(0, `${shapeProblem}.`));
    // The package stores `/`-separated names(docs/spec/formats/README.md#paths-inside-files), so the entry name written
    // and the tree's own spelling are the normalised path, not the raw string.
    const normalised = toSlashes(file.path);
    const folded = foldPath(file.path);
    if (folded === foldPath(MANIFEST_FILE_NAME)) {
      return err(
        failure(
          0,
          `The asset tree already contains "${file.path}"; the writer writes ${MANIFEST_FILE_NAME} itself (manifest, L10).`,
        ),
      );
    }
    const first = tree.get(folded);
    if (first !== undefined) {
      return err(
        failure(
          0,
          `Files "${first}" and "${file.path}" are the same path after case and separator folding; the package would be ambiguous (case-insensitive duplicates, L10).`,
        ),
      );
    }
    tree.set(folded, normalised);
    ordered.push({ path: normalised, bytes: file.bytes });
  }

  if (!tree.has(foldPath(manifest.main))) {
    return err(
      failure(
        0,
        `The manifest's main file "${manifest.main}" is not in the asset tree (manifest main, AD-6).`,
      ),
    );
  }
  const indexProblem = checkIndex(manifest.index, tree);
  if (indexProblem !== null) return err(failure(0, `${indexProblem}.`));

  // A fixed key order, so the manifest's bytes are deterministic whatever order
  // the caller's object happens to hold (G3, AD-25). The schema version is the
  // project-level integer of AD-23; `schema` is written first, `main`, `index`.
  // `main` and every index entry take the tree's own spelling, so the manifest
  // names the archive's normalised paths(docs/spec/formats/README.md#paths-inside-files) rather than the caller's strings,
  // and `index` is then put in the same code-unit order the archive's entries
  // are, so the caller's array order cannot reach the written bytes (G3).
  const index = manifest.index.map((value) => tree.get(foldPath(value)) ?? value);
  index.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const manifestBytes = strToU8(
    JSON.stringify({
      schema: manifest.schema,
      main: tree.get(foldPath(manifest.main)) ?? manifest.main,
      index,
    }),
  );
  ordered.push({ path: MANIFEST_FILE_NAME, bytes: manifestBytes });

  // The manifest is an entry too, so it counts against the per-entry (L3) and
  // total (L4) uncompressed budgets exactly like a game file. Its bytes are
  // serialised first, so the whole package is measured before anything is built.
  let total = 0;
  for (const entry of ordered) {
    if (entry.bytes.length > PACKAGE_LIMITS.maxEntryUncompressedBytes) {
      return err(
        failure(
          0,
          `File "${entry.path}" is ${entry.bytes.length} bytes; the limit is ${PACKAGE_LIMITS.maxEntryUncompressedBytes} (max entry size, L3).`,
        ),
      );
    }
    total += entry.bytes.length;
  }
  if (total > PACKAGE_LIMITS.maxTotalUncompressedBytes) {
    return err(
      failure(
        0,
        `The asset tree totals ${total} bytes; the limit is ${PACKAGE_LIMITS.maxTotalUncompressedBytes} (max total size, L4).`,
      ),
    );
  }

  // Deterministic entry order: code-unit order on the path (never locale
  // sensitive, G3), so the same input produces byte-identical output (AD-25).
  ordered.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const built = buildZip(ordered);
  if (!built.ok) return built;

  // The writer must not be able to emit a package its own reader would reject:
  // read the bytes back and prove every file survives intact. `readZip`'s name
  // is the package name used in its messages, so a descriptive placeholder is
  // passed rather than the manifest's file name.
  const reread = readZip(built.value, "the distribution package");
  if (!reread.ok) {
    return err(
      failure(
        0,
        `The writer produced a package its own reader rejects: ${reread.error.message} (writer self-check, docs/spec/formats/packaging-and-paths.md`,
      ),
    );
  }
  if (!sameTree(reread.value, ordered)) {
    return err(
      failure(0, "The writer produced a package whose read-back tree differs from its input (writer self-check, docs/spec/formats/packaging-and-paths.md."),
    );
  }
  return built;
}
