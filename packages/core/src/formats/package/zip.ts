/**
 * The ZIP reader behind `.tpk` packages and appended-ZIP EXEs
 * (docs/spec/formats/packaging-and-paths.md, AD-6).
 *
 * A `.tpk` is a standard ZIP archive; a standalone EXE is one appended to a
 * program, located by the `CMP1` trailer of docs/spec/formats/packaging-and-paths.md. Both end up here as bytes,
 * which are parsed as a ZIP: the end-of-central-directory record, the central
 * directory, and each entry's local header.
 *
 * Games are untrusted input (AD-17), and `fflate` trusts an entry's declared
 * sizes — a probe in the discovery report measured `unzipSync` returning 1,000
 * bytes, with no error, for an entry declaring 1,000 but holding 10,000,000. So
 * this reader does the work `fflate` will not:
 *
 * 1. every structural limit and path rule of `PACKAGE_LIMITS` is checked while
 *    the headers are parsed, before anything is allocated;
 * 2. each declared uncompressed size is checked while the central directory is
 *    parsed, before anything is inflated;
 * 3. each deflate entry's own stream is inflated independently and must yield
 *    exactly the declared number of bytes, so a silently truncated decode
 *    cannot pass — and the decode is abandoned the moment it passes the
 *    declaration, so the *work* an entry can command is bounded too, not just
 *    the memory it can command (`proveDeclaredSize`);
 * 4. the decoded bytes' CRC-32 must match the header.
 *
 * Every rejection names the rule it hit. Nothing is written, nothing recurses
 * (a nested archive is an ordinary file, L14), and nothing throws: a malformed
 * package is a located `FormatError` (AD-18).
 */

import { Inflate, strFromU8, unzipSync } from "fflate/browser";
import type { Unzipped, UnzipFileInfo } from "fflate/browser";
import { crc32 } from "../image/crc32.ts";
import { foldPath } from "../main-file/layout.ts";
import { err, ok, type FormatError, type Result } from "../result.ts";
import { PACKAGE_LIMITS } from "./limits.ts";
import { canonicalEntryPath, checkEntryPath } from "./path-rules.ts";
import type { PackageFile } from "./model.ts";

/** The format specification section every failure here cites. */
const SECTION = "docs/spec/formats/packaging-and-paths.md";

// ZIP structure constants (PKZIP APPNOTE 4.3, docs/spec/formats/packaging-and-paths.md. Signatures are the four
// bytes `PK\x03\x04` and friends, read little-endian.
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const SENTINEL_16 = 0xffff;
const SENTINEL_32 = 0xffffffff;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;
// General-purpose flags and the DOS attribute byte of the external attributes.
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_UTF8_NAME = 0x0800;
const DOS_DIRECTORY = 0x10;
// The only methods AD-6's `fflate` surface supports (L12).
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/**
 * The smallest number of compressed bytes the declared-size proof hands the
 * streaming inflater at a time (the chunk is one 1,024th of the declaration for
 * a bigger entry — see `proveDeclaredSize`).
 */
const MIN_INFLATE_CHUNK_BYTES = 1024;

/** Thrown to stop `fflate` mid-stream the instant a decode passes its declaration. */
const DECLARED_SIZE_PASSED = Symbol("declared size passed");

/**
 * One entry of the central directory, as parsed and held to every limit that needs no decoding
 * (docs/spec/formats/packaging-and-paths.md). A host that cannot hold the whole archive gets these from
 * `readZipDirectory` and reads each entry's bytes itself, by range.
 */
export interface ZipEntry {
  /** The name decoded exactly as `fflate` decodes it, so keys match. */
  readonly storedName: string;
  /** The name with `\` normalised to `/`(docs/spec/formats/README.md#paths-inside-files). */
  readonly path: string;
  /** A directory: counted, path-checked, never served. */
  readonly directory: boolean;
  readonly method: number;
  readonly flags: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
}

/** A located failure citing docs/spec/formats/packaging-and-paths.md (AD-18). */
function failure(offset: number, message: string): FormatError {
  return { offset, section: SECTION, message };
}

/**
 * A view of part of an archive. `bytes[index]` is the archive's byte `base + index`; the archive as a whole is `length`
 * bytes long. A whole in-memory archive is the window with `base` 0, which is how `readZip` reads it; a host holding only
 * the end of a large archive reads it through the same parsers with a later `base`, so both apply the same limits.
 */
interface ZipWindow {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  readonly base: number;
  readonly length: number;
}

function zipWindow(bytes: Uint8Array, base: number, length: number): ZipWindow {
  return { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), base, length };
}

/** L1: the whole compressed input is bounded before anything is parsed. */
function archiveSizeFailure(length: number, name: string): FormatError | null {
  if (length <= PACKAGE_LIMITS.maxCompressedInputBytes) return null;
  return failure(
    0,
    `Package "${name}" is ${length} bytes; the limit is ${PACKAGE_LIMITS.maxCompressedInputBytes} bytes (max compressed input, L1).`,
  );
}

/**
 * Find the end-of-central-directory record (L15, docs/spec/formats/packaging-and-paths.md. It sits in the last
 * 65,557 bytes — 22 bytes plus a possible 65,535-byte comment — and the record
 * whose comment length reaches the end of the file is the one that counts.
 */
function findEocd(win: ZipWindow): number | undefined {
  const { view, base, length } = win;
  const lowest = length > PACKAGE_LIMITS.eocdSearchBytes ? length - PACKAGE_LIMITS.eocdSearchBytes : 0;
  for (let offset = length - EOCD_BYTES; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset - base, true) !== EOCD_SIGNATURE) continue;
    if (offset + EOCD_BYTES + view.getUint16(offset - base + 20, true) === length) return offset;
  }
  return undefined;
}

/** Where an archive's central directory sits, from its end-of-central-directory record. */
export interface ZipDirectoryLocation {
  /** The offset of the end-of-central-directory record. */
  readonly eocdOffset: number;
  /** The entry count the record declares (already held to L2). */
  readonly totalEntries: number;
  /** The offset of the first central-directory header. */
  readonly cdOffset: number;
  /** The central directory's declared length; `cdOffset + cdSize` does not pass `eocdOffset`. */
  readonly cdSize: number;
}

/**
 * Locate the central directory (L2, L13, L15, L19), reading only the end-of-central-directory record and the 20 bytes
 * before it for a ZIP64 locator.
 */
function locateDirectory(win: ZipWindow, name: string): Result<ZipDirectoryLocation> {
  const { view, base } = win;
  const eocdOffset = findEocd(win);
  if (eocdOffset === undefined) {
    return err(
      failure(
        0,
        `Package "${name}" has no end-of-central-directory record within the last ${PACKAGE_LIMITS.eocdSearchBytes} bytes (EOCD search window, L15).`,
      ),
    );
  }
  const at = eocdOffset - base;
  const totalEntries = view.getUint16(at + 10, true);
  const cdSize = view.getUint32(at + 12, true);
  const cdOffset = view.getUint32(at + 16, true);
  const zip64 =
    totalEntries === SENTINEL_16 ||
    cdSize === SENTINEL_32 ||
    cdOffset === SENTINEL_32 ||
    (eocdOffset >= 20 && view.getUint32(at - 20, true) === ZIP64_LOCATOR_SIGNATURE);
  if (zip64) {
    return err(failure(eocdOffset, `Package "${name}" uses ZIP64; ZIP64 archives are not supported (ZIP64, L13).`));
  }
  if (totalEntries > PACKAGE_LIMITS.maxEntries) {
    return err(
      failure(
        eocdOffset,
        `Package "${name}" has ${totalEntries} entries; the limit is ${PACKAGE_LIMITS.maxEntries} (max entry count, L2).`,
      ),
    );
  }
  if (cdOffset + cdSize > eocdOffset) {
    return err(
      failure(
        eocdOffset,
        `Package "${name}" central directory at ${cdOffset} for ${cdSize} bytes does not fit before the record at ${eocdOffset} (central directory, L19).`,
      ),
    );
  }
  // `fflate` decodes as many entries as the record's *this-disk* count says, so a record whose two counts disagree was
  // refused only by accident (a missing entry, or garbage past the directory). A single-disk package states one count.
  const diskEntries = view.getUint16(at + 8, true);
  if (diskEntries !== totalEntries) {
    return err(
      failure(
        eocdOffset,
        `Package "${name}" end-of-central-directory record counts ${diskEntries} entries on its disk but ${totalEntries} in all; a single-disk package states one count (central directory, L19).`,
      ),
    );
  }
  return ok({ eocdOffset, totalEntries, cdOffset, cdSize });
}

/**
 * Parse the central directory, applying every limit that does not need an
 * allocation (L1, L2, L4, L5, L6–L13). Entries come back in directory order;
 * `fflate` will decode them in the same order under the same names. The window
 * runs from `location.cdOffset` to the end of the archive.
 */
function parseDirectory(win: ZipWindow, location: ZipDirectoryLocation, name: string): Result<readonly ZipEntry[]> {
  const { bytes, view, base, length } = win;
  const { eocdOffset, totalEntries, cdOffset, cdSize } = location;
  const entries: ZipEntry[] = [];
  const foldedPaths = new Map<string, string>();
  const cdEnd = cdOffset + cdSize;
  let cursor = cdOffset;
  while (cursor < cdEnd) {
    // The EOCD's count (already held to L2) bounds the work: a directory that
    // keeps going past it is refused here instead of being walked to the end of
    // a crafted `cdSize`.
    if (entries.length === totalEntries) {
      return err(
        failure(
          eocdOffset,
          `Package "${name}" end-of-central-directory record declares ${totalEntries} entries but the central directory holds more; the package is corrupt (central directory, L19).`,
        ),
      );
    }
    if (cursor + CENTRAL_HEADER_BYTES > length || view.getUint32(cursor - base, true) !== CENTRAL_SIGNATURE) {
      return err(
        failure(
          cursor,
          `Package "${name}" central directory entry ${entries.length + 1} has no central-directory header (central directory, L19).`,
        ),
      );
    }
    const at = cursor - base;
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const diskStart = view.getUint16(at + 34, true);
    const externalAttributes = view.getUint32(at + 38, true);
    const localOffset = view.getUint32(at + 42, true);
    if (
      compressedSize === SENTINEL_32 ||
      uncompressedSize === SENTINEL_32 ||
      localOffset === SENTINEL_32 ||
      diskStart === SENTINEL_16
    ) {
      return err(failure(cursor, `Package "${name}" uses ZIP64; ZIP64 archives are not supported (ZIP64, L13).`));
    }
    const nameEnd = cursor + CENTRAL_HEADER_BYTES + nameLength;
    if (nameEnd + extraLength + commentLength > length) {
      return err(
        failure(
          cursor,
          `Package "${name}" entry ${entries.length + 1} has a name that runs past the archive (central directory, L19).`,
        ),
      );
    }
    const storedName = strFromU8(
      bytes.subarray(at + CENTRAL_HEADER_BYTES, nameEnd - base),
      (flags & FLAG_UTF8_NAME) === 0,
    );
    const path = canonicalEntryPath(storedName);
    if ((flags & FLAG_ENCRYPTED) !== 0) {
      return err(
        failure(
          localOffset,
          `Entry "${path}" is encrypted; encrypted package entries are not supported (encrypted entry, L11).`,
        ),
      );
    }
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) {
      return err(
        failure(
          localOffset,
          `Entry "${path}" uses compression method ${method}; only stored (0) and deflate (8) are supported (compression method, L12).`,
        ),
      );
    }
    const pathProblem = checkEntryPath(storedName);
    if (pathProblem !== null) {
      return err(failure(localOffset, `${pathProblem}.`));
    }
    const directory = path.endsWith("/") || (externalAttributes & DOS_DIRECTORY) !== 0;
    if (uncompressedSize > PACKAGE_LIMITS.maxEntryUncompressedBytes) {
      return err(
        failure(
          localOffset,
          `Entry "${path}" declares ${uncompressedSize} bytes uncompressed; the limit is ${PACKAGE_LIMITS.maxEntryUncompressedBytes} (max entry size, L3).`,
        ),
      );
    }
    const folded = foldPath(path);
    const first = foldedPaths.get(folded);
    if (first !== undefined) {
      return err(
        failure(
          localOffset,
          `Entries "${first}" and "${path}" are the same path after case and separator folding; the package is ambiguous (case-insensitive duplicates, L10).`,
        ),
      );
    }
    foldedPaths.set(folded, path);
    entries.push({
      storedName,
      path,
      directory,
      method,
      flags,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor = nameEnd + extraLength + commentLength;
  }
  if (entries.length !== totalEntries) {
    return err(
      failure(
        eocdOffset,
        `Package "${name}" end-of-central-directory record declares ${totalEntries} entries but the central directory holds ${entries.length}; the package is corrupt (central directory, L19).`,
      ),
    );
  }

  let total = 0;
  for (const entry of entries) {
    if (!entry.directory) total += entry.uncompressedSize;
  }
  if (total > PACKAGE_LIMITS.maxTotalUncompressedBytes) {
    return err(
      failure(
        eocdOffset,
        `Package "${name}" declares ${total} bytes uncompressed; the limit is ${PACKAGE_LIMITS.maxTotalUncompressedBytes} (max total size, L4).`,
      ),
    );
  }
  for (const entry of entries) {
    if (entry.directory || entry.uncompressedSize === 0) continue;
    const ratio = Math.round(entry.uncompressedSize / Math.max(entry.compressedSize, 1));
    if (ratio > PACKAGE_LIMITS.maxCompressionRatio) {
      return err(
        failure(
          entry.localOffset,
          `Entry "${entry.path}" compresses at ${ratio}:1; the limit is ${PACKAGE_LIMITS.maxCompressionRatio}:1 (zip-bomb guard, L5).`,
        ),
      );
    }
  }
  return ok(entries);
}

/** The central directory of a whole in-memory archive. */
function readCentralDirectory(bytes: Uint8Array, name: string): Result<readonly ZipEntry[]> {
  const win = zipWindow(bytes, 0, bytes.length);
  const location = locateDirectory(win, name);
  if (!location.ok) return location;
  return parseDirectory(win, location.value, name);
}

/**
 * The bytes of the end of an archive that `locateZipDirectory` needs: the whole end-of-central-directory search window
 * (L15) plus the 20 bytes a ZIP64 locator would occupy before it. `end` is the archive's length.
 */
export function zipTailRange(archiveLength: number): { readonly start: number; readonly end: number } {
  return { start: Math.max(0, archiveLength - (PACKAGE_LIMITS.eocdSearchBytes + 20)), end: archiveLength };
}

/**
 * Locate the central directory of an archive the host does not hold whole (L1, L2, L13, L15, L19). `tail` is exactly
 * the bytes `zipTailRange(archiveLength)` names. Applies the checks `readZip` applies to the same archive, with the
 * same messages; a `tail` of the wrong length is the caller's bug and throws.
 */
export function locateZipDirectory(tail: Uint8Array, archiveLength: number, name: string): Result<ZipDirectoryLocation> {
  const tooBig = archiveSizeFailure(archiveLength, name);
  if (tooBig !== null) return err(tooBig);
  const range = zipTailRange(archiveLength);
  if (tail.length !== range.end - range.start) {
    throw new TypeError(`locateZipDirectory needs the ${range.end - range.start} bytes from ${range.start}, not ${tail.length}`);
  }
  return locateDirectory(zipWindow(tail, range.start, archiveLength), name);
}

/**
 * Parse the central directory of an archive the host does not hold whole, applying L2–L13 and L19 exactly as `readZip`
 * does. `directory` is exactly the archive's bytes from `location.cdOffset` to its end (the directory, the
 * end-of-central-directory record and its comment); a window of any other length is the caller's bug and throws.
 */
export function readZipDirectory(
  directory: Uint8Array,
  location: ZipDirectoryLocation,
  archiveLength: number,
  name: string,
): Result<readonly ZipEntry[]> {
  if (directory.length !== archiveLength - location.cdOffset) {
    throw new TypeError(
      `readZipDirectory needs the ${archiveLength - location.cdOffset} bytes from ${location.cdOffset}, not ${directory.length}`,
    );
  }
  return parseDirectory(zipWindow(directory, location.cdOffset, archiveLength), location, name);
}

/** The size of a local file header's fixed part, before its name and extra field. */
export const ZIP_LOCAL_HEADER_BYTES = LOCAL_HEADER_BYTES;

/**
 * How many bytes of an entry's local header the host must read, given `fixed`: the (up to) `ZIP_LOCAL_HEADER_BYTES`
 * bytes at the entry's `localOffset`, clamped to the archive's end. A record that does not begin with the local-header
 * signature needs only what the host already has; `checkZipLocalHeader` then reports it.
 */
export function zipLocalHeaderBytesNeeded(fixed: Uint8Array): number {
  if (fixed.length < LOCAL_HEADER_BYTES) return fixed.length;
  const view = new DataView(fixed.buffer, fixed.byteOffset, fixed.byteLength);
  if (view.getUint32(0, true) !== LOCAL_SIGNATURE) return fixed.length;
  return LOCAL_HEADER_BYTES + view.getUint16(26, true) + view.getUint16(28, true);
}

/**
 * Check one entry's local header against the central directory (L19) and return where the entry's data starts.
 * `header` is the archive's bytes from `entry.localOffset`, `zipLocalHeaderBytesNeeded` of them, clamped to the
 * archive's end (`archiveLength`). A data-descriptor entry (flag bit 3) legitimately writes zeroes in its local header,
 * so a zero there is not a disagreement.
 */
export function checkZipLocalHeader(entry: ZipEntry, header: Uint8Array, archiveLength: number): Result<number> {
  const offset = entry.localOffset;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const wellFormed = header.length >= LOCAL_HEADER_BYTES && view.getUint32(0, true) === LOCAL_SIGNATURE;
  if (!wellFormed) {
    return err(
      failure(offset, `Entry "${entry.path}" has no local header at ${offset} (header consistency, L19).`),
    );
  }
  const localFlags = view.getUint16(6, true);
  const localMethod = view.getUint16(8, true);
  const localCrc = view.getUint32(14, true);
  const localCompressed = view.getUint32(18, true);
  const localUncompressed = view.getUint32(22, true);
  const localNameLength = view.getUint16(26, true);
  const localExtraLength = view.getUint16(28, true);
  const nameEnd = offset + LOCAL_HEADER_BYTES + localNameLength;
  const dataOffset = nameEnd + localExtraLength;
  if (dataOffset > archiveLength || dataOffset + entry.compressedSize > archiveLength) {
    return err(
      failure(
        offset,
        `Entry "${entry.path}" local header or data runs past the archive (header consistency, L19).`,
      ),
    );
  }
  if (header.length < dataOffset - offset) {
    throw new TypeError(`checkZipLocalHeader needs the ${dataOffset - offset} header bytes at ${offset}, not ${header.length}`);
  }
  const localName = strFromU8(
    header.subarray(LOCAL_HEADER_BYTES, LOCAL_HEADER_BYTES + localNameLength),
    (localFlags & FLAG_UTF8_NAME) === 0,
  );
  const descriptor = (entry.flags & FLAG_DATA_DESCRIPTOR) !== 0;
  const sizes: readonly (readonly [string, number, number])[] = [
    ["compressed size", localCompressed, entry.compressedSize],
    ["uncompressed size", localUncompressed, entry.uncompressedSize],
    ["crc32", localCrc, entry.crc],
  ];
  let mismatch: string | null = null;
  if (localName !== entry.storedName) {
    mismatch = "name";
  } else if (localMethod !== entry.method) {
    mismatch = "method";
  } else {
    for (const [label, local, central] of sizes) {
      if (local === central || (descriptor && local === 0)) continue;
      mismatch = label;
      break;
    }
  }
  if (mismatch !== null) {
    return err(
      failure(
        offset,
        `Entry "${entry.path}" local header disagrees with the central directory (${mismatch}) (header consistency, L19).`,
      ),
    );
  }
  return ok(dataOffset);
}

/**
 * Check each entry's local header against the central directory (L19) and
 * return where each entry's data starts, parallel to `entries` (0 where there
 * is none).
 */
function readLocalHeaders(bytes: Uint8Array, entries: readonly ZipEntry[]): Result<readonly number[]> {
  const dataOffsets: number[] = [];
  for (const entry of entries) {
    if (entry.directory) {
      dataOffsets.push(0);
      continue;
    }
    const fixed = bytes.subarray(entry.localOffset, entry.localOffset + LOCAL_HEADER_BYTES);
    const header = bytes.subarray(entry.localOffset, entry.localOffset + zipLocalHeaderBytesNeeded(fixed));
    const checked = checkZipLocalHeader(entry, header, bytes.length);
    if (!checked.ok) return checked;
    dataOffsets.push(checked.value);
  }
  return ok(dataOffsets);
}

/** What proving one deflate entry's own stream against its declaration found. */
type DeclaredSizeProof =
  /** The stream holds exactly the declared number of bytes. */
  | { readonly kind: "exact" }
  /** The stream ended after fewer bytes than declared; `produced` is its length. */
  | { readonly kind: "short"; readonly produced: number }
  /** The stream decodes past the declared number of bytes. */
  | { readonly kind: "oversize" }
  /** `fflate` refused the stream: it is corrupt or truncated. */
  | { readonly kind: "invalid" };

/** A proof that failed. */
type BrokenProof = Exclude<DeclaredSizeProof, { readonly kind: "exact" }>;

/** A stream known to be bad before it ends, which is when the host stops reading it. */
type BrokenStream = Extract<DeclaredSizeProof, { readonly kind: "oversize" | "invalid" }>;

/** A deflate stream being proved against its declaration, one chunk at a time. */
interface DeclaredInflater {
  /** Feed the next compressed bytes; the stream's failure the moment it is certain, otherwise `null`. */
  push(chunk: Uint8Array, final: boolean): BrokenStream | null;
  /** What the stream held, once the last chunk was pushed. */
  result(): DeclaredSizeProof;
}

/**
 * Prove that a deflate entry's own stream holds exactly `declared` bytes (L17),
 * doing no more work than that proof needs.
 *
 * `fflate`'s one-shot inflate stops *writing* at the end of the caller's buffer
 * but carries on decoding, and a write past a typed array's end is a silent
 * no-op — so a stream that really holds 200 MiB under a header declaring 1,000
 * bytes burns the full 200 MiB of CPU before a length check can run. Neither L1
 * (input bytes) nor L5 (declared bytes ÷ compressed bytes, which reads the
 * attacker's own declaration) bounds that. So the stream is fed to fflate's
 * *streaming* inflater in chunks and the decode is abandoned the moment the
 * produced length passes `declared`: the work is bounded by the declaration plus
 * one chunk's ceiling, not by what the entry really holds.
 *
 * The chunk is one 1,024th of the declaration — the inverse of DEFLATE's ~1,032:1
 * decoded-per-input ceiling — so one push can produce about one declaration's
 * worth before the abort lands, whatever the declaration is. A flat chunk would
 * be wrong in one direction or the other: 1 KiB pushes bound an over-declared
 * stream's transient decode to ~1 MiB but make fflate re-copy the input it has
 * not consumed on every push (a *stored*-block stream, what a level-0 compressor
 * writes, is not consumed until a whole 65,535-byte block has arrived, so a
 * 32 MiB level-0 entry paid ~50x its decode time that way), while a large flat
 * chunk would let a 1,000-byte declaration decode tens of MiB into memory before
 * the abort. `MIN_INFLATE_CHUNK_BYTES` keeps small declarations cheap. A chunk
 * the caller pushes is split into those pieces, so a host may read an entry in
 * whatever sizes its source gives.
 *
 * Letting the sentinel out of the inflate callback is what stops fflate; the
 * inflater is then thrown away with the half-read stream. When `out` is given
 * (exactly `declared` bytes long) the decoded bytes are written into it as they
 * are produced, so the proof and the decode are one pass.
 */
function createDeclaredInflater(declared: number, out: Uint8Array | null): DeclaredInflater {
  let produced = 0;
  let broken: BrokenStream | null = null;
  const inflate = new Inflate((chunk: Uint8Array) => {
    if (produced + chunk.length > declared) {
      throw DECLARED_SIZE_PASSED;
    }
    if (out !== null) out.set(chunk, produced);
    produced += chunk.length;
  });
  const scaled = declared >>> 10;
  const chunkBytes = scaled > MIN_INFLATE_CHUNK_BYTES ? scaled : MIN_INFLATE_CHUNK_BYTES;
  return {
    push(chunk, final) {
      if (broken !== null) return broken;
      try {
        if (chunk.length === 0) {
          // An empty stream is still a stream: the final push is what makes fflate
          // finish (and answer) rather than wait for more input.
          inflate.push(chunk, final);
        } else {
          for (let at = 0; at < chunk.length; at += chunkBytes) {
            const end = at + chunkBytes > chunk.length ? chunk.length : at + chunkBytes;
            inflate.push(chunk.subarray(at, end), final && end === chunk.length);
          }
        }
      } catch (error) {
        broken = error === DECLARED_SIZE_PASSED ? { kind: "oversize" } : { kind: "invalid" };
        return broken;
      }
      return null;
    },
    result() {
      if (broken !== null) return broken;
      return produced === declared ? { kind: "exact" } : { kind: "short", produced };
    },
  };
}

/** Prove one whole deflate stream against its declaration (L17); see `createDeclaredInflater`. */
function proveDeclaredSize(span: Uint8Array, declared: number): DeclaredSizeProof {
  const inflater = createDeclaredInflater(declared, null);
  return inflater.push(span, true) ?? inflater.result();
}

/** L17 for a stored entry: its stored bytes are its content, so the two sizes must agree. */
function storedSizeFailure(entry: ZipEntry): FormatError {
  return failure(
    entry.localOffset,
    `Entry "${entry.path}" is stored but its compressed size ${entry.compressedSize} differs from its declared size ${entry.uncompressedSize}; the package is corrupt (declared vs actual size, L17).`,
  );
}

/** L17 for a deflate entry whose stream did not hold exactly the declared number of bytes. */
function declaredSizeFailure(entry: ZipEntry, proof: BrokenProof): FormatError {
  if (proof.kind === "invalid") {
    return failure(
      entry.localOffset,
      `Entry "${entry.path}" does not inflate within the ${entry.uncompressedSize} bytes it declares; the package is corrupt (declared vs actual size, L17).`,
    );
  }
  // An abandoned decode measured the declared size plus one — the first byte
  // the stream cannot hold; a finished one measured its real length.
  const produced = proof.kind === "oversize" ? entry.uncompressedSize + 1 : proof.produced;
  return failure(
    entry.localOffset,
    `Entry "${entry.path}" inflates to ${produced} bytes but its header declares ${entry.uncompressedSize}; the package is corrupt (declared vs actual size, L17).`,
  );
}

/** L18: the decoded bytes' CRC-32 is not the header's. */
function crcFailure(entry: ZipEntry, actual: number): FormatError {
  return failure(
    entry.localOffset,
    `Entry "${entry.path}" CRC-32 is ${actual}; the header says ${entry.crc}; the package is corrupt (CRC-32, L18).`,
  );
}

/** One entry's data being decoded and verified a chunk at a time; see `createZipEntryDecoder`. */
export interface ZipEntryDecoder {
  /**
   * Feed the next bytes of the entry's compressed data (`compressedSize` bytes in all, in any chunking; `final` marks
   * the last chunk, which may be empty). Returns the failure the moment one is certain — a stream that decodes past its
   * declaration, or is corrupt — so the host stops reading, otherwise `null`. More than `compressedSize` bytes is the
   * caller's bug and throws.
   */
  push(chunk: Uint8Array, final: boolean): FormatError | null;
  /** After the last chunk: the entry's verified bytes (L17 size, L18 CRC-32), or the failure. */
  finish(): Result<Uint8Array>;
}

/**
 * Decode one non-directory entry from its data bytes, holding it to the checks `readZip` holds every entry to: a stored
 * entry's two sizes agree, a deflate stream holds exactly the declared number of bytes — proved while decoding, so the
 * work and the memory are bounded by the declaration and a chunk, never by what the stream really holds — and the
 * decoded bytes' CRC-32 is the header's. The result is a fresh array, never a view of anything the host read.
 *
 * The host has already run `checkZipLocalHeader` on the entry; this is what it does with the bytes after it, so a
 * host that reads an archive entry by entry through this function and one that loads it whole through `readZip` accept
 * and refuse the same entries.
 */
export function createZipEntryDecoder(entry: ZipEntry): Result<ZipEntryDecoder> {
  if (entry.directory) {
    throw new TypeError(`createZipEntryDecoder: "${entry.path}" is a directory, which has no data`);
  }
  if (entry.method === METHOD_STORED && entry.compressedSize !== entry.uncompressedSize) {
    return err(storedSizeFailure(entry));
  }
  const out = new Uint8Array(entry.uncompressedSize);
  const inflater = entry.method === METHOD_DEFLATE ? createDeclaredInflater(entry.uncompressedSize, out) : null;
  let failed: FormatError | null = null;
  let delivered = 0;
  const decoder: ZipEntryDecoder = {
    push(chunk, final) {
      if (failed !== null) return failed;
      delivered += chunk.length;
      if (delivered > entry.compressedSize) {
        throw new RangeError(`createZipEntryDecoder: "${entry.path}" was given more than its ${entry.compressedSize} data bytes`);
      }
      if (inflater === null) {
        out.set(chunk, delivered - chunk.length);
        return null;
      }
      const broken = inflater.push(chunk, final);
      if (broken !== null) failed = declaredSizeFailure(entry, broken);
      return failed;
    },
    finish() {
      if (failed !== null) return err(failed);
      const proof: DeclaredSizeProof =
        inflater === null
          ? delivered === out.length
            ? { kind: "exact" }
            : { kind: "short", produced: delivered }
          : inflater.result();
      if (proof.kind !== "exact") return err(declaredSizeFailure(entry, proof));
      const actual = crc32(out);
      if (actual !== entry.crc) return err(crcFailure(entry, actual));
      return ok(out);
    },
  };
  return ok(decoder);
}

/**
 * Read a ZIP archive — a `.tpk`, or the ZIP appended to a standalone EXE
 * (docs/spec/formats/packaging-and-paths.md) — and return its files in archive order.
 *
 * `bytes` is the whole ZIP region, `name` the package name used in messages.
 * Every file's declared size, actual size and CRC-32 are checked, so what comes
 * back is either every entry intact or a located error naming the docs/spec/formats/packaging-and-paths.md rule that
 * stopped it. Never throws (AD-18).
 */
export function readZip(bytes: Uint8Array, name: string): Result<readonly PackageFile[]> {
  const tooBig = archiveSizeFailure(bytes.length, name);
  if (tooBig !== null) return err(tooBig);
  const central = readCentralDirectory(bytes, name);
  if (!central.ok) return central;
  const entries = central.value;
  const locals = readLocalHeaders(bytes, entries);
  if (!locals.ok) return locals;
  const dataOffsets = locals.value;

  // The entry's own stream must hold exactly what its header declares (L17).
  // fflate trusts the declared size, so this is proved here, before anything is
  // decoded: a lying header is a located failure, never a silently truncated
  // buffer. The proof abandons the decode as soon as it passes the declaration,
  // so an entry's *work* is bounded by what it declares and the limits that
  // bound a declaration (L3, L4) — not by what its stream really holds.
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as ZipEntry;
    if (entry.directory) continue;
    if (entry.method === METHOD_STORED) {
      if (entry.compressedSize !== entry.uncompressedSize) return err(storedSizeFailure(entry));
      continue;
    }
    const dataOffset = dataOffsets[index] as number;
    const span = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
    const proof = proveDeclaredSize(span, entry.uncompressedSize);
    if (proof.kind !== "exact") return err(declaredSizeFailure(entry, proof));
  }

  const byStoredName = new Map<string, ZipEntry>();
  for (const entry of entries) byStoredName.set(entry.storedName, entry);
  let unzipped: Unzipped;
  try {
    unzipped = unzipSync(bytes, {
      filter: (file: UnzipFileInfo) => {
        const entry = byStoredName.get(file.name);
        return entry !== undefined && !entry.directory;
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return err(failure(0, `Package "${name}" could not be read: ${reason} (archive, L19).`));
  }

  const files: PackageFile[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as ZipEntry;
    if (entry.directory) continue;
    const decoded = unzipped[entry.storedName];
    if (decoded === undefined) {
      return err(
        failure(
          entry.localOffset,
          `Entry "${entry.path}" was not extracted; the package is corrupt (declared vs actual size, L17).`,
        ),
      );
    }
    if (decoded.length !== entry.uncompressedSize) {
      return err(
        failure(
          entry.localOffset,
          `Entry "${entry.path}" inflated to ${decoded.length} bytes but its header declares ${entry.uncompressedSize}; the package is corrupt (declared vs actual size, L17).`,
        ),
      );
    }
    const actual = crc32(decoded);
    if (actual !== entry.crc) return err(crcFailure(entry, actual));
    files.push({ path: entry.path, bytes: decoded });
  }
  return ok(files);
}
