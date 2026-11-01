// The package source (issue #934, docs/spec/engine/runners.md#load-modes): a package is transferred whole, validated entry
// by entry with core's own readers, and then served by verified byte ranges. These tests drive the shipped source against
// a real `node:http` range server for the protocol, and against an in-process `fetch` for the failure shapes a real
// server is awkward to produce. Every fixture is built by the landed writer, and every expectation about identity comes
// from the whole-memory path (`derivePackageIdentity`, `loadPackage`), so the two cannot drift.

import { deepEqual, equal, ok } from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import {
  assetKey,
  deriveGameId,
  derivePackageIdentity,
  loadPackage,
  readDistributionManifest,
  writeDistributionPackage,
  type PackageFile,
  type Result,
} from "@tk-reawakened/core";
import { sha256Hex } from "@tk-reawakened/synth";
import { interactivePackage } from "../src/index.ts";
import {
  openPackageSource,
  PackageSourceError,
  parseInstallDescriptor,
  type ArchiveStaging,
  type DurablePackageStore,
  type PackageSource,
  type PackageSourceFailure,
  type PackageSourceOptions,
} from "../src/package-source.ts";

const NAME = "demo.tpk";
const encoder = new TextEncoder();

function text(value: string): Uint8Array {
  return encoder.encode(value);
}

/** A deterministic byte stream (xorshift32), so fixtures never touch `Math.random`. `alphabet` small means compressible. */
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

function same(left: Uint8Array | null, right: Uint8Array): boolean {
  if (left === null || left.length !== right.length) return false;
  for (let index = 0; index < right.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------------------------------------------------

type Fixture = {
  readonly bytes: Uint8Array;
  readonly files: readonly PackageFile[];
  readonly main: string;
  readonly descriptor: Record<string, unknown>;
};

/** A package of `files` (sorted by path) with a valid install descriptor whose `gameId` comes from the whole-memory path. */
function makeFixture(files: readonly PackageFile[], main = "Main/game.gam"): Fixture {
  const bytes = unwrap(
    writeDistributionPackage({ files, manifest: { schema: 1, main, index: files.map((file) => file.path) } }),
  );
  const mainFile = files.find((file) => file.path === main);
  if (mainFile === undefined) throw new Error("the fixture has no main file");
  return {
    bytes,
    files,
    main,
    descriptor: {
      schema: 1,
      file: NAME,
      sha256: sha256Hex(bytes),
      size: bytes.length,
      gameId: deriveGameId(mainFile.bytes, derivePackageIdentity(files)),
      title: "Fixture",
      version: "1.0.0",
    },
  };
}

/** The same descriptor for different bytes: only the archive's hash and size follow them. */
function describeBytes(fixture: Fixture, bytes: Uint8Array): Record<string, unknown> {
  return { ...fixture.descriptor, sha256: sha256Hex(bytes), size: bytes.length };
}

const BIG = noise(200_000, 7); // incompressible: stored, and spans several 64 KiB blocks
const TEXTY = noise(150_000, 3, 12, 65); // compressible: deflated
const FILES: readonly PackageFile[] = [
  { path: "Boards/a.brd", bytes: TEXTY },
  { path: "Main/game.gam", bytes: text("main file bytes") },
  { path: "Media/big.mid", bytes: BIG },
  { path: "Media/empty.dat", bytes: new Uint8Array(0) },
  { path: "Tiles/set.tst", bytes: text("tiles") },
];
const FIXTURE = makeFixture(FILES);

/** Small enough that a test can try hundreds of one-byte corruptions of it. */
const TINY = makeFixture([
  { path: "Data/a.txt", bytes: text("a small text file, deflate may or may not shrink it") },
  { path: "Data/b.bin", bytes: noise(90, 11) },
  { path: "Main/game.gam", bytes: text("main") },
]);

function flipped(bytes: Uint8Array, at: number): Uint8Array {
  const copy = bytes.slice();
  copy[at] = (copy[at] ?? 0) ^ 0xff;
  return copy;
}

// ---------------------------------------------------------------------------------------------------------------------
// The remote: an in-process `fetch` and a real HTTP server with the same behaviour and the same switches.
// ---------------------------------------------------------------------------------------------------------------------

type Remote = {
  bytes: Uint8Array;
  /** Each request's `Range` header, or `"full"`. */
  readonly requests: string[];
  mode: "ok" | "ignore-range" | "refuse-416" | "offline";
  /** Replaces the answer to a satisfiable `bytes=a-b` request. */
  respond: ((start: number, end: number, total: number) => Response) | null;
};

function remote(bytes: Uint8Array): Remote {
  return { bytes, requests: [], mode: "ok", respond: null };
}

/** `bytes` as a body that arrives in `piece`-byte chunks, as a network delivers it. */
function streamOf(bytes: Uint8Array, piece: number): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      const next = bytes.slice(at, Math.min(at + piece, bytes.length));
      at += next.length;
      controller.enqueue(next);
    },
  });
}

function rangeFetch(state: Remote, piece = 40_000): typeof fetch {
  return async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.signal?.aborted === true) throw new Error("aborted");
    const range = new Headers(init?.headers).get("range");
    state.requests.push(range ?? "full");
    if (state.mode === "offline") throw new TypeError("fetch failed");
    const total = state.bytes.length;
    if (range === null || state.mode === "ignore-range") {
      return new Response(streamOf(state.bytes, piece), { status: 200, headers: { "content-length": String(total) } });
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = match === null ? Number.NaN : Number(match[1]);
    const end = match === null ? Number.NaN : Math.min(Number(match[2]), total - 1);
    if (state.mode === "refuse-416" || !(start <= end)) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}` } });
    }
    if (state.respond !== null) return state.respond(start, end, total);
    const body = new Uint8Array(state.bytes.subarray(start, end + 1));
    return new Response(body, {
      status: 206,
      headers: { "content-range": `bytes ${start}-${end}/${total}`, "content-length": String(body.length) },
    });
  };
}

async function serve(state: Remote): Promise<{ readonly url: string; close(): Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const header = request.headers.range;
    const range = typeof header === "string" ? header : null;
    state.requests.push(range ?? "full");
    const bytes = state.bytes;
    if (range === null || state.mode === "ignore-range") {
      response.writeHead(200, { "content-length": bytes.length });
      response.end(bytes);
      return;
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = match === null ? Number.NaN : Number(match[1]);
    const end = match === null ? Number.NaN : Math.min(Number(match[2]), bytes.length - 1);
    if (state.mode === "refuse-416" || !(start <= end)) {
      response.writeHead(416, { "content-range": `bytes */${bytes.length}`, "content-length": 0 });
      response.end();
      return;
    }
    response.writeHead(206, { "content-range": `bytes ${start}-${end}/${bytes.length}`, "content-length": end - start + 1 });
    response.end(bytes.subarray(start, end + 1));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the test server has no port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The host's stores: a staging file and a durable cache, as in-memory doubles that record what they were asked.
// ---------------------------------------------------------------------------------------------------------------------

type StagingLog = { readonly appended: number[]; readonly reads: number[]; sealed: boolean; discarded: boolean };

function memoryStaging(
  options: { readonly failAppendAt?: number; readonly corrupt?: boolean } = {},
): { readonly make: () => Promise<ArchiveStaging>; readonly log: StagingLog } {
  const log: StagingLog = { appended: [], reads: [], sealed: false, discarded: false };
  const parts: Uint8Array[] = [];
  let joined = new Uint8Array(0);
  const staging: ArchiveStaging = {
    async append(chunk) {
      if (options.failAppendAt !== undefined && log.appended.length === options.failAppendAt) throw new Error("disk full");
      log.appended.push(chunk.length);
      parts.push(chunk.slice());
    },
    async seal() {
      log.sealed = true;
      joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
      let at = 0;
      for (const part of parts) {
        joined.set(part, at);
        at += part.length;
      }
    },
    async readRange(start, end) {
      log.reads.push(end - start);
      return options.corrupt === true ? new Uint8Array(end - start) : joined.slice(start, end);
    },
    async discard() {
      log.discarded = true;
    },
  };
  return { make: async () => staging, log };
}

type DurableLog = { readonly reads: number[]; readonly discards: string[]; puts: number };

function memoryDurable(
  options: { readonly putFailure?: Error } = {},
): { readonly store: DurablePackageStore; readonly held: Map<string, Uint8Array>; readonly log: DurableLog } {
  const held = new Map<string, Uint8Array>();
  const log: DurableLog = { reads: [], discards: [], puts: 0 };
  const store: DurablePackageStore = {
    async readRange(sha256, start, end) {
      const bytes = held.get(sha256);
      if (bytes === undefined) return null;
      log.reads.push(end - start);
      return bytes.slice(start, end);
    },
    async put(sha256, size, chunks) {
      log.puts += 1;
      const parts: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of chunks) {
        parts.push(chunk.slice());
        total += chunk.length;
        if (options.putFailure !== undefined) throw options.putFailure;
      }
      equal(total, size, "the store is handed exactly the archive");
      const archive = new Uint8Array(total);
      let at = 0;
      for (const part of parts) {
        archive.set(part, at);
        at += part.length;
      }
      held.set(sha256, archive);
    },
    async discard(sha256) {
      log.discards.push(sha256);
      held.delete(sha256);
    },
  };
  return { store, held, log };
}

function quotaError(): Error {
  const error = new Error("the origin is over its quota");
  error.name = "QuotaExceededError";
  return error;
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers for the assertions.
// ---------------------------------------------------------------------------------------------------------------------

async function rejects(kind: PackageSourceFailure, work: Promise<unknown>): Promise<PackageSourceError> {
  try {
    await work;
  } catch (error) {
    ok(error instanceof PackageSourceError, `expected a PackageSourceError, got ${String(error)}`);
    equal(error.kind, kind, error.message);
    return error;
  }
  throw new Error(`expected a ${kind} failure, but the work succeeded`);
}

function open(
  fixture: Fixture,
  state: Remote,
  extra: Partial<PackageSourceOptions> = {},
): Promise<PackageSource> {
  return openPackageSource({
    url: `https://games.test/${NAME}`,
    descriptor: fixture.descriptor,
    fetch: rangeFetch(state),
    ...extra,
  });
}

function entryOf(source: PackageSource, path: string): { readonly start: number; readonly end: number } {
  const entry = source.entry(path);
  if (entry === undefined) throw new Error(`no entry ${path}`);
  return entry;
}

// ---------------------------------------------------------------------------------------------------------------------
// The protocol, against a real HTTP server.
// ---------------------------------------------------------------------------------------------------------------------

test("a real HTTP server: the archive streams in once, validates from staging, then entries come back by single byte range", async () => {
  const state = remote(FIXTURE.bytes);
  const server = await serve(state);
  try {
    const staged = memoryStaging();
    const source = await openPackageSource({
      url: `${server.url}/${NAME}`,
      descriptor: FIXTURE.descriptor,
      staging: staged.make,
    });
    try {
      equal(source.gameId, FIXTURE.descriptor.gameId);
      equal(source.stats().validatedFrom, "staging");
      equal(staged.log.sealed, true);
      equal(staged.log.appended.reduce((sum, length) => sum + length, 0), FIXTURE.bytes.length);
      // One full transfer and the one-byte probe: validation read the staging copy, not the network.
      const last = FIXTURE.bytes.length - 1;
      deepEqual(state.requests, ["full", `bytes=${last}-${last}`]);

      await source.stream();
      equal(staged.log.discarded, true);
      equal(source.stats().phase, "streaming");

      const before = state.requests.length;
      const others = FILES.filter((file) => file.path !== FIXTURE.main);
      for (const file of others) ok(same(await source.read(file.path), file.bytes), file.path);
      deepEqual(
        state.requests.slice(before),
        others.map((file) => {
          const entry = entryOf(source, file.path);
          return `bytes=${entry.start}-${entry.end - 1}`;
        }),
      );

      // Every entry is now held in memory, so asking again is free.
      const reads = source.stats().networkReads;
      for (const file of FILES) ok(same(await source.read(file.path), file.bytes), file.path);
      equal(source.stats().networkReads, reads);
    } finally {
      await source.close();
    }
  } finally {
    await server.close();
  }
});

test("a real HTTP server whose content changed after validation cannot feed the engine a byte", async () => {
  const state = remote(FIXTURE.bytes);
  const server = await serve(state);
  try {
    const source = await openPackageSource({ url: `${server.url}/${NAME}`, descriptor: FIXTURE.descriptor });
    try {
      await source.stream();
      const big = entryOf(source, "Media/big.mid");

      // Same length, one byte of the entry's data different: a valid 206 that is not the validated archive.
      state.bytes = flipped(FIXTURE.bytes, big.end - 10);
      const failure = await rejects("integrity", source.read("Media/big.mid"));
      equal(failure.path, "Media/big.mid");
      equal(source.peek("Media/big.mid"), null, "nothing of the failed read is kept");
      // An entry whose own bytes did not change still verifies against its own digest.
      ok(same(await source.read("Tiles/set.tst"), text("tiles")));

      // A server that now holds a different-length archive is refused whatever bytes it serves.
      state.bytes = FIXTURE.bytes.subarray(0, FIXTURE.bytes.length - 1);
      await rejects("integrity", source.read("Boards/a.brd"));
      state.bytes = new Uint8Array([...FIXTURE.bytes, 0]);
      await rejects("integrity", source.read("Boards/a.brd"));

      // Put back, the same entry reads again.
      state.bytes = FIXTURE.bytes;
      ok(same(await source.read("Media/big.mid"), BIG));
    } finally {
      await source.close();
    }
  } finally {
    await server.close();
  }
});

test("a real HTTP server that ignores Range is refused at open, and the staging copy is not left behind", async () => {
  const state = remote(FIXTURE.bytes);
  state.mode = "ignore-range";
  const server = await serve(state);
  try {
    const staged = memoryStaging();
    const failure = await rejects(
      "range-unsupported",
      openPackageSource({ url: `${server.url}/${NAME}`, descriptor: FIXTURE.descriptor, staging: staged.make }),
    );
    ok(failure.message.includes("ignores byte ranges"), failure.message);
    equal(staged.log.discarded, true);
  } finally {
    await server.close();
  }
});

test("a real HTTP server that cannot satisfy ranges answers 416, which is range-unsatisfiable", async () => {
  const state = remote(FIXTURE.bytes);
  state.mode = "refuse-416";
  const server = await serve(state);
  try {
    await rejects(
      "range-unsatisfiable",
      openPackageSource({ url: `${server.url}/${NAME}`, descriptor: FIXTURE.descriptor, staging: memoryStaging().make }),
    );
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// What a range response must be.
// ---------------------------------------------------------------------------------------------------------------------

test("a 206 is accepted only as exactly the bytes asked for, of the validated archive", async () => {
  const cases: readonly (readonly [string, PackageSourceFailure, (start: number, end: number, total: number) => Response])[] = [
    [
      "a Content-Range for other bytes",
      "range-mismatch",
      (start, end, total) =>
        new Response(new Uint8Array(1), { status: 206, headers: { "content-range": `bytes ${start - 1}-${end - 1}/${total}` } }),
    ],
    ["no Content-Range", "range-mismatch", () => new Response(new Uint8Array(1), { status: 206 })],
    [
      "a Content-Range in another unit",
      "range-mismatch",
      (start, end, total) =>
        new Response(new Uint8Array(1), { status: 206, headers: { "content-range": `items ${start}-${end}/${total}` } }),
    ],
    [
      "a content-encoded range",
      "range-mismatch",
      (start, end, total) =>
        new Response(new Uint8Array(1), {
          status: 206,
          headers: { "content-range": `bytes ${start}-${end}/${total}`, "content-encoding": "gzip" },
        }),
    ],
    [
      "a Content-Length that is not the range",
      "range-mismatch",
      (start, end, total) =>
        new Response(new Uint8Array(1), {
          status: 206,
          headers: { "content-range": `bytes ${start}-${end}/${total}`, "content-length": "2" },
        }),
    ],
    [
      "a body shorter than the range",
      "range-mismatch",
      (start, end, total) =>
        new Response(new Uint8Array(0), { status: 206, headers: { "content-range": `bytes ${start}-${end}/${total}` } }),
    ],
    [
      "a body longer than the range",
      "range-mismatch",
      (start, end, total) =>
        new Response(new Uint8Array(2), { status: 206, headers: { "content-range": `bytes ${start}-${end}/${total}` } }),
    ],
    [
      "a different archive length",
      "integrity",
      (start, end, total) =>
        new Response(new Uint8Array(1), { status: 206, headers: { "content-range": `bytes ${start}-${end}/${total + 1}` } }),
    ],
    ["another status", "http", () => new Response("no", { status: 500 })],
  ];
  for (const [label, kind, respond] of cases) {
    const state = remote(TINY.bytes);
    state.respond = respond;
    const staged = memoryStaging();
    const failure = await rejects(kind, open(TINY, state, { staging: staged.make }));
    ok(failure.message.length > 0, label);
    equal(staged.log.discarded, true, `${label}: staging is discarded`);
  }
});

test("a server that ignores Range is refused whether or not there is a staging copy to validate from", async () => {
  for (const staging of [true, false]) {
    const state = remote(FIXTURE.bytes);
    state.mode = "ignore-range";
    const extra: Partial<PackageSourceOptions> = staging ? { staging: memoryStaging().make } : {};
    await rejects("range-unsupported", open(FIXTURE, state, extra));
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// The descriptor does not prove the archive, and the archive does not prove the descriptor.
// ---------------------------------------------------------------------------------------------------------------------

test("the descriptor's SHA-256, size and gameId must each match what was transferred", async () => {
  const wrongHash = { ...FIXTURE.descriptor, sha256: sha256Hex(text("another archive")) };
  const failure = await rejects("integrity", open({ ...FIXTURE, descriptor: wrongHash }, remote(FIXTURE.bytes)));
  ok(failure.message.includes("hashes to"), failure.message);

  const wrongSize = { ...FIXTURE.descriptor, size: FIXTURE.bytes.length + 1 };
  await rejects("integrity", open({ ...FIXTURE, descriptor: wrongSize }, remote(FIXTURE.bytes)));

  const wrongId = { ...FIXTURE.descriptor, gameId: "0000000000000000" };
  const identity = await rejects("identity", open({ ...FIXTURE, descriptor: wrongId }, remote(FIXTURE.bytes)));
  ok(identity.message.includes("gameId"), identity.message);
});

test("an archive larger than L1 allows is refused from the descriptor, before anything is requested", async () => {
  let asked = 0;
  const failure = await rejects(
    "archive",
    openPackageSource({
      url: `https://games.test/${NAME}`,
      descriptor: { ...FIXTURE.descriptor, size: 268_435_457 },
      fetch: async () => {
        asked += 1;
        throw new Error("must not be asked");
      },
    }),
  );
  ok(failure.message.includes("L1"), failure.message);
  equal(asked, 0);
});

test("a malformed install descriptor names the field, and its file must be the package's name", async () => {
  const good = FIXTURE.descriptor;
  const bad: readonly (readonly [string, unknown])[] = [
    ["not an object", null],
    ["an array", []],
    ["a missing field", { ...good, title: undefined }],
    ["an extra field", { ...good, extra: 1 }],
    ["a bad schema", { ...good, schema: -1 }],
    ["another file", { ...good, file: "other.tpk" }],
    ["a fractional size", { ...good, size: 1.5 }],
    ["an upper-case hash", { ...good, sha256: String(good.sha256).toUpperCase() }],
    ["an empty gameId", { ...good, gameId: "" }],
    ["a blank title", { ...good, title: "  " }],
    ["a numeric version", { ...good, version: 1 }],
  ];
  for (const [label, value] of bad) {
    let thrown: unknown = null;
    try {
      parseInstallDescriptor(value, NAME);
    } catch (error) {
      thrown = error;
    }
    ok(thrown instanceof PackageSourceError, label);
    equal(thrown.kind, "descriptor", label);
  }
  deepEqual(parseInstallDescriptor(good, NAME), good);
  await rejects("descriptor", open({ ...FIXTURE, descriptor: { ...good, schema: -1 } }, remote(FIXTURE.bytes)));
  await rejects("descriptor", open(FIXTURE, remote(FIXTURE.bytes), { name: "other.tpk" }));
});

// ---------------------------------------------------------------------------------------------------------------------
// The archive's own limits, through core's readers.
// ---------------------------------------------------------------------------------------------------------------------

test("an archive that breaks a package rule is refused with the rule, even when its descriptor is honest", async () => {
  // L18: one byte of a stored entry's data differs, so its CRC-32 no longer matches.
  const probe = await open(FIXTURE, remote(FIXTURE.bytes));
  const big = entryOf(probe, "Media/big.mid");
  await probe.close();
  const corrupt = flipped(FIXTURE.bytes, big.end - 10);
  const crc = await rejects("archive", open({ ...FIXTURE, descriptor: describeBytes(FIXTURE, corrupt) }, remote(corrupt)));
  ok(crc.message.includes("L18") && crc.message.includes("Media/big.mid"), crc.message);

  // L19: the local header names another file than the central directory does.
  const renamed = TINY.bytes.slice();
  const at = indexOf(renamed, text("Data/a.txt"));
  renamed[at] = 0x58;
  const header = await rejects("archive", open({ ...TINY, descriptor: describeBytes(TINY, renamed) }, remote(renamed)));
  ok(header.message.includes("L19"), header.message);

  // No manifest: the package carries `manifest.json` under no name that is one.
  const unnamed = TINY.bytes.slice();
  for (let found = indexOf(unnamed, text("manifest.json")); found >= 0; found = indexOf(unnamed, text("manifest.json"))) {
    unnamed.set(text("manifexx.json"), found);
  }
  const manifest = await rejects("archive", open({ ...TINY, descriptor: describeBytes(TINY, unnamed) }, remote(unnamed)));
  ok(manifest.message.includes("manifest"), manifest.message);

  // Not a ZIP at all.
  const junk = noise(400, 5);
  await rejects("archive", open({ ...TINY, descriptor: describeBytes(TINY, junk) }, remote(junk)));
});

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  for (let at = 0; at + needle.length <= haystack.length; at += 1) {
    let matched = true;
    for (let index = 0; index < needle.length && matched; index += 1) matched = haystack[at + index] === needle[index];
    if (matched) return at;
  }
  return -1;
}

test("every one-byte corruption of a package is accepted or refused exactly as the whole-memory loader would", async () => {
  const reference = (bytes: Uint8Array): boolean => {
    const loaded = loadPackage({ kind: "tpk", name: NAME, bytes });
    if (!loaded.ok) return false;
    const manifest = readDistributionManifest(loaded.value);
    if (!manifest.ok) return false;
    const files = loaded.value.files.filter((file) => file.path !== "manifest.json");
    const main = files.find((file) => assetKey(file.path) === assetKey(manifest.value.main));
    return main !== undefined && deriveGameId(main.bytes, derivePackageIdentity(files)) === TINY.descriptor.gameId;
  };
  ok(reference(TINY.bytes), "the uncorrupted package is accepted");
  let accepted = 0;
  for (let at = 0; at < TINY.bytes.length; at += 1) {
    const bytes = flipped(TINY.bytes, at);
    let opened = false;
    try {
      const source = await open({ ...TINY, descriptor: describeBytes(TINY, bytes) }, remote(bytes));
      opened = true;
      accepted += 1;
      await source.close();
    } catch (error) {
      ok(error instanceof PackageSourceError, `byte ${at}: ${String(error)}`);
    }
    equal(opened, reference(bytes), `corrupting byte ${at}`);
  }
  ok(accepted > 0 && accepted < TINY.bytes.length, "some corruptions are harmless and most are not");
});

test("the source derives the same identity and manifest as the whole-memory path", async () => {
  const source = await open(FIXTURE, remote(FIXTURE.bytes));
  try {
    const whole = await interactivePackage(NAME, FIXTURE.bytes, FIXTURE.descriptor);
    equal(source.gameId, whole.gameId);
    equal(source.gameIdentity, whole.gameIdentity);
    equal(source.main, whole.main);
    deepEqual(source.entries.map((entry) => entry.path).sort(), [...whole.files.keys()].sort());
    for (const [path, bytes] of whole.files) ok(same(await source.read(path), bytes), path);
    equal(source.archiveSize, FIXTURE.bytes.length);
    equal(source.sha256, FIXTURE.descriptor.sha256);
    // The sum of the declared sizes, the manifest's own included.
    const loaded = unwrap(loadPackage({ kind: "tpk", name: NAME, bytes: FIXTURE.bytes }));
    equal(
      source.totalUncompressedSize,
      loaded.files.reduce((sum, file) => sum + file.bytes.length, 0),
    );
    ok(!source.has("manifest.json"), "the manifest is source.manifest, not a served file");
    deepEqual(source.manifest.index, FILES.map((file) => file.path));
  } finally {
    await source.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Staging, and the network when there is none.
// ---------------------------------------------------------------------------------------------------------------------

test("the archive arrives in chunks and is read back from staging in bounded steps, never whole", async () => {
  const large = makeFixture([
    { path: "Main/game.gam", bytes: text("main") },
    { path: "Media/large.bin", bytes: noise(1_400_000, 21) },
  ]);
  const state = remote(large.bytes);
  const staged = memoryStaging();
  const source = await open(large, state, { staging: staged.make });
  try {
    ok(staged.log.appended.length > 10, "the transfer was delivered in many chunks");
    ok(Math.max(...staged.log.appended) < large.bytes.length / 10, "no chunk was a meaningful part of the archive");
    ok(staged.log.reads.length > 0);
    ok(Math.max(...staged.log.reads) <= 1_048_576, "every read of staging was one bounded step");
    equal(source.stats().memoryBytes, 4, "only the main file is held after validation");
    equal(source.stats().networkReads, 1, "the network was asked for the probe alone");
    await source.stream();
    ok(same(await source.read("Media/large.bin"), noise(1_400_000, 21)));
  } finally {
    await source.close();
  }
});

test("with no staging store the archive is validated from verified ranges of the network, and the reason is reported", async () => {
  const state = remote(FIXTURE.bytes);
  const source = await open(FIXTURE, state, {
    staging: async () => {
      throw quotaError();
    },
  });
  try {
    const stats = source.stats();
    equal(stats.validatedFrom, "network");
    ok(stats.stagingError?.includes("no staging store") === true, String(stats.stagingError));
    equal(state.requests[0], "full");
    ok(state.requests.length > 1 && state.requests.slice(1).every((range) => range.startsWith("bytes=")));
    ok(stats.networkBytes >= FIXTURE.bytes.length - 2_000, "validation read the whole archive again by range");
    for (const file of FILES) ok(same(await source.read(file.path), file.bytes), file.path);
  } finally {
    await source.close();
  }
});

test("a staging store that fails mid-transfer, or hands back other bytes, is dropped and validation continues from the network", async () => {
  const refusing = memoryStaging({ failAppendAt: 1 });
  const first = await open(FIXTURE, remote(FIXTURE.bytes), { staging: refusing.make });
  try {
    equal(first.stats().validatedFrom, "network");
    ok(first.stats().stagingError?.includes("refused bytes") === true, String(first.stats().stagingError));
    equal(refusing.log.discarded, true);
    equal(first.gameId, FIXTURE.descriptor.gameId);
  } finally {
    await first.close();
  }

  const corrupt = memoryStaging({ corrupt: true });
  const second = await open(FIXTURE, remote(FIXTURE.bytes), { staging: corrupt.make });
  try {
    equal(second.stats().validatedFrom, "network");
    ok(second.stats().stagingError?.includes("failed validation") === true, String(second.stats().stagingError));
    equal(corrupt.log.discarded, true);
    for (const file of FILES) ok(same(await second.read(file.path), file.bytes), file.path);
  } finally {
    await second.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// The controller's choice, and the durable cache.
// ---------------------------------------------------------------------------------------------------------------------

test("keep() persists the validated archive and releases staging; later reads come from the durable cache", async () => {
  const state = remote(FIXTURE.bytes);
  const staged = memoryStaging();
  const durable = memoryDurable();
  const source = await open(FIXTURE, state, { staging: staged.make, durable: durable.store });
  try {
    equal(source.stats().phase, "validated");
    equal(staged.log.discarded, false, "staging is held until the controller chooses");
    await source.keep();
    equal(source.stats().phase, "kept");
    equal(staged.log.discarded, true);
    ok(same(durable.held.get(source.sha256) ?? null, FIXTURE.bytes), "the durable store holds the archive byte for byte");

    const requests = state.requests.length;
    for (const file of FILES) ok(same(await source.read(file.path), file.bytes), file.path);
    equal(state.requests.length, requests, "no network read once the archive is kept");
    ok(source.stats().durableHits > 0);
    await source.keep(); // already kept: nothing to do
    await rejects("closed", source.stream());
  } finally {
    await source.close();
  }
});

test("a kept package opens again with no network at all, and is validated like a download", async () => {
  const durable = memoryDurable();
  const first = await open(FIXTURE, remote(FIXTURE.bytes), { staging: memoryStaging().make, durable: durable.store });
  await first.keep();
  await first.close();

  const offline = remote(FIXTURE.bytes);
  offline.mode = "offline";
  const second = await open(FIXTURE, offline, { durable: durable.store });
  try {
    equal(second.stats().validatedFrom, "durable");
    equal(second.stats().phase, "kept");
    deepEqual(offline.requests, [], "the network was never asked");
    for (const file of FILES) ok(same(await second.read(file.path), file.bytes), file.path);
    equal(second.stats().networkReads, 0);
    equal(second.gameId, FIXTURE.descriptor.gameId);
  } finally {
    await second.close();
  }
});

test("a corrupt durable copy is dropped at open and the network is read instead; with no network, open fails offline", async () => {
  const durable = memoryDurable();
  const first = await open(FIXTURE, remote(FIXTURE.bytes), { staging: memoryStaging().make, durable: durable.store });
  await first.keep();
  await first.close();
  durable.held.set(String(FIXTURE.descriptor.sha256), flipped(FIXTURE.bytes, 1_000));

  const state = remote(FIXTURE.bytes);
  const source = await open(FIXTURE, state, { durable: durable.store });
  try {
    equal(source.stats().durableRejected, 1);
    ok(source.stats().durableError?.includes("refused") === true, String(source.stats().durableError));
    deepEqual(durable.log.discards, [FIXTURE.descriptor.sha256]);
    equal(source.stats().validatedFrom, "network");
    ok(state.requests[0] === "full");
  } finally {
    await source.close();
  }

  durable.held.set(String(FIXTURE.descriptor.sha256), flipped(FIXTURE.bytes, 1_000));
  const down = remote(FIXTURE.bytes);
  down.mode = "offline";
  await rejects("offline", open(FIXTURE, down, { durable: durable.store }));
});

test("a durable entry that no longer matches its digest is skipped for the network, and offline it is a failure", async () => {
  const state = remote(FIXTURE.bytes);
  const durable = memoryDurable();
  const source = await open(FIXTURE, state, { staging: memoryStaging().make, durable: durable.store });
  try {
    await source.keep();
    const big = entryOf(source, "Media/big.mid");
    durable.held.set(source.sha256, flipped(FIXTURE.bytes, big.end - 10));
    const reads = source.stats().networkReads;
    ok(same(await source.read("Media/big.mid"), BIG), "served from the network, and correct");
    equal(source.stats().networkReads, reads + 1);
    equal(source.stats().durableRejected, 1);
    deepEqual(durable.log.discards, [source.sha256]);

    state.mode = "offline";
    await rejects("offline", source.read("Boards/a.brd", { network: true }));
  } finally {
    await source.close();
  }
});

test("a quota failure on keep() is reported, leaves nothing held, and stream() then selects real streaming", async () => {
  const state = remote(FIXTURE.bytes);
  const staged = memoryStaging();
  const durable = memoryDurable({ putFailure: quotaError() });
  const source = await open(FIXTURE, state, { staging: staged.make, durable: durable.store });
  try {
    const failure = await rejects("quota", source.keep());
    ok(failure.cause instanceof Error && failure.cause.name === "QuotaExceededError");
    equal(durable.held.size, 0, "nothing is held after a failed put");
    ok(source.stats().durableError?.includes("refused") === true, String(source.stats().durableError));
    equal(source.stats().phase, "validated");
    equal(staged.log.discarded, false, "the staging copy is still there for the controller's next choice");
    ok(same(await source.read("Boards/a.brd"), TEXTY), "reads still work");

    await source.stream();
    equal(source.stats().phase, "streaming");
    equal(staged.log.discarded, true);
    const reads = source.stats().networkReads;
    ok(same(await source.read("Media/big.mid"), BIG));
    equal(source.stats().networkReads, reads + 1, "streaming reads by range");
    await rejects("closed", source.keep());
  } finally {
    await source.close();
  }
});

test("another store failure on keep() is durable, and keeping with no store at all says so", async () => {
  const durable = memoryDurable({ putFailure: new Error("the store is read-only") });
  const source = await open(FIXTURE, remote(FIXTURE.bytes), { staging: memoryStaging().make, durable: durable.store });
  try {
    await rejects("durable", source.keep());
  } finally {
    await source.close();
  }
  const bare = await open(FIXTURE, remote(FIXTURE.bytes));
  try {
    await rejects("durable", bare.keep());
  } finally {
    await bare.close();
  }
});

test("keep() with no staging copy streams the archive again by verified range", async () => {
  const state = remote(FIXTURE.bytes);
  const durable = memoryDurable();
  const source = await open(FIXTURE, state, { durable: durable.store });
  try {
    equal(source.stats().stagingError, null, "no staging was asked for");
    const reads = source.stats().networkReads;
    await source.keep();
    ok(source.stats().networkReads > reads);
    ok(same(durable.held.get(source.sha256) ?? null, FIXTURE.bytes));
  } finally {
    await source.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Reads: memory, the network's failures, and concurrency.
// ---------------------------------------------------------------------------------------------------------------------

test("offline and missing-range failures are explicit and distinct", async () => {
  const state = remote(FIXTURE.bytes);
  const source = await open(FIXTURE, state);
  try {
    state.mode = "offline";
    const down = await rejects("offline", source.read("Boards/a.brd"));
    ok(down.message.includes("could not be reached"), down.message);
    const cacheOnly = await rejects("missing-range", source.read("Boards/a.brd", { network: false }));
    equal(cacheOnly.path, "Boards/a.brd");
    // The pinned main file is in memory, so it answers with the network down.
    ok(same(await source.read(FIXTURE.main, { network: false }), text("main file bytes")));
    await rejects("missing-entry", source.read("Nope/none.bin"));
    state.mode = "ok";
    ok(same(await source.read("Boards/a.brd"), TEXTY));
  } finally {
    await source.close();
  }
});

test("the memory tier keeps decoded entries within its budget, evicts the oldest, and pins the main file", async () => {
  const fixture = makeFixture([
    { path: "Data/a.bin", bytes: noise(100_000, 1) },
    { path: "Data/b.bin", bytes: noise(100_000, 2) },
    { path: "Data/huge.bin", bytes: noise(200_000, 3) },
    { path: "Main/game.gam", bytes: text("main") },
  ]);
  const state = remote(fixture.bytes);
  const source = await open(fixture, state, { memoryBytes: 150_000 });
  try {
    ok(same(source.peek("Main/game.gam"), text("main")), "main is pinned from the start");
    ok(source.peek("Data/a.bin") === null);
    await source.read("Data/a.bin");
    ok(source.peek("Data/a.bin") !== null);
    await source.read("Data/b.bin");
    equal(source.peek("Data/a.bin"), null, "the oldest entry made room");
    ok(source.peek("Data/b.bin") !== null);
    ok(source.stats().memoryBytes <= 150_000 + 4);

    // An entry larger than the whole budget is served but never kept.
    ok(same(await source.read("Data/huge.bin"), noise(200_000, 3)));
    equal(source.peek("Data/huge.bin"), null);
    const reads = source.stats().networkReads;
    await source.read("Data/huge.bin");
    equal(source.stats().networkReads, reads + 1);

    // A copy the caller changes is not the cache's copy.
    const copy = await source.read("Data/b.bin");
    copy[0] = (copy[0] ?? 0) ^ 0xff;
    ok(same(await source.read("Data/b.bin"), noise(100_000, 2)));
    ok(source.stats().memoryHits > 0);
  } finally {
    await source.close();
  }
});

test("concurrent reads of one entry share one fetch and each get their own copy", async () => {
  const state = remote(FIXTURE.bytes);
  const source = await open(FIXTURE, state);
  try {
    const reads = source.stats().networkReads;
    const [first, second] = await Promise.all([source.read("Media/big.mid"), source.read("Media/big.mid")]);
    equal(source.stats().networkReads, reads + 1);
    ok(same(first, BIG) && same(second, BIG));
    ok(first !== second, "the copies are separate arrays");
  } finally {
    await source.close();
  }
});

test("entries are found the way the resolver finds them, and a closed source refuses reads", async () => {
  const source = await open(FIXTURE, remote(FIXTURE.bytes));
  ok(source.has("tiles\\SET.TST") && source.has("Tiles/Set.tst"));
  equal(source.entry("TILES/set.tst")?.path, "Tiles/set.tst");
  ok(!source.has("Tiles/other.tst"));
  equal(source.entry("Media/empty.dat")?.size, 0);
  ok(same(await source.read("media/EMPTY.dat"), new Uint8Array(0)));
  await source.close();
  await rejects("closed", source.read("Tiles/set.tst"));
  equal(source.stats().phase, "closed");
});

test("an aborted signal is its own failure, not offline", async () => {
  const controller = new AbortController();
  controller.abort();
  await rejects("aborted", open(FIXTURE, remote(FIXTURE.bytes), { signal: controller.signal }));
});

test("an unreachable server is an offline failure at open, with the URL's query kept out of the message", async () => {
  const state = remote(FIXTURE.bytes);
  state.mode = "offline";
  const failure = await rejects(
    "offline",
    openPackageSource({
      url: `https://games.test/${NAME}?token=secret`,
      descriptor: FIXTURE.descriptor,
      fetch: rangeFetch(state),
    }),
  );
  ok(!failure.message.includes("secret"), failure.message);
  ok(failure.message.includes("https://games.test/demo.tpk"), failure.message);
});
