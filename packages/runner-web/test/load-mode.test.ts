import { deepEqual, equal, ok } from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import {
  deriveGameId,
  derivePackageIdentity,
  writeDistributionPackage,
  type PackageFile,
} from "@tk-reawakened/core";
import { sha256Hex } from "@tk-reawakened/synth";
import { createLoadController, WHOLE_PACKAGE_THRESHOLD_BYTES, type LoadState, type StorageManagerLike } from "../src/load-mode.ts";
import { PackageSourceError, type DurablePackageStore } from "../src/package-source.ts";

// The load-mode controller against a real HTTP server that honours (or refuses) byte ranges, so what is asserted about
// "streaming" is that single `Range` requests actually crossed the wire, not that a stub was called.

const NAME = "demo.tpk";
const MAIN = "Main/game.gam";

function noise(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = seed >>> 0 || 1;
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

function fixture(): { readonly bytes: Uint8Array; readonly files: readonly PackageFile[]; readonly descriptor: Record<string, unknown>; readonly uncompressed: number } {
  const files: PackageFile[] = [
    { path: "Boards/a.brd", bytes: noise(30_000, 3) },
    { path: "Media/song.mid", bytes: noise(20_000, 5) },
    { path: MAIN, bytes: noise(900, 7) },
  ].sort((left, right) => (left.path < right.path ? -1 : 1));
  const written = writeDistributionPackage({ files, manifest: { schema: 1, main: MAIN, index: files.map((file) => file.path) } });
  if (!written.ok) throw new Error(written.error.message);
  const main = files.find((file) => file.path === MAIN)!;
  const manifestBytes = new TextEncoder().encode(JSON.stringify({ schema: 1, main: MAIN, index: files.map((file) => file.path) })).length;
  return {
    bytes: written.value,
    files,
    uncompressed: files.reduce((total, file) => total + file.bytes.length, 0) + manifestBytes,
    descriptor: {
      schema: 1,
      file: NAME,
      sha256: sha256Hex(written.value),
      size: written.value.length,
      gameId: deriveGameId(main.bytes, derivePackageIdentity(files)),
      title: "Fixture",
      version: "1.0.0",
    },
  };
}

type Wire = { readonly requests: string[]; ranges: boolean };

/** A real HTTP server for one archive. `ranges: false` makes it ignore `Range`, like a static host that does not support it. */
async function serve(bytes: Uint8Array, wire: Wire): Promise<{ readonly url: string; close(): Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const header = request.headers.range;
    wire.requests.push(typeof header === "string" ? header : "full");
    if (typeof header !== "string" || !wire.ranges) {
      response.writeHead(200, { "content-length": bytes.length, "accept-ranges": wire.ranges ? "bytes" : "none" });
      response.end(bytes);
      return;
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(header);
    const start = match === null ? Number.NaN : Number(match[1]);
    const end = match === null ? Number.NaN : Math.min(Number(match[2]), bytes.length - 1);
    if (!(start <= end)) {
      response.writeHead(416, { "content-range": `bytes */${bytes.length}` });
      response.end();
      return;
    }
    const slice = bytes.subarray(start, end + 1);
    response.writeHead(206, { "content-range": `bytes ${start}-${end}/${bytes.length}`, "content-length": slice.length });
    response.end(slice);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no server address");
  return {
    url: `http://127.0.0.1:${address.port}/${NAME}`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

function memoryDurable(options: { readonly putFailure?: Error } = {}): { readonly store: DurablePackageStore; readonly held: Map<string, Uint8Array> } {
  const held = new Map<string, Uint8Array>();
  return {
    held,
    store: {
      async readRange(sha256, start, end) {
        return held.get(sha256)?.slice(start, end) ?? null;
      },
      async put(sha256, size, chunks) {
        const archive = new Uint8Array(size);
        let at = 0;
        for await (const chunk of chunks) {
          if (options.putFailure !== undefined) throw options.putFailure;
          archive.set(chunk, at);
          at += chunk.length;
        }
        held.set(sha256, archive);
      },
      async discard(sha256) {
        held.delete(sha256);
      },
    },
  };
}

function quotaError(): Error {
  const error = new Error("over quota");
  error.name = "QuotaExceededError";
  return error;
}

const grants: StorageManagerLike = { persist: async () => true, persisted: async () => false };
const denies: StorageManagerLike = { persist: async () => false, persisted: async () => false };

test("the threshold is the measured 31 MiB the spec table records", () => {
  equal(WHOLE_PACKAGE_THRESHOLD_BYTES, 31 * 1024 * 1024);
});

test("a package at or below the threshold is kept whole, persistence is asked and reported, and the archive is durable", async () => {
  const made = fixture();
  const wire: Wire = { requests: [], ranges: true };
  const server = await serve(made.bytes, wire);
  const durable = memoryDurable();
  const seen: LoadState[] = [];
  const controller = createLoadController({ url: server.url, descriptor: made.descriptor, durable: durable.store, storage: grants, thresholdBytes: made.uncompressed });
  controller.subscribe((state) => seen.push(state));
  try {
    const source = await controller.load();
    const state = controller.state();
    equal(state.phase, "ready");
    equal(state.mode, "whole", "exactly at the threshold is whole");
    deepEqual(state.storage, { persisted: "granted", quota: "ok", kept: true, error: null });
    equal(durable.held.get(String(made.descriptor.sha256))?.length, made.bytes.length, "the validated archive is in the durable store");
    equal(source.totalUncompressedSize, made.uncompressed);
    ok(seen.some((s) => s.progress.total === made.bytes.length && s.progress.received === made.bytes.length), "progress reaches the declared size");
    ok(seen.at(-1)?.phase === "ready");
    await source.close();
  } finally {
    await server.close();
  }
});

test("one byte over the threshold streams: nothing is kept, persistence is not asked, and entries arrive by single byte ranges", async () => {
  const made = fixture();
  const wire: Wire = { requests: [], ranges: true };
  const server = await serve(made.bytes, wire);
  const durable = memoryDurable();
  const controller = createLoadController({ url: server.url, descriptor: made.descriptor, durable: durable.store, storage: grants, thresholdBytes: made.uncompressed - 1 });
  try {
    const source = await controller.load();
    const state = controller.state();
    equal(state.mode, "streaming");
    deepEqual(state.storage, { persisted: "not-requested", quota: "not-needed", kept: false, error: null });
    equal(durable.held.size, 0);
    const before = wire.requests.filter((request) => request.startsWith("bytes=")).length;
    const bytes = await source.read("Boards/a.brd");
    deepEqual(bytes, made.files.find((file) => file.path === "Boards/a.brd")!.bytes);
    const after = wire.requests.filter((request) => request.startsWith("bytes=")).length;
    ok(after > before, "the read is served by a new byte-range request, never by a second whole download");
    equal(wire.requests.filter((request) => request === "full").length, 1, "the first launch transfers the whole archive exactly once");
    await source.close();
  } finally {
    await server.close();
  }
});

test("forced modes override the size: whole for a huge threshold-busting package, streaming for a small one", async () => {
  const made = fixture();
  const wire: Wire = { requests: [], ranges: true };
  const server = await serve(made.bytes, wire);
  try {
    const forcedStream = createLoadController({ url: server.url, descriptor: made.descriptor, mode: "streaming", durable: memoryDurable().store });
    await (await forcedStream.load()).close();
    equal(forcedStream.state().mode, "streaming");
    const forcedWhole = createLoadController({ url: server.url, descriptor: made.descriptor, mode: "whole", thresholdBytes: 1, durable: memoryDurable().store, storage: grants });
    await (await forcedWhole.load()).close();
    equal(forcedWhole.state().mode, "whole");
  } finally {
    await server.close();
  }
});

test("quota on the durable put falls back to real streaming, reports quota-limited, and reports an unpersisted answer independently", async () => {
  const made = fixture();
  const wire: Wire = { requests: [], ranges: true };
  const server = await serve(made.bytes, wire);
  const durable = memoryDurable({ putFailure: quotaError() });
  const controller = createLoadController({ url: server.url, descriptor: made.descriptor, durable: durable.store, storage: denies });
  try {
    const source = await controller.load();
    const state = controller.state();
    equal(state.phase, "ready", "the player still boots");
    equal(state.mode, "streaming");
    equal(state.storage.quota, "limited");
    equal(state.storage.persisted, "denied", "an unpersisted result is its own field");
    equal(state.storage.kept, false);
    ok(state.storage.error?.includes("over quota") === true, "the reason is the store's own message");
    equal(durable.held.size, 0, "nothing half-kept");
    const bytes = await source.read("Media/song.mid");
    deepEqual(bytes, made.files.find((file) => file.path === "Media/song.mid")!.bytes);
    ok(wire.requests.some((request) => request.startsWith("bytes=")), "bytes came by a real range request of the same single-file package");
    await source.close();
  } finally {
    await server.close();
  }
});

test("a store failure that is not quota also streams, and says so without calling it quota", async () => {
  const made = fixture();
  const wire: Wire = { requests: [], ranges: true };
  const server = await serve(made.bytes, wire);
  const durable = memoryDurable({ putFailure: new Error("disk is on fire") });
  const controller = createLoadController({ url: server.url, descriptor: made.descriptor, durable: durable.store, storage: grants });
  try {
    await (await controller.load()).close();
    const state = controller.state();
    equal(state.mode, "streaming");
    equal(state.storage.quota, "ok");
    equal(state.storage.persisted, "granted");
    ok(state.storage.error !== null);
  } finally {
    await server.close();
  }
});

test("a browser that cannot be asked about persistence is reported as unsupported, not as denied", async () => {
  const made = fixture();
  const wire: Wire = { requests: [], ranges: true };
  const server = await serve(made.bytes, wire);
  const controller = createLoadController({ url: server.url, descriptor: made.descriptor, durable: memoryDurable().store });
  try {
    await (await controller.load()).close();
    equal(controller.state().storage.persisted, "unsupported");
    const throwing = createLoadController({
      url: server.url,
      descriptor: made.descriptor,
      durable: memoryDurable().store,
      storage: { persist: async () => { throw new Error("blocked by policy"); } },
    });
    await (await throwing.load()).close();
    equal(throwing.state().storage.persisted, "failed");
  } finally {
    await server.close();
  }
});

test("offline: a second launch needs no network once the package was kept, and a miss with nothing kept is an explicit offline error", async () => {
  const made = fixture();
  const wire: Wire = { requests: [], ranges: true };
  const server = await serve(made.bytes, wire);
  const durable = memoryDurable();
  try {
    await (await createLoadController({ url: server.url, descriptor: made.descriptor, durable: durable.store, storage: grants }).load()).close();
  } finally {
    await server.close();
  }
  let calls = 0;
  const unreachable = (async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const relaunch = createLoadController({ url: "http://127.0.0.1:9/demo.tpk", descriptor: made.descriptor, durable: durable.store, fetch: unreachable, storage: grants });
  const source = await relaunch.load();
  equal(relaunch.state().phase, "ready");
  equal(relaunch.state().mode, "whole");
  equal(calls, 0, "no request at all");
  deepEqual(await source.read("Boards/a.brd"), made.files.find((file) => file.path === "Boards/a.brd")!.bytes);
  await source.close();

  const miss = createLoadController({ url: "http://127.0.0.1:9/demo.tpk", descriptor: made.descriptor, durable: memoryDurable().store, fetch: unreachable });
  let failure: unknown;
  try {
    await miss.load();
  } catch (error) {
    failure = error;
  }
  ok(failure instanceof PackageSourceError);
  equal(failure.kind, "offline");
  equal(miss.state().phase, "failed");
  equal(miss.state().error, failure);
});

test("a server that does not honour byte ranges is refused outright: there is no whole-package fallback that pretends to stream", async () => {
  const made = fixture();
  const wire: Wire = { requests: [], ranges: false };
  const server = await serve(made.bytes, wire);
  const controller = createLoadController({ url: server.url, descriptor: made.descriptor, mode: "streaming", durable: memoryDurable().store });
  try {
    let failure: unknown;
    try {
      await controller.load();
    } catch (error) {
      failure = error;
    }
    ok(failure instanceof PackageSourceError);
    equal(failure.kind, "range-unsupported");
    equal(controller.state().phase, "failed");
    equal(controller.state().mode, null);
  } finally {
    await server.close();
  }
});

test("load() runs once however often it is called, and a bad threshold or mode is refused up front", async () => {
  const made = fixture();
  const wire: Wire = { requests: [], ranges: true };
  const server = await serve(made.bytes, wire);
  try {
    const controller = createLoadController({ url: server.url, descriptor: made.descriptor, durable: memoryDurable().store, storage: grants });
    const [first, second] = await Promise.all([controller.load(), controller.load()]);
    equal(first, second);
    equal(wire.requests.filter((request) => request === "full").length, 1);
    await first.close();
  } finally {
    await server.close();
  }
  let refused = 0;
  for (const bad of [{ thresholdBytes: -1 }, { thresholdBytes: 1.5 }, { mode: "lazy" as "auto" }]) {
    try {
      createLoadController({ url: "http://x/demo.tpk", descriptor: {}, ...bad });
    } catch (error) {
      if (error instanceof RangeError) refused += 1;
    }
  }
  equal(refused, 3);
});
