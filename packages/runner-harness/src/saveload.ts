/**
 * The Save/Load fixture's driver (ticket #934, plan AC2): the real engine, the real request/reply protocol, and a blob
 * host the caller supplies.
 *
 * `tools/fixtures/author/generate.mjs` writes the fixture, a tiny package whose board enter program performs a real
 * `Save("slot")` and, on a later launch, a real `Load("slot")`
 * (docs/spec/formats/save-game.md#reawakened-full-engine-save-and-load, docs/spec/engine/main-loop-and-startup.md#e-120).
 * `runSaveLoadFixture` boots it twice over one host (launch one saves, launch two loads) with `createEngine` and the pump
 * the live web session uses: `advance`, answer every request, advance again until the batch settles. It is host-agnostic
 * on purpose: the headless baseline runs it over `createMemoryBlobHost()`, and the browser acceptance runs the same
 * function over the IndexedDB host, so both observe one contract. Nothing here touches a file, a global or a clock
 * (G2/G3 spirit; this package has no DOM or Node types).
 *
 * The host sees what `createLiveSession` hands its `LiveBlobHost`: the area, the `GameId`, and the path *relative* to
 * the `GameId`. The engine's request carries the `GameId`-prefixed path (`<GameId>/saved/slot.sav`); this driver
 * strips that prefix exactly once, as the live session does, and records the unstripped request.
 */

import {
  assetKey,
  createAssetIndex,
  createEngine,
  deriveGameId,
  derivePackageIdentity,
  PACKAGE_ROOT,
  type AssetKey,
  type Engine,
  type GameState,
  type InputRecord,
  type RunnerRequest,
} from "@tk-reawakened/core";

/** The blob host contract `createLiveSession` consumes (`LiveBlobHost` in runner-web), restated so this package stays pure. */
export type SaveLoadBlobHost = {
  read(area: "saves" | "files", gameId: string, path: string): Promise<Uint8Array | null>;
  write(area: "saves" | "files", gameId: string, path: string, bytes: Uint8Array): Promise<boolean>;
  list?(area: "saves" | "files", gameId: string): Promise<readonly string[]>;
};

/** One `saveBlob` request as the engine emitted it. */
export type SaveLoadSaveRequest = {
  readonly area: "saves" | "files";
  /** The `GameId`-prefixed path the engine asked for, e.g. `<GameId>/saved/slot.sav`. */
  readonly path: string;
  /** The harness blob key `area:path` (`packages/runner-harness/src/script-host.ts` `blobKey`). */
  readonly key: string;
  /** The save's length in bytes. */
  readonly byteLength: number;
};

/** One `loadBlob` request as the engine emitted it, with whether the host had bytes for it. */
export type SaveLoadLoadRequest = {
  readonly area: "saves" | "files";
  readonly path: string;
  readonly key: string;
  readonly found: boolean;
};

/** The facts of one boot of the fixture. */
export type SaveLoadLaunch = {
  readonly saveRequests: readonly SaveLoadSaveRequest[];
  readonly loadRequests: readonly SaveLoadLoadRequest[];
  /** The report hash and the `marker` script variable on the tick the first blob request was issued: the game before anything was saved or restored. */
  readonly fresh: SaveLoadMoment;
  /** On the tick the `saveBlob` request was issued, or `null` when the launch saved nothing. */
  readonly preSave: SaveLoadMoment | null;
  /** On the tick that consumed the `loadBlob` reply, or `null` when the launch loaded nothing. */
  readonly postLoad: SaveLoadMoment | null;
  /** After the last tick the launch ran. */
  readonly final: SaveLoadMoment;
  /** `true` when the script's `saveOk = save("slot")` saw success, `false` when it saw failure, `null` when no save request was issued. */
  readonly saveOk: boolean | null;
  /** Located runtime diagnostics the engine reported, as `code`s in order. */
  readonly diagnostics: readonly string[];
};

/** A state hash with the tick it was reported on and the `marker` global at that moment (`null` when unset). */
export type SaveLoadMoment = {
  readonly tick: number;
  readonly stateHash: string;
  readonly marker: number | null;
};

export type SaveLoadRun = {
  readonly gameId: string;
  /** The `saveBlob` request launch one emitted. */
  readonly saveRequest: SaveLoadSaveRequest;
  /** The `loadBlob` request launch two emitted. */
  readonly loadRequest: SaveLoadLoadRequest;
  /** The state hash after launch two's last tick, the game that loaded the save and ran on. */
  readonly finalStateHash: string;
  /** Launch two's last tick. */
  readonly tick: number;
  readonly saved: SaveLoadLaunch;
  readonly loaded: SaveLoadLaunch;
};

export type SaveLoadOptions = {
  /** The fixture package's files, by path inside the package (`main.gam`, `Boards/start.brd`, `Prg/saveload.prg`). */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Where saves go. It must hold no save for this game's `GameId` yet. */
  readonly host: SaveLoadBlobHost;
  /** Ticks each launch runs; the default outlasts the enter program's one-second `delay`. */
  readonly ticks?: number;
};

/** The ticks a launch runs by default: the script's `delay(1)` is 60 ticks, and boot takes a few more. */
export const SAVELOAD_TICKS = 150;

/** The seed of the fixture's engines. The fixture draws no random number, so the value only has to be fixed. */
export const SAVELOAD_SEED = 0;

const MAIN_FILE = "main.gam";

/** A host that keeps blobs in memory, isolated by area and `GameId`, for the headless baseline and tests. */
export function createMemoryBlobHost(): SaveLoadBlobHost & { readonly entries: () => readonly { readonly area: string; readonly gameId: string; readonly path: string; readonly bytes: Uint8Array }[] } {
  const store = new Map<string, { readonly area: string; readonly gameId: string; readonly path: string; readonly bytes: Uint8Array }>();
  const id = (area: string, gameId: string, path: string): string => JSON.stringify([area, gameId, path]);
  return {
    async read(area, gameId, path) {
      const found = store.get(id(area, gameId, path));
      return found === undefined ? null : new Uint8Array(found.bytes);
    },
    async write(area, gameId, path, bytes) {
      store.set(id(area, gameId, path), { area, gameId, path, bytes: new Uint8Array(bytes) });
      return true;
    },
    async list(area, gameId) {
      return [...store.values()].filter((entry) => entry.area === area && entry.gameId === gameId).map((entry) => entry.path).sort();
    },
    entries: () => [...store.values()],
  };
}

function markerOf(state: GameState | null): number | null {
  const value = (state?.vm.globals as Record<string, unknown> | undefined)?.marker;
  return typeof value === "number" ? value : null;
}

function scriptSaveOkOf(state: GameState | null): boolean | null {
  // The fixture assigns `saveOk = save("slot")`. The lexer folds the identifier to `saveok`, game saves reply with
  // value `1` on success and `0` on failure, and the VM assignment stores those numbers in the global.
  const value = (state?.vm.globals as Record<string, unknown> | undefined)?.saveok;
  if (value === undefined) return null;
  if (value === 0) return false;
  return true;
}

/** Boot the fixture once and run `ticks` ticks, answering assets from the package and blobs from the host. */
async function runLaunch(files: ReadonlyMap<AssetKey, Uint8Array>, gameIdentity: string, gameId: string, host: SaveLoadBlobHost, ticks: number): Promise<SaveLoadLaunch> {
  let latest: GameState | null = null;
  const engine: Engine = createEngine({
    seed: SAVELOAD_SEED,
    assetIndex: createAssetIndex([...files.keys()]),
    assetRoot: PACKAGE_ROOT,
    mainFile: MAIN_FILE,
    gameIdentity,
    // The start-up `SavedGamePort` is the legacy branch the plan rules out; `Load("slot")` goes through `loadBlob`.
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    width: 640,
    height: 480,
    maxTicks: Number.MAX_SAFE_INTEGER,
    phaseRegistrations: [{ phase: "events", run: (state) => { latest = state; } }],
  });
  const saveRequests: SaveLoadSaveRequest[] = [];
  const loadRequests: SaveLoadLoadRequest[] = [];
  const diagnostics: string[] = [];
  let fresh: SaveLoadMoment | null = null;
  let preSave: SaveLoadMoment | null = null;
  let postLoad: SaveLoadMoment | null = null;
  let final: SaveLoadMoment = { tick: 0, stateHash: "", marker: null };
  let loadReplyTick: number | null = null;
  const prefix = `${gameId}/`;
  const relative = (path: string): string => (path.startsWith(prefix) ? path.slice(prefix.length) : path);

  const reply = async (request: RunnerRequest, tick: number): Promise<InputRecord | null> => {
    switch (request.kind) {
      case "asset": return { tick, event: { kind: "asset", reqId: request.reqId, bytes: files.get(request.key) ?? null } };
      case "playVideo": return { tick, event: { kind: "video.ended", reqId: request.reqId } };
      case "loadBlob": {
        const bytes = await host.read(request.blob.area, gameId, relative(request.blob.path));
        loadRequests.push({ area: request.blob.area, path: request.blob.path, key: `${request.blob.area}:${request.blob.path}`, found: bytes !== null });
        loadReplyTick = tick;
        return { tick, event: { kind: "blob.loaded", reqId: request.reqId, bytes } };
      }
      case "saveBlob": {
        saveRequests.push({ area: request.blob.area, path: request.blob.path, key: `${request.blob.area}:${request.blob.path}`, byteLength: request.bytes.length });
        const ok = await host.write(request.blob.area, gameId, relative(request.blob.path), request.bytes);
        return { tick, event: { kind: "blob.saved", reqId: request.reqId, ok } };
      }
      case "listBlobs": return { tick, event: { kind: "blob.listed", reqId: request.reqId, names: await host.list?.(request.area, gameId) ?? [] } };
      case "extension.call": return { tick, event: { kind: "extension.result", reqId: request.reqId, result: null } };
      case "quit": case "openUrl": case "prefetch": return null;
    }
  };

  // The live session's pump (`createLiveSession`): advance, answer every request, advance again until the batch settles.
  let remaining = ticks;
  let inputs: InputRecord[] = [];
  let settled = false;
  // Step 1 tick at a time through boot and until all blob activity has committed, so request-time moments and the
  // load-commit tick land at their exact tick boundaries; then run out the remaining ticks in larger steps.
  let blobSettled = false;
  for (let guard = 0; guard < 10_000 && !settled; guard += 1) {
    const step = !blobSettled || inputs.length > 0 ? 1 : remaining;
    const report = engine.advance(step, inputs);
    remaining = Math.max(0, remaining - report.ticksRun);
    inputs = [];
    for (const diagnostic of report.diagnostics) diagnostics.push(diagnostic.code);
    const moment: SaveLoadMoment = { tick: report.tickAfter, stateHash: report.stateHash, marker: markerOf(latest) };
    final = moment;
    if (loadReplyTick !== null && postLoad === null && report.consumed.some((record) => record.event.kind === "blob.loaded") && (loadRequests.length === 0 || loadRequests[loadRequests.length - 1]?.found)) {
      postLoad = moment;
    }
    const replies: InputRecord[] = [];
    const firstOfBatch = fresh === null;
    for (const request of report.requests) {
      if (request.kind === "loadBlob" || request.kind === "saveBlob") {
        if (firstOfBatch) fresh = moment;
        if (request.kind === "saveBlob") preSave = moment;
      }
      const answered = await reply(request, report.tickAfter);
      if (answered !== null) replies.push(answered);
    }
    if (report.loading || replies.length > 0) { inputs = replies; continue; }
    if (!blobSettled && report.tickAfter >= 4) blobSettled = true;
    if (remaining > 0 && report.ticksRun > 0) continue;
    settled = true;
  }
  if (!settled) throw new Error("saveload: the engine request loop did not settle");
  if (fresh === null) throw new Error("saveload: the fixture issued no blob request");
  return { saveRequests, loadRequests, fresh, preSave, postLoad, final, saveOk: scriptSaveOkOf(latest), diagnostics };
}

/**
 * Run the Save/Load fixture twice over `options.host`: launch one boots a fresh engine, finds no save, writes one;
 * launch two boots another fresh engine and restores it. Returns the requests the engine emitted and the state hashes
 * the engine reported.
 *
 * Throws when the host already held a save (launch one's `Load` would restore it and no `Save` would run) or when
 * either launch did not make exactly the requests the program makes.
 */
export async function runSaveLoadFixture(options: SaveLoadOptions): Promise<SaveLoadRun> {
  const files = new Map<AssetKey, Uint8Array>();
  for (const [path, bytes] of options.files) files.set(assetKey(path), bytes);
  const mainBytes = files.get(assetKey(MAIN_FILE));
  if (mainBytes === undefined) throw new Error(`saveload: the fixture package has no ${MAIN_FILE}`);
  const gameIdentity = derivePackageIdentity([...files].map(([path, bytes]) => ({ path, bytes })));
  const gameId = deriveGameId(mainBytes, gameIdentity);
  const ticks = options.ticks ?? SAVELOAD_TICKS;
  const saved = await runLaunch(files, gameIdentity, gameId, options.host, ticks);
  const [firstLoad] = saved.loadRequests;
  if (saved.saveRequests.length !== 1 || saved.loadRequests.length !== 1 || firstLoad === undefined || firstLoad.found) {
    throw new Error(`saveload: launch one must find no save and write one (the host must start empty for this game); it made ${saved.saveRequests.length} save and ${saved.loadRequests.length} load request(s), load found=${String(firstLoad?.found)}`);
  }
  const loaded = await runLaunch(files, gameIdentity, gameId, options.host, ticks);
  const [saveRequest] = saved.saveRequests;
  const [loadRequest] = loaded.loadRequests;
  if (saveRequest === undefined || loadRequest === undefined) throw new Error("saveload: a launch made no request");
  return { gameId, saveRequest, loadRequest, finalStateHash: loaded.final.stateHash, tick: loaded.final.tick, saved, loaded };
}

/**
 * Run **one** launch of the Save/Load fixture over `options.host`. The browser lane calls this once per page load, with
 * a real `page.reload()` in between, so what launch two restores came out of IndexedDB across a reload rather than out
 * of the first call's memory.
 */
export async function runSaveLoadLaunch(options: SaveLoadOptions): Promise<{ readonly gameId: string; readonly launch: SaveLoadLaunch }> {
  const files = new Map<AssetKey, Uint8Array>();
  for (const [path, bytes] of options.files) files.set(assetKey(path), bytes);
  const mainBytes = files.get(assetKey(MAIN_FILE));
  if (mainBytes === undefined) throw new Error(`saveload: the fixture package has no ${MAIN_FILE}`);
  const gameIdentity = derivePackageIdentity([...files].map(([path, bytes]) => ({ path, bytes })));
  const gameId = deriveGameId(mainBytes, gameIdentity);
  return { gameId, launch: await runLaunch(files, gameIdentity, gameId, options.host, options.ticks ?? SAVELOAD_TICKS) };
}
