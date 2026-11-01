/**
 * The package source: a distribution package validated whole, then served entry by entry from a bounded memory budget,
 * a durable cache and the network (issue #934, docs/spec/engine/runners.md#load-modes).
 *
 * **What it proves, and from what.** A package above the load threshold is still transferred in full on the first
 * launch, because nothing can be trusted that was not read. The transfer is streamed — never held — through an
 * incremental SHA-256 and a table of per-block digests (64 KiB blocks, 32 bytes each), into a *staging* file when the
 * host can offer one. The whole-archive SHA-256 must equal the install descriptor's, which the descriptor alone never
 * proves: the descriptor is untrusted, so the source also derives the package's content identity (`gameId`) from the
 * bytes it validated and refuses a descriptor that disagrees.
 *
 * Validation then walks the archive entry by entry through the same core readers `readZip` uses — the end-of-central-
 * directory and central-directory limits (L1–L13, L15, L19), each local header (L19), each stream proved against its
 * declaration while it is decoded (L17) and each CRC-32 (L18) — and drops every entry's bytes the moment it is checked.
 * Peak memory is the central directory, one entry and a read-ahead window, never the archive. The archive is read
 * through the block table, so whichever store holds it (staging, durable, or the network again when no staging exists)
 * is held to the bytes that hashed to the descriptor's SHA-256.
 *
 * **Strong binding of later reads.** While validating, the source records a SHA-256 of every entry's raw span (local
 * header and data) from the bytes it read. Those digests are *derived locally from the validated archive*, not
 * published by the package or the server (the manifest keeps exactly `schema`, `main`, `index`: AD-6). Every later read
 * — durable or network — is hashed against its digest before a byte of it is decoded, and the decode is held to L17 and
 * L18 again. A server whose content changed since validation therefore cannot feed the engine a byte: the read fails
 * with `integrity`. No HTTP validator is trusted or required.
 *
 * **Ranges are a contract, not a hint.** A range request is one `bytes=a-b`. Only `206` with a `Content-Range` that
 * says exactly `bytes a-b/<validated size>`, an identity `Content-Encoding` and exactly `b-a+1` body bytes is
 * accepted. `200` (a server that ignores `Range`) is `range-unsupported`; `416` is `range-unsatisfiable`; anything
 * else that does not match is `range-mismatch`; an unreachable server is `offline`. After a network validation the
 * source probes the server with a one-byte range before returning, so a server without range support is refused at
 * open, not on the first entry read.
 *
 * **The controller's decisions.** Opening validates and stops: `totalUncompressedSize` says what the package would
 * cost to keep whole. The controller then calls `keep()` (persist the validated archive through the durable store) or
 * `stream()` (never persist; read by ranges), or neither. `keep()` never hides a failure: a quota error rejects with
 * `kind: "quota"`, the staging copy is still held, and `stream()` selects real streaming.
 *
 * This module does no UI, owns no worker and registers no service worker.
 */

import {
  assetKey,
  checkZipLocalHeader,
  createZipEntryDecoder,
  deriveGameIdFromContentHash,
  err,
  fnv1a64,
  foldPackageIdentity,
  locateZipDirectory,
  MANIFEST_FILE_NAME,
  PACKAGE_LIMITS,
  packageIdentityRecord,
  readDistributionManifestFrom,
  readZipDirectory,
  zipLocalHeaderBytesNeeded,
  zipTailRange,
  ZIP_LOCAL_HEADER_BYTES,
  type AssetKey,
  type DistributionManifest,
  type FormatError,
  type Result,
  type ZipEntry,
  type ZipEntryDecoder,
} from "@tk-reawakened/core";
import { createSha256, type Sha256 } from "@tk-reawakened/synth";

/** The block size of the archive's verification table: 64 KiB, so the table is 0.05% of the archive. */
const BLOCK_BYTES = 65_536;
/** One SHA-256 digest. */
const DIGEST_BYTES = 32;
/** How much of an archive one read of a store or one verified read-ahead asks for at a time. */
const READ_STEP_BYTES = 1_048_576;
/** The decoded-entry budget of the memory tier unless the host sets one. */
const DEFAULT_MEMORY_BYTES = 8 * 1_048_576;
/** The largest central-directory window (directory, end record and comment) this source will hold in memory. */
const DEFAULT_DIRECTORY_BYTES = 16 * 1_048_576;

/** The install sidecar of docs/spec/formats/packaging-and-paths.md#install-descriptor, checked field by field. */
export type InstallDescriptor = {
  readonly schema: number;
  readonly file: string;
  readonly sha256: string;
  readonly size: number;
  readonly gameId: string;
  readonly title: string;
  readonly version: string;
};

/** Why a package source refused to open or to serve a read. */
export type PackageSourceFailure =
  /** The install descriptor is malformed or disagrees with what was asked for. */
  | "descriptor"
  /** The archive broke a package limit (L1–L21) or its distribution manifest; the message names the rule. */
  | "archive"
  /** The bytes' content identity is not the descriptor's `gameId`. */
  | "identity"
  /** Bytes differ from the validated archive: wrong size or SHA-256, or an entry that no longer matches its digest. */
  | "integrity"
  /** The server could not be reached (the request or its body failed), and no local tier could answer. */
  | "offline"
  /** The server answered with a status this source does not accept. */
  | "http"
  /** The server ignored `Range` (answered `200`) so it cannot serve ranges. */
  | "range-unsupported"
  /** The server answered `416`: the range is outside what it now holds. */
  | "range-unsatisfiable"
  /** The server answered a range, but not the one asked for or not in the form this source accepts. */
  | "range-mismatch"
  /** No such entry in the package. */
  | "missing-entry"
  /** A local tier does not hold the bytes and the network was not asked, or the store came up short. */
  | "missing-range"
  /** The staging store failed. */
  | "staging"
  /** The durable store failed. */
  | "durable"
  /** The durable store refused to keep the archive for lack of quota. */
  | "quota"
  /** The caller's signal aborted the work. */
  | "aborted"
  /** The source is closed, or the requested transition no longer applies. */
  | "closed";

/** The one error type this module throws for data and environment failures. */
export class PackageSourceError extends Error {
  readonly kind: PackageSourceFailure;
  /** The entry the failure is about, when it is about one. */
  readonly path: string | null;

  constructor(
    kind: PackageSourceFailure,
    message: string,
    options: { readonly path?: string; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PackageSourceError";
    this.kind = kind;
    this.path = options.path ?? null;
  }
}

/**
 * Temporary random-access storage for the archive while it is validated (an OPFS file, say). Not the durable cache: it
 * exists only so that validation need not hold the archive in memory, and a host without one is served by validating
 * from the network again, block by block. The source discards it once the controller has chosen.
 */
export interface ArchiveStaging {
  /** Append the next chunk. The chunk is only valid until the promise settles: copy or write it before resolving. */
  append(chunk: Uint8Array): Promise<void>;
  /** No more chunks: flush so `readRange` sees every byte. */
  seal(): Promise<void>;
  /** Exactly the bytes `[start, end)`; a short answer is a failure. */
  readRange(start: number, end: number): Promise<Uint8Array>;
  /** Free the storage. Idempotent. */
  discard(): Promise<void>;
}

/**
 * The durable cache of whole archives, keyed by the archive's SHA-256 (docs/spec/engine/runners.md#load-modes). The source
 * never trusts what it reads from it: a copy is re-validated like a download, and a read is checked against its digest.
 */
export interface DurablePackageStore {
  /** Bytes `[start, end)` of the archive held under `sha256`, or `null` when none is held. */
  readRange(sha256: string, start: number, end: number): Promise<Uint8Array | null>;
  /**
   * Keep the archive: `size` bytes in order, as `chunks` delivers them (already verified against the validated archive).
   * All or nothing: a rejection leaves nothing held. A `QuotaExceededError` is the store's way to say it is full.
   */
  put(sha256: string, size: number, chunks: AsyncIterable<Uint8Array>): Promise<void>;
  /** Drop the archive held under `sha256` (a copy that failed validation). Idempotent. */
  discard(sha256: string): Promise<void>;
}

export type PackageSourceOptions = {
  /** Where the package is served; it must honour a single `Range: bytes=a-b`. */
  readonly url: string;
  /** The install sidecar, as parsed from JSON and not yet trusted. */
  readonly descriptor: unknown;
  /** The package's file name, which the descriptor's `file` must equal. Defaults to the last segment of `url`. */
  readonly name?: string;
  /** The transport; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Makes the staging store. May reject (unsupported, no quota): validation then reads the network again. */
  readonly staging?: () => Promise<ArchiveStaging>;
  /** The durable cache. Consulted at open, and the target of `keep()`. */
  readonly durable?: DurablePackageStore;
  /** What the memory tier may hold of decoded entries, besides the pinned main file. Defaults to 8 MiB. */
  readonly memoryBytes?: number;
  /** The most a central-directory window may be. Defaults to 16 MiB; a larger one is refused as `archive`. */
  readonly maxDirectoryBytes?: number;
  /** Aborts the open and every later network read. */
  readonly signal?: AbortSignal;
  /** Called as the archive streams in, with bytes received and the declared total. */
  readonly onProgress?: (received: number, total: number) => void;
};

/** One file the package serves (never `manifest.json`, which is `PackageSource.manifest`). */
export type PackageEntry = {
  /** The path as stored, `/`-separated. */
  readonly path: string;
  /** The uncompressed size, as declared and verified. */
  readonly size: number;
  readonly compressedSize: number;
  /** The entry's span in the archive, `[start, end)`: its local header and its data. */
  readonly start: number;
  readonly end: number;
};

export type ReadOptions = {
  /** `false` answers from memory, staging and the durable cache only; a miss is `missing-range`. Defaults to `true`. */
  readonly network?: boolean;
};

/** Where the source's bytes have come from, for a controller and a test to assert on. */
export type PackageSourceStats = {
  /** What validation read the archive through: the staging file, the durable copy, or ranges from the network. */
  readonly validatedFrom: "staging" | "durable" | "network";
  /** `validated` (staging held, undecided), `kept` (the durable store holds it), `streaming`, or `closed`. */
  readonly phase: "validated" | "kept" | "streaming" | "closed";
  /** Why staging was wanted and not used, or failed later. */
  readonly stagingError: string | null;
  /** The last durable-store failure, including a refused `keep()`. */
  readonly durableError: string | null;
  /** Durable copies found invalid (and dropped) at open or on a read. */
  readonly durableRejected: number;
  readonly memoryHits: number;
  readonly stagingHits: number;
  readonly durableHits: number;
  /** Network range requests made (validation from the network included). */
  readonly networkReads: number;
  readonly networkBytes: number;
  /** Decoded bytes the memory tier holds now, pinned main file included. */
  readonly memoryBytes: number;
};

export interface PackageSource {
  /** The validated install descriptor. */
  readonly descriptor: InstallDescriptor;
  /** The distribution manifest, validated against every file's path. */
  readonly manifest: DistributionManifest;
  /** The manifest's main file, as stored. */
  readonly main: string;
  /** The AD-17 `GameId`, derived from the validated bytes and equal to the descriptor's. */
  readonly gameId: string;
  /** The content identity (`derivePackageIdentity` over the files but the manifest). */
  readonly gameIdentity: string;
  /** The archive's length and SHA-256 (the cache key). */
  readonly archiveSize: number;
  readonly sha256: string;
  /** The sum of every file's declared uncompressed size, the manifest's included: what keeping the package whole costs. */
  readonly totalUncompressedSize: number;
  readonly entries: readonly PackageEntry[];
  has(path: string): boolean;
  entry(path: string): PackageEntry | undefined;
  /** The memory tier's copy of an entry, or `null`. Never touches storage or the network. */
  peek(path: string): Uint8Array | null;
  /**
   * An entry's verified bytes, as a copy the caller owns: memory, then staging or the durable cache, then the network.
   * Concurrent reads of one entry share one fetch. A lower tier that fails or does not match is skipped and counted;
   * the network's failure is the failure the caller sees.
   */
  read(path: string, options?: ReadOptions): Promise<Uint8Array>;
  /**
   * Persist the validated archive through the durable store (streamed from staging, or from verified ranges when there is
   * none), then release staging. A rejection leaves the source as it was: `quota` when the store is full, `durable` for
   * any other store failure, or the source-side failure that stopped the copy.
   */
  keep(): Promise<void>;
  /** Choose streaming: release staging and read by ranges only. */
  stream(): Promise<void>;
  stats(): PackageSourceStats;
  /** Release staging, drop the memory tier and abort in-flight network reads. */
  close(): Promise<void>;
}

/** An archive being read: bytes `[start, end)` in order, in chunks of any size; a byte it cannot give is a throw. */
interface ArchiveReader {
  stream(start: number, end: number): AsyncGenerator<Uint8Array>;
}

/** What the network can tell: the URL (without its query) for messages, a signal and a way to ask. */
type Transport = {
  readonly shownUrl: string;
  readonly signal: AbortSignal;
  readonly request: (headers: Record<string, string>) => Promise<Response>;
};

function describeFailure(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

function isQuotaError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "QuotaExceededError";
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function nameFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0] ?? "";
  const last = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Check the install sidecar field by field (docs/spec/formats/packaging-and-paths.md#install-descriptor): a plain object
 * with exactly the seven fields, each of its shape. `name` is the package file the descriptor must name. Throws a
 * `PackageSourceError` of kind `descriptor` whose message says which field.
 */
export function parseInstallDescriptor(value: unknown, name: string): InstallDescriptor {
  const refuse = (detail: string): PackageSourceError => new PackageSourceError("descriptor", `runner-web: ${detail}`);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw refuse(`${name}.json is not a descriptor object`);
  }
  const record = value as Record<string, unknown>;
  const fields = ["schema", "file", "sha256", "size", "gameId", "title", "version"];
  if (Object.keys(record).length !== fields.length || fields.some((field) => !Object.prototype.hasOwnProperty.call(record, field))) {
    throw refuse(`${name}.json must contain exactly ${fields.join(", ")}`);
  }
  const { schema, file, sha256, size, gameId, title, version } = record;
  if (typeof schema !== "number" || !Number.isInteger(schema) || schema < 0) throw refuse(`${name}.json has an invalid schema`);
  if (typeof file !== "string" || file !== name) throw refuse(`descriptor names ${String(file)}, not ${name}`);
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw refuse(`descriptor size is invalid for ${name}`);
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) throw refuse("descriptor SHA-256 is invalid");
  if (typeof gameId !== "string" || gameId === "") throw refuse("descriptor gameId is invalid");
  if (typeof title !== "string" || title.trim() === "") throw refuse("descriptor title is invalid");
  if (typeof version !== "string") throw refuse("descriptor version is invalid");
  return { schema, file, sha256, size, gameId, title, version };
}

// ---------------------------------------------------------------------------------------------------------------------
// The network: whole transfer and single ranges, each held to what it must be.
// ---------------------------------------------------------------------------------------------------------------------

function networkFailure(transport: Transport, what: string, cause: unknown): PackageSourceError {
  if (transport.signal.aborted) return new PackageSourceError("aborted", `${what} was aborted`, { cause });
  return new PackageSourceError(
    "offline",
    `${what} failed: ${transport.shownUrl} could not be reached (${describeFailure(cause)})`,
    { cause },
  );
}

/** Abandon a response whose body will not be read. */
async function abandon(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is being thrown away; a cancel that fails changes nothing the caller can use.
  }
}

/** A response body as chunks, holding it to exactly `expected` bytes and cancelling what is left when the reader stops. */
async function* bodyChunks(
  transport: Transport,
  response: Response,
  expected: number,
  label: string,
  mismatch: PackageSourceFailure,
): AsyncGenerator<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    if (expected === 0) return;
    throw new PackageSourceError(mismatch, `${label} had no body, expected ${expected} bytes`);
  }
  let received = 0;
  try {
    for (;;) {
      const next = await reader.read().catch((cause: unknown) => {
        throw networkFailure(transport, label, cause);
      });
      if (next.done) break;
      received += next.value.length;
      if (received > expected) {
        throw new PackageSourceError(mismatch, `${label} delivered more than the ${expected} bytes it was asked for`);
      }
      if (next.value.length > 0) yield next.value;
    }
    if (received !== expected) {
      throw new PackageSourceError(mismatch, `${label} ended after ${received} of ${expected} bytes`);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream is finished or already broken; there is nothing left to cancel.
    }
  }
}

/** The whole archive, which a `200` with no `Range` header must deliver and which must be `size` bytes. */
async function openFullTransfer(transport: Transport, size: number): Promise<AsyncGenerator<Uint8Array>> {
  const response = await transport.request({}).catch((cause: unknown) => {
    throw networkFailure(transport, "The archive download", cause);
  });
  if (response.status !== 200) {
    await abandon(response);
    throw new PackageSourceError(
      "http",
      response.status === 206
        ? `${transport.shownUrl} answered 206 to a request that sent no Range header`
        : `${transport.shownUrl} answered ${response.status} for the archive`,
    );
  }
  const encoded = (response.headers.get("content-encoding") ?? "identity").trim().toLowerCase() !== "identity";
  const announced = response.headers.get("content-length");
  if (!encoded && announced !== null && Number(announced) !== size) {
    await abandon(response);
    throw new PackageSourceError(
      "integrity",
      `${transport.shownUrl} announces ${announced} bytes but the descriptor declares ${size}`,
    );
  }
  return bodyChunks(transport, response, size, "The archive download", "integrity");
}

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/;

/**
 * Bytes `[start, end)` of the archive by one `Range` request, accepted only as an exact `206` of the validated archive.
 * `total` is the validated archive size the response's `Content-Range` must name.
 */
async function openRangeTransfer(
  transport: Transport,
  start: number,
  end: number,
  total: number,
): Promise<AsyncGenerator<Uint8Array>> {
  const last = end - 1;
  const asked = `bytes=${start}-${last}`;
  const label = `The range ${asked}`;
  const response = await transport.request({ Range: asked }).catch((cause: unknown) => {
    throw networkFailure(transport, label, cause);
  });
  if (response.status === 200) {
    await abandon(response);
    throw new PackageSourceError(
      "range-unsupported",
      `${transport.shownUrl} answered 200 to "Range: ${asked}": the server ignores byte ranges, so it cannot serve this package by range`,
    );
  }
  if (response.status === 416) {
    await abandon(response);
    throw new PackageSourceError(
      "range-unsatisfiable",
      `${transport.shownUrl} answered 416 to "Range: ${asked}": the archive on the server is no longer the ${total} bytes that were validated`,
    );
  }
  if (response.status !== 206) {
    await abandon(response);
    throw new PackageSourceError("http", `${transport.shownUrl} answered ${response.status} to "Range: ${asked}"`);
  }
  const header = response.headers.get("content-range");
  const parsed = header === null ? null : CONTENT_RANGE.exec(header.trim());
  if (parsed === null) {
    await abandon(response);
    throw new PackageSourceError(
      "range-mismatch",
      `${transport.shownUrl} answered 206 to "Range: ${asked}" without a usable Content-Range (${String(header)})`,
    );
  }
  const [from, to, length] = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
  if (length !== total) {
    await abandon(response);
    throw new PackageSourceError(
      "integrity",
      `${transport.shownUrl} now reports a ${length}-byte archive; the validated archive is ${total} bytes`,
    );
  }
  if (from !== start || to !== last) {
    await abandon(response);
    throw new PackageSourceError(
      "range-mismatch",
      `${transport.shownUrl} answered "Range: ${asked}" with Content-Range bytes ${from}-${to}`,
    );
  }
  const encoding = (response.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
  if (encoding !== "identity") {
    await abandon(response);
    throw new PackageSourceError(
      "range-mismatch",
      `${transport.shownUrl} answered "Range: ${asked}" with Content-Encoding ${encoding}; an encoded range cannot be verified`,
    );
  }
  const announced = response.headers.get("content-length");
  if (announced !== null && Number(announced) !== end - start) {
    await abandon(response);
    throw new PackageSourceError(
      "range-mismatch",
      `${transport.shownUrl} answered "Range: ${asked}" announcing ${announced} bytes, not ${end - start}`,
    );
  }
  return bodyChunks(transport, response, end - start, label, "range-mismatch");
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading an archive: stores, the network, and the block-verified view validation reads through.
// ---------------------------------------------------------------------------------------------------------------------

/** Exactly bytes `[start, end)` of `reader`, in one array. */
async function collect(reader: ArchiveReader, start: number, end: number): Promise<Uint8Array> {
  const length = end - start;
  if (length <= 0) return new Uint8Array(0);
  const out = new Uint8Array(length);
  let filled = 0;
  for await (const chunk of reader.stream(start, end)) {
    if (filled + chunk.length > length) {
      throw new PackageSourceError("range-mismatch", `a read of bytes ${start}-${end} returned more than its ${length} bytes`);
    }
    out.set(chunk, filled);
    filled += chunk.length;
  }
  if (filled !== length) {
    throw new PackageSourceError("missing-range", `a read of bytes ${start}-${end} returned ${filled} of its ${length} bytes`);
  }
  return out;
}

/** A store (staging or durable) as a reader: its answers must be complete, in `READ_STEP_BYTES` steps. */
function storeReader(
  label: "staging" | "durable",
  read: (start: number, end: number) => Promise<Uint8Array | null>,
): ArchiveReader {
  return {
    async *stream(start, end) {
      for (let at = start; at < end; at += READ_STEP_BYTES) {
        const to = Math.min(at + READ_STEP_BYTES, end);
        const bytes = await read(at, to).catch((cause: unknown) => {
          throw new PackageSourceError(label, `the ${label} store could not read bytes ${at}-${to} (${describeFailure(cause)})`, {
            cause,
          });
        });
        if (bytes === null || bytes.length !== to - at) {
          throw new PackageSourceError(
            "missing-range",
            `the ${label} store does not hold bytes ${at}-${to} (${bytes === null ? "nothing" : `${bytes.length} bytes`})`,
          );
        }
        yield bytes;
      }
    },
  };
}

/**
 * A reader's view held to the block table: every block it returns hashes to the digest recorded while the archive was
 * transferred, so whatever backs `raw` can only ever supply the bytes that hashed to the descriptor's SHA-256. It reads
 * ahead up to `READ_STEP_BYTES` and keeps the last window, so entries that sit side by side cost one read.
 */
function verifiedReader(raw: ArchiveReader, size: number, blocks: Uint8Array): ArchiveReader {
  const blockCount = Math.ceil(size / BLOCK_BYTES);
  const aheadBlocks = READ_STEP_BYTES / BLOCK_BYTES;
  let cached: { readonly start: number; readonly bytes: Uint8Array } | null = null;

  async function readVerified(start: number, end: number): Promise<Uint8Array> {
    if (cached !== null && start >= cached.start && end <= cached.start + cached.bytes.length) {
      return cached.bytes.subarray(start - cached.start, end - cached.start);
    }
    const firstBlock = Math.floor(start / BLOCK_BYTES);
    const lastBlock = Math.max(Math.ceil(end / BLOCK_BYTES), Math.min(firstBlock + aheadBlocks, blockCount));
    const from = firstBlock * BLOCK_BYTES;
    const to = Math.min(lastBlock * BLOCK_BYTES, size);
    const bytes = await collect(raw, from, to);
    for (let block = firstBlock; block < lastBlock; block += 1) {
      const hash = createSha256();
      hash.update(bytes.subarray(block * BLOCK_BYTES - from, Math.min((block + 1) * BLOCK_BYTES, size) - from));
      if (!sameBytes(hash.digest(), blocks.subarray(block * DIGEST_BYTES, (block + 1) * DIGEST_BYTES))) {
        throw new PackageSourceError(
          "integrity",
          `bytes ${block * BLOCK_BYTES}-${Math.min((block + 1) * BLOCK_BYTES, size)} of the archive no longer match the transferred archive`,
        );
      }
    }
    cached = { start: from, bytes };
    return bytes.subarray(start - from, end - from);
  }

  return {
    async *stream(start, end) {
      for (let at = start; at < end; at += READ_STEP_BYTES) {
        yield await readVerified(at, Math.min(at + READ_STEP_BYTES, end));
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The transfer: streamed through the whole-archive hash and the block table, never held.
// ---------------------------------------------------------------------------------------------------------------------

type Ingested = {
  /** The whole archive's SHA-256, lower-case hex. */
  readonly sha256: string;
  /** One SHA-256 per `BLOCK_BYTES` block, concatenated. */
  readonly blocks: Uint8Array;
  /** The archive's last byte, which the range probe compares. */
  readonly lastByte: number;
};

async function ingestArchive(
  chunks: AsyncIterable<Uint8Array>,
  size: number,
  sink: ((chunk: Uint8Array) => Promise<void>) | null,
  onProgress: ((received: number, total: number) => void) | null,
): Promise<Ingested> {
  const whole = createSha256();
  const blocks = new Uint8Array(Math.ceil(size / BLOCK_BYTES) * DIGEST_BYTES);
  let block = createSha256();
  let blockFill = 0;
  let blockCount = 0;
  let received = 0;
  let lastByte = -1;
  for await (const chunk of chunks) {
    received += chunk.length;
    if (received > size) {
      throw new PackageSourceError("integrity", `The archive is longer than the ${size} bytes its descriptor declares`);
    }
    whole.update(chunk);
    let at = 0;
    while (at < chunk.length) {
      const take = Math.min(BLOCK_BYTES - blockFill, chunk.length - at);
      block.update(chunk.subarray(at, at + take));
      blockFill += take;
      at += take;
      if (blockFill === BLOCK_BYTES) {
        blocks.set(block.digest(), blockCount * DIGEST_BYTES);
        blockCount += 1;
        block = createSha256();
        blockFill = 0;
      }
    }
    if (chunk.length > 0) lastByte = chunk[chunk.length - 1] ?? -1;
    if (sink !== null) await sink(chunk);
    if (onProgress !== null) onProgress(received, size);
  }
  if (received !== size) {
    throw new PackageSourceError("integrity", `The archive ended after ${received} of the ${size} bytes its descriptor declares`);
  }
  if (blockFill > 0) blocks.set(block.digest(), blockCount * DIGEST_BYTES);
  return { sha256: whole.hex(), blocks, lastByte };
}

// ---------------------------------------------------------------------------------------------------------------------
// Entries: decoding one span, in validation and in every later read.
// ---------------------------------------------------------------------------------------------------------------------

/** An entry as validated: its core record, where its data starts and the digest of its raw span. */
type Held = {
  readonly path: string;
  readonly zip: ZipEntry;
  readonly dataStart: number;
  readonly end: number;
  readonly digest: Uint8Array;
};

/** Feed an entry's data chunks to its decoder and hash, giving the decoder its `final` flag on the last one. */
async function runDecoder(
  chunks: AsyncIterable<Uint8Array>,
  decoder: ZipEntryDecoder,
  hash: Sha256,
): Promise<Result<Uint8Array>> {
  let held: Uint8Array | null = null;
  for await (const chunk of chunks) {
    if (held !== null) {
      const failure = decoder.push(held, false);
      if (failure !== null) return err(failure);
    }
    hash.update(chunk);
    held = chunk;
  }
  const failure = decoder.push(held ?? new Uint8Array(0), true);
  if (failure !== null) return err(failure);
  return decoder.finish();
}

/** The data part of an entry's span: hashes the first `headerLength` bytes (the local header) and yields the rest. */
async function* dataOnly(chunks: AsyncIterable<Uint8Array>, headerLength: number, hash: Sha256): AsyncGenerator<Uint8Array> {
  let remaining = headerLength;
  for await (const chunk of chunks) {
    if (remaining === 0) {
      yield chunk;
      continue;
    }
    const take = Math.min(remaining, chunk.length);
    hash.update(chunk.subarray(0, take));
    remaining -= take;
    if (take < chunk.length) yield chunk.subarray(take);
  }
}

/**
 * An entry's verified bytes read from `reader`: its whole span must hash to the digest recorded at validation, and its
 * data must decode under L17 and L18 again. Nothing is returned until both hold, and a failure of either is `integrity`
 * — the validated bytes decode, so bytes that do not are not the validated bytes.
 */
async function readSpan(reader: ArchiveReader, entry: Held): Promise<Uint8Array> {
  const decoder = createZipEntryDecoder(entry.zip);
  if (!decoder.ok) throw new PackageSourceError("integrity", decoder.error.message, { path: entry.path });
  const hash = createSha256();
  const headerLength = entry.dataStart - entry.zip.localOffset;
  const data = dataOnly(reader.stream(entry.zip.localOffset, entry.end), headerLength, hash);
  const result = await runDecoder(data, decoder.value, hash);
  if (!result.ok) {
    throw new PackageSourceError(
      "integrity",
      `"${entry.path}" no longer decodes as the validated entry: ${result.error.message}`,
      { path: entry.path },
    );
  }
  if (!sameBytes(hash.digest(), entry.digest)) {
    throw new PackageSourceError(
      "integrity",
      `"${entry.path}" differs from the validated archive: its bytes no longer hash to the digest recorded at validation`,
      { path: entry.path },
    );
  }
  return result.value;
}

type Validated = {
  readonly entries: readonly Held[];
  readonly manifest: DistributionManifest;
  readonly gameIdentity: string;
  readonly gameId: string;
  readonly totalUncompressedSize: number;
};

/**
 * Walk the archive entry by entry through `reader` (which must already be held to the block table) with core's readers,
 * keeping only each entry's digest, its content hash and, for the manifest, its bytes.
 */
async function validateArchive(
  reader: ArchiveReader,
  size: number,
  name: string,
  maxDirectoryBytes: number,
): Promise<Validated> {
  const refuse = (error: FormatError): PackageSourceError =>
    new PackageSourceError("archive", `runner-web: ${name} refused: ${error.message}`);

  const tailRange = zipTailRange(size);
  const located = locateZipDirectory(await collect(reader, tailRange.start, tailRange.end), size, name);
  if (!located.ok) throw refuse(located.error);
  const location = located.value;
  const directoryBytes = size - location.cdOffset;
  if (directoryBytes > maxDirectoryBytes) {
    throw new PackageSourceError(
      "archive",
      `runner-web: ${name} refused: its central directory window is ${directoryBytes} bytes and this source reads at most ${maxDirectoryBytes} (central directory window)`,
    );
  }
  const parsed = readZipDirectory(await collect(reader, location.cdOffset, size), location, size, name);
  if (!parsed.ok) throw refuse(parsed.error);

  const manifestKey = assetKey(MANIFEST_FILE_NAME);
  const held: Held[] = [];
  const paths: string[] = [];
  const records: string[] = [];
  const contentHashes = new Map<AssetKey, string>();
  let manifestBytes: Uint8Array | undefined;
  let total = 0;
  for (const zip of parsed.value) {
    if (zip.directory) continue;
    paths.push(zip.path);
    total += zip.uncompressedSize;

    const headerStart = Math.min(zip.localOffset, size);
    const fixed = await collect(reader, headerStart, Math.min(headerStart + ZIP_LOCAL_HEADER_BYTES, size));
    const header = await collect(reader, headerStart, Math.min(headerStart + zipLocalHeaderBytesNeeded(fixed), size));
    const checked = checkZipLocalHeader(zip, header, size);
    if (!checked.ok) throw refuse(checked.error);
    const dataStart = checked.value;
    const end = dataStart + zip.compressedSize;

    const decoder = createZipEntryDecoder(zip);
    if (!decoder.ok) throw refuse(decoder.error);
    const hash = createSha256();
    hash.update(header);
    const decoded = await runDecoder(reader.stream(dataStart, end), decoder.value, hash);
    if (!decoded.ok) throw refuse(decoded.error);

    const key = assetKey(zip.path);
    const contentHash = fnv1a64(decoded.value);
    contentHashes.set(key, contentHash);
    if (key === manifestKey) manifestBytes = decoded.value;
    if (zip.path === MANIFEST_FILE_NAME) continue;
    records.push(packageIdentityRecord(zip.path, contentHash));
    held.push({ path: zip.path, zip, dataStart, end, digest: hash.digest() });
  }

  const manifest = readDistributionManifestFrom(name, manifestBytes, paths);
  if (!manifest.ok) throw refuse(manifest.error);
  const mainHash = contentHashes.get(assetKey(manifest.value.main));
  if (mainHash === undefined) {
    throw new PackageSourceError("archive", `runner-web: ${name} refused: the main file ${manifest.value.main} is absent`);
  }
  const gameIdentity = foldPackageIdentity(records);
  return {
    entries: held,
    manifest: manifest.value,
    gameIdentity,
    gameId: deriveGameIdFromContentHash(mainHash, gameIdentity),
    totalUncompressedSize: total,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The source.
// ---------------------------------------------------------------------------------------------------------------------

type Tier = { readonly name: "staging" | "durable" | "network"; readonly reader: ArchiveReader };

/**
 * Open a package: transfer it whole, validate every entry, and return a source that serves entries by range.
 *
 * Rejects with a `PackageSourceError`; nothing is left behind (staging is discarded) when it does.
 */
export async function openPackageSource(options: PackageSourceOptions): Promise<PackageSource> {
  const name = options.name ?? nameFromUrl(options.url);
  const descriptor = parseInstallDescriptor(options.descriptor, name);
  const size = descriptor.size;
  if (size > PACKAGE_LIMITS.maxCompressedInputBytes) {
    throw new PackageSourceError(
      "archive",
      `runner-web: ${name} refused: the descriptor declares ${size} bytes; the limit is ${PACKAGE_LIMITS.maxCompressedInputBytes} bytes (max compressed input, L1)`,
    );
  }
  const memoryBudget = options.memoryBytes ?? DEFAULT_MEMORY_BYTES;
  const maxDirectoryBytes = options.maxDirectoryBytes ?? DEFAULT_DIRECTORY_BYTES;
  const fetchFn: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const progress = options.onProgress ?? null;
  const durable = options.durable;

  const lifetime = new AbortController();
  const forwardAbort = (): void => lifetime.abort();
  if (options.signal !== undefined) {
    if (options.signal.aborted) lifetime.abort();
    else options.signal.addEventListener("abort", forwardAbort, { once: true });
  }
  const transport: Transport = {
    shownUrl: options.url.split(/[?#]/)[0] ?? options.url,
    signal: lifetime.signal,
    request: async (headers) => fetchFn(options.url, { headers, signal: lifetime.signal }),
  };
  const networkStats = { reads: 0, bytes: 0 };
  const networkReader: ArchiveReader = {
    async *stream(start, end) {
      if (end <= start) return;
      networkStats.reads += 1;
      for await (const chunk of await openRangeTransfer(transport, start, end, size)) {
        networkStats.bytes += chunk.length;
        yield chunk;
      }
    },
  };
  const durableReader = (): ArchiveReader =>
    storeReader("durable", (start, end) => (durable === undefined ? Promise.resolve(null) : durable.readRange(descriptor.sha256, start, end)));

  let staging: ArchiveStaging | null = null;
  let stagingError: string | null = null;
  let durableError: string | null = null;
  let durableRejected = 0;
  let durableHeld = false;
  let validatedFrom: "staging" | "durable" | "network" = "network";
  let ingested: Ingested | null = null;

  const dropStaging = async (): Promise<void> => {
    const dead = staging;
    staging = null;
    if (dead === null) return;
    try {
      await dead.discard();
    } catch (cause) {
      stagingError = `the staging store could not be discarded (${describeFailure(cause)})`;
    }
  };

  /** A durable copy that failed: forget it, drop it from the store, and say why. */
  const dropDurable = async (reason: string): Promise<void> => {
    durableHeld = false;
    durableRejected += 1;
    durableError = reason;
    if (durable === undefined) return;
    await durable.discard(descriptor.sha256).catch((failure: unknown) => {
      durableError = `${reason}; it could not be dropped (${describeFailure(failure)})`;
    });
  };

  let validated: Validated;
  try {
    // 1. A durable copy is read like a download: hashed whole, then validated. It is never trusted for being there.
    if (durable !== undefined) {
      let present = false;
      try {
        present = (await durable.readRange(descriptor.sha256, 0, Math.min(1, size))) !== null;
      } catch (cause) {
        durableError = `the durable store could not be read (${describeFailure(cause)})`;
      }
      if (present) {
        try {
          const copy = await ingestArchive(durableReader().stream(0, size), size, null, progress);
          if (copy.sha256 !== descriptor.sha256) {
            throw new PackageSourceError("integrity", `the durable copy hashes to ${copy.sha256}, not ${descriptor.sha256}`);
          }
          ingested = copy;
          validatedFrom = "durable";
        } catch (cause) {
          if (cause instanceof PackageSourceError && cause.kind === "aborted") throw cause;
          await dropDurable(`the durable copy was refused (${describeFailure(cause)})`);
        }
      }
    }

    // 2. Otherwise the whole archive streams in from the network, into staging when there is one.
    if (ingested === null) {
      const chunks = await openFullTransfer(transport, size);
      if (options.staging !== undefined) {
        try {
          staging = await options.staging();
        } catch (cause) {
          stagingError = `no staging store (${describeFailure(cause)}); validating from the network instead`;
        }
      }
      let sink: ((chunk: Uint8Array) => Promise<void>) | null = null;
      if (staging !== null) {
        sink = async (chunk) => {
          if (staging === null) return;
          try {
            await staging.append(chunk);
          } catch (cause) {
            stagingError = `the staging store refused bytes (${describeFailure(cause)}); validating from the network instead`;
            await dropStaging();
          }
        };
      }
      ingested = await ingestArchive(chunks, size, sink, progress);
      if (ingested.sha256 !== descriptor.sha256) {
        throw new PackageSourceError(
          "integrity",
          `runner-web: ${name} hashes to ${ingested.sha256}, not the descriptor's ${descriptor.sha256}`,
        );
      }
      if (staging !== null) {
        try {
          await staging.seal();
          validatedFrom = "staging";
        } catch (cause) {
          stagingError = `the staging store could not be sealed (${describeFailure(cause)}); validating from the network instead`;
          await dropStaging();
        }
      }
    }

    // 3. Validation reads the archive back through the block table, entry by entry. A local copy that fails under it
    //    is dropped and the network is read instead: the table, not the copy, says what the archive is.
    const localReader: ArchiveReader | null =
      validatedFrom === "durable"
        ? durableReader()
        : validatedFrom === "staging" && staging !== null
          ? storeReader("staging", (start, end) => (staging === null ? Promise.resolve(null) : staging.readRange(start, end)))
          : null;
    try {
      validated = await validateArchive(verifiedReader(localReader ?? networkReader, size, ingested.blocks), size, name, maxDirectoryBytes);
    } catch (cause) {
      const copyFailed =
        localReader !== null &&
        cause instanceof PackageSourceError &&
        (cause.kind === "integrity" || cause.kind === "missing-range" || cause.kind === "staging" || cause.kind === "durable");
      if (!copyFailed) throw cause;
      if (validatedFrom === "durable") {
        await dropDurable(`the durable copy failed validation (${describeFailure(cause)})`);
      } else {
        stagingError = `the staging copy failed validation (${describeFailure(cause)}); validating from the network instead`;
        await dropStaging();
      }
      validatedFrom = "network";
      validated = await validateArchive(verifiedReader(networkReader, size, ingested.blocks), size, name, maxDirectoryBytes);
    }
    if (validated.gameId !== descriptor.gameId) {
      throw new PackageSourceError(
        "identity",
        `runner-web: descriptor gameId does not match ${validated.manifest.main} and its package identity`,
      );
    }

    // 4. A transfer that never used a range is proved to support them before the source is handed out.
    if (validatedFrom === "staging") {
      const probe = await collect(networkReader, size - 1, size);
      if (probe[0] !== ingested.lastByte) {
        throw new PackageSourceError("integrity", `${transport.shownUrl} serves a last byte that differs from the transferred archive`);
      }
    }
  } catch (cause) {
    options.signal?.removeEventListener("abort", forwardAbort);
    lifetime.abort();
    await dropStaging();
    throw cause;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Serving.
  // -------------------------------------------------------------------------------------------------------------------

  const blocks = ingested.blocks;
  let phase: "validated" | "kept" | "streaming" | "closed" = validatedFrom === "durable" ? "kept" : "validated";
  durableHeld = validatedFrom === "durable";
  const byKey = new Map<AssetKey, Held>();
  for (const entry of validated.entries) byKey.set(assetKey(entry.path), entry);
  const entries: readonly PackageEntry[] = validated.entries.map((entry) => ({
    path: entry.path,
    size: entry.zip.uncompressedSize,
    compressedSize: entry.zip.compressedSize,
    start: entry.zip.localOffset,
    end: entry.end,
  }));
  const publicEntries = new Map<string, PackageEntry>(entries.map((entry) => [entry.path, entry]));

  const counters = { memoryHits: 0, stagingHits: 0, durableHits: 0 };
  const memory = new Map<string, Uint8Array>();
  const pinned = new Set<string>();
  let memoryUsed = 0;
  let pinnedUsed = 0;
  const inflight = new Map<string, Promise<Uint8Array>>();
  let busy = false;

  const lookup = (path: string): Held | undefined => byKey.get(assetKey(path));
  const assertOpen = (): void => {
    if (phase === "closed") throw new PackageSourceError("closed", "the package source is closed");
  };

  /** Keep a decoded entry in the memory tier when the budget allows (the pinned main file always). */
  function remember(entry: Held, bytes: Uint8Array): boolean {
    const isPinned = pinned.has(entry.path);
    if (!isPinned && bytes.length > memoryBudget) return false;
    const existing = memory.get(entry.path);
    if (existing !== undefined) {
      memory.delete(entry.path);
      memoryUsed -= existing.length;
      if (isPinned) pinnedUsed -= existing.length;
    }
    memory.set(entry.path, bytes);
    memoryUsed += bytes.length;
    if (isPinned) pinnedUsed += bytes.length;
    for (const [key, value] of memory) {
      if (memoryUsed - pinnedUsed <= memoryBudget) break;
      if (pinned.has(key)) continue;
      memory.delete(key);
      memoryUsed -= value.length;
    }
    return memory.get(entry.path) === bytes;
  }

  const tiers = (): readonly Tier[] => {
    const list: Tier[] = [];
    const held = staging;
    if (held !== null) list.push({ name: "staging", reader: storeReader("staging", (start, end) => held.readRange(start, end)) });
    if (durableHeld) list.push({ name: "durable", reader: durableReader() });
    list.push({ name: "network", reader: networkReader });
    return list;
  };

  async function loadEntry(entry: Held, network: boolean): Promise<Uint8Array> {
    const skipped: string[] = [];
    for (const tier of tiers()) {
      if (tier.name === "network" && !network) continue;
      try {
        const bytes = await readSpan(tier.reader, entry);
        if (tier.name === "staging") counters.stagingHits += 1;
        else if (tier.name === "durable") counters.durableHits += 1;
        remember(entry, bytes);
        return bytes;
      } catch (error) {
        if (!(error instanceof PackageSourceError) || error.kind === "aborted" || error.kind === "closed") throw error;
        if (tier.name === "network") throw error;
        skipped.push(`${tier.name}: ${error.message}`);
        if (tier.name === "durable") await dropDurable(`the durable copy failed a read (${error.message})`);
        else {
          stagingError = `the staging copy failed a read (${error.message})`;
          await dropStaging();
        }
      }
    }
    throw new PackageSourceError(
      "missing-range",
      `"${entry.path}" is in no local tier and the network was not asked (${skipped.length === 0 ? "nothing is held" : skipped.join("; ")})`,
      { path: entry.path },
    );
  }

  const source: PackageSource = {
    descriptor,
    manifest: validated.manifest,
    main: validated.manifest.main,
    gameId: validated.gameId,
    gameIdentity: validated.gameIdentity,
    archiveSize: size,
    sha256: descriptor.sha256,
    totalUncompressedSize: validated.totalUncompressedSize,
    entries,
    has: (path) => lookup(path) !== undefined,
    entry: (path) => {
      const held = lookup(path);
      return held === undefined ? undefined : publicEntries.get(held.path);
    },
    peek(path) {
      const held = lookup(path);
      return held === undefined ? null : (memory.get(held.path)?.slice() ?? null);
    },
    async read(path, readOptions = {}) {
      assertOpen();
      const entry = lookup(path);
      if (entry === undefined) {
        throw new PackageSourceError("missing-entry", `the package has no file ${path}`, { path });
      }
      const cached = memory.get(entry.path);
      if (cached !== undefined) {
        memory.delete(entry.path);
        memory.set(entry.path, cached);
        counters.memoryHits += 1;
        return cached.slice();
      }
      const network = readOptions.network ?? true;
      const key = `${network ? "n" : "l"}:${entry.path}`;
      let flight = inflight.get(key);
      if (flight === undefined) {
        flight = loadEntry(entry, network).finally(() => inflight.delete(key));
        inflight.set(key, flight);
      }
      return (await flight).slice();
    },
    async keep() {
      assertOpen();
      if (busy) throw new PackageSourceError("closed", "another keep() or stream() is still running");
      if (phase === "streaming") throw new PackageSourceError("closed", "stream() was chosen; the archive is not kept");
      if (phase === "kept") return;
      if (durable === undefined) throw new PackageSourceError("durable", "no durable store was given to keep the archive in");
      busy = true;
      try {
        const held = staging;
        const raw: ArchiveReader =
          held === null ? networkReader : storeReader("staging", (start, end) => held.readRange(start, end));
        try {
          await durable.put(descriptor.sha256, size, verifiedReader(raw, size, blocks).stream(0, size));
        } catch (cause) {
          if (cause instanceof PackageSourceError) throw cause;
          durableError = `the durable store refused the archive (${describeFailure(cause)})`;
          await durable.discard(descriptor.sha256).catch(() => undefined);
          throw new PackageSourceError(isQuotaError(cause) ? "quota" : "durable", durableError, { cause });
        }
        durableHeld = true;
        phase = "kept";
        await dropStaging();
      } finally {
        busy = false;
      }
    },
    async stream() {
      assertOpen();
      if (busy) throw new PackageSourceError("closed", "another keep() or stream() is still running");
      if (phase === "kept") throw new PackageSourceError("closed", "the archive was kept; it cannot be switched to streaming");
      phase = "streaming";
      await dropStaging();
    },
    stats: () => ({
      validatedFrom,
      phase,
      stagingError,
      durableError,
      durableRejected,
      memoryHits: counters.memoryHits,
      stagingHits: counters.stagingHits,
      durableHits: counters.durableHits,
      networkReads: networkStats.reads,
      networkBytes: networkStats.bytes,
      memoryBytes: memoryUsed,
    }),
    async close() {
      if (phase === "closed") return;
      phase = "closed";
      options.signal?.removeEventListener("abort", forwardAbort);
      lifetime.abort();
      memory.clear();
      memoryUsed = 0;
      pinnedUsed = 0;
      await dropStaging();
    },
  };

  // The main file is what boots the game, so it is read now (from staging or the network) and stays in memory.
  const mainEntry = lookup(validated.manifest.main);
  if (mainEntry !== undefined) {
    pinned.add(mainEntry.path);
    try {
      await source.read(mainEntry.path);
    } catch (cause) {
      await source.close();
      throw cause;
    }
  }
  return source;
}
