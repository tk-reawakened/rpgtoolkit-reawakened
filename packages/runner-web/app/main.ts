import { type InputRecord } from "@tk-reawakened/core";
import { parseClosingPlan, type ClosingFiles } from "@tk-reawakened/runner-harness";
import { createBlobHost, createIndexedDbBlobBackend, type BlobHost } from "../src/blob-host.ts";
import { createDecodeAhead, DECODE_WORKER_URL } from "../src/decode-ahead.ts";
import type { DecodeAhead } from "../src/decode-types.ts";
import { fetchBundled, fetchBundledFiles, fetchGame, fontProvider, distributionPackage, runScriptedFrame } from "../src/index.ts";
import { createLoadController, type LoadModeRequest, type LoadState } from "../src/load-mode.ts";
import { createOpfsPackageStore, createOpfsStaging } from "../src/opfs-store.ts";
import { attachPointerInput } from "../src/pointer.ts";
import { createLiveSession, formatTitleBar, type LiveSession } from "../src/live-session.ts";
import { createObservedHostGeometry, observeHostState, reapplyObservedGeometryBeforePointer, reconcileObservedGeometryAfterAdvance, reconcileObservedHostFeaturesAfterAdvance, stampPendingInputs, type HostViewport, type PendingInput } from "../src/host-state.ts";
import { registerPlayerWorker, type RegistrationResult } from "../src/register-worker.ts";
import { createStallOverlay, type StallOverlay } from "../src/stall-overlay.ts";
import { createFallbackTouchControls, isFallbackTouchControlTarget, shouldSuppressGameplayKey } from "../src/touch-controls.ts";

type LiveReport = {
  tick: number;
  stateHash: string;
  drawHash: string;
  board: string | null;
  player: { x: number; y: number } | null;
  error?: string;
  /** How the package was loaded and what its storage did, once the load has finished. */
  load?: { mode: string | null; storage: LoadState["storage"] };
  /** Every completed asset stall and the asset the engine waits on now, for the lane and for a person reading it. */
  stalls?: { count: number; hinted: number; unhinted: number; blocking: string | null; spinner: boolean };
  /** The last advance's located diagnostics, so a probe can assert what the engine reported. */
  diagnostics?: readonly { code: string; file: string; line: number; message: string }[];
};

declare global {
  interface Window {
    __report?: unknown;
    __live?: LiveReport;
    __liveHistory?: { tick: number; stateHash: string }[];
    /** The package load's state, kept current while it runs and after. */
    __load?: LoadState;
    /** A lane's clock for stall timing and the spinner; the page uses `performance.now` when it is absent. */
    __playerClock?: () => number;
    /** The blob host the session saves through, for a lane that inspects save storage. */
    __blobHost?: BlobHost;
    /** The decode-ahead worker, or the reason the browser refused one. */
    __decodeAhead?: DecodeAhead | { readonly unavailable: string };
    /** The live session, for a lane that inspects its asset tiers and audio sink. */
    __session?: LiveSession;
    /** The offline service worker's registration, or why none was registered (`app:` desktop, `capacitor:`, absent). */
    __worker?: Promise<RegistrationResult>;
  }
}

/** The VS Code webview injects this API; the ordinary browser player never accesses it. */
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscodeApi = document.body.dataset.tkrHost === "vscode" ? acquireVsCodeApi() : null;

let editorChannel: MessagePort | null = null;
const canvas = document.querySelector<HTMLCanvasElement>("#screen");
const output = document.querySelector<HTMLPreElement>("#report");
if (canvas === null || output === null) throw new Error("player: the page is missing its canvas or report");
const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: false, preserveDrawingBuffer: true });
if (gl === null) {
  output.textContent = "player: this browser has no WebGL2 context";
  window.__report = { error: "no-webgl2" };
  vscodeApi?.postMessage({ type: "status", status: { state: "failed", tick: 0, board: null, stalledOn: null, diagnostics: [], message: "This browser has no WebGL2 context." } });
  if (new URLSearchParams(location.search).has("editor") && window.parent !== window) {
    window.parent.postMessage({ type: "tkr-player-error", message: "This browser has no WebGL2 context." }, location.origin);
  }
} else {
  void boot(gl, canvas, output);
}

const MIB = 1_048_576;

function describeLoad(name: string, state: LoadState): string {
  const { received, total } = state.progress;
  const progress = total === null ? "" : ` — ${(received / MIB).toFixed(1)} of ${(total / MIB).toFixed(1)} MiB`;
  const mode = state.mode === null ? "" : ` (${state.mode})`;
  const storage = state.phase === "ready"
    ? `\nstorage: ${state.storage.kept ? "kept for offline" : "not kept"}, quota ${state.storage.quota}, persistent ${state.storage.persisted}${state.storage.error === null ? "" : `\n  ${state.storage.error}`}`
    : "";
  return `${state.phase === "failed" ? "load failed" : state.phase === "ready" ? "loaded" : "loading"} ${name}${progress}${mode}${storage}`;
}

async function boot(context: WebGL2RenderingContext, screen: HTMLCanvasElement, report: HTMLPreElement): Promise<void> {
  try {
    const params = new URLSearchParams(location.search);
    if (vscodeApi !== null) {
      await bootEditorGame(context, screen, report, vscodeApi);
      return;
    }
    if (params.has("editor")) {
      await bootEditorGame(context, screen, report);
      return;
    }
    const pack = params.get("package");
    const parity = params.has("parity");
    const tracer = params.has("tracer");
    if (!parity && !tracer) {
      await bootInteractive(context, screen, report, params);
      return;
    }
    if (parity && pack !== null) {
      await bootParityPackage(context, report, params, pack);
      return;
    }
    const planText = await (await fetch("/golden/closing/plan.json")).text();
    const game = params.get("game") ?? "demo";
    let files: ClosingFiles;
    if (pack === null) files = await fetchGame("", `fixtures/legacy/${game}`);
    else files = distributionPackage(pack.split("/").at(-1) ?? "game.tpk", new Uint8Array(await (await fetch(`/${pack}`)).arrayBuffer())).files;
    const bundled = await fetchBundled("", parseClosingPlan(planText).bundled);
    if (tracer) {
      const result = runScriptedFrame({ planText, game, files, bundled, gl: context, fonts: fontProvider(bundled) });
      window.__report = { game, package: pack, ...result };
      report.textContent = [
        `${game} tick ${result.tick}`,
        `state ${result.stateHash}`,
        `draw  ${result.drawHash}`,
        `commands ${result.commands}: drawn ${result.render.drawn}, deferred ${result.render.deferred}`,
        ...Object.entries(result.render.deferredByKind).map(([kind, count]) => `  ${kind}: ${count}`),
        ...result.render.diagnostics.map((line) => `diagnostic: ${line}`),
      ].join("\n");
      return;
    }
    const session = await createLiveSession({ planText, gameName: game, files, bundled, gl: context });
    await runParity(session, report, game, pack);
  } catch (error) {
    window.__report = { error: String(error) };
    report.textContent = `player: ${String(error)}`;
    editorChannel?.postMessage({ state: "failed", tick: 0, board: null, stalledOn: null, diagnostics: [], message: String(error) });
  }
}

/** The OPFS root the package stores sit on, or `null` where the browser has none (the load then streams and says why). */
async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return typeof navigator.storage?.getDirectory === "function" ? await navigator.storage.getDirectory() : null;
  } catch {
    return null;
  }
}

/** The durable blob host, or `null` where IndexedDB is unavailable: saves then report failure to the engine, never succeed silently. */
async function durableBlobs(report: HTMLPreElement): Promise<BlobHost | null> {
  try {
    return createBlobHost({ backend: await createIndexedDbBlobBackend(indexedDB, "tkr-saves"), storage: navigator.storage });
  } catch (error) {
    report.textContent = `${report.textContent ?? ""}\nsaves unavailable: ${String(error)}`;
    return null;
  }
}

/** Everything the player needs from a package before it can start: the validated source, the load state and the bundled files. */
async function loadPackage(params: URLSearchParams, report: HTMLPreElement, pack: string) {
  window.__worker ??= registerPlayerWorker();
  const packageName = pack.split("/").at(-1) ?? "game.tpk";
  const descriptorResponse = await fetch(`/${pack}.json`);
  if (!descriptorResponse.ok) throw new Error(`package descriptor unavailable: ${descriptorResponse.status}`);
  const descriptor: unknown = await descriptorResponse.json();
  const root = await opfsRoot();
  const requested = params.get("mode");
  const threshold = params.get("threshold");
  const controller = createLoadController({
    url: `/${pack}`,
    descriptor,
    ...(root === null ? {} : { staging: createOpfsStaging(root), durable: createOpfsPackageStore(root) }),
    storage: navigator.storage,
    mode: requested === "whole" || requested === "streaming" ? (requested satisfies LoadModeRequest) : "auto",
    ...(threshold === null ? {} : { thresholdBytes: Number(threshold) }),
  });
  controller.subscribe((state) => {
    window.__load = state;
    report.textContent = describeLoad(packageName, state);
  });
  const listing = fetch("/apps/browser/bundled.json").then(async (response) => {
    if (!response.ok) throw new Error(`apps/browser/bundled.json answered ${response.status}`);
    return (await response.json()) as { readonly files: readonly string[] };
  });
  const [source, listed] = await Promise.all([controller.load(), listing]);
  const bundled = await fetchBundledFiles("", listed.files);
  return { controller, source, bundled };
}

/**
 * Spawn the decode worker from bytes fetched through the page's own `fetch`. A dedicated `new Worker(url)` is outside
 * the page's service-worker scope in Chromium and fails when the network is gone; fetching the bundle through the
 * controlled page hits the service worker's precache and runs identically online and offline.
 */
// A worker factory retained across restarts, with one page-lifetime object URL.
async function prepareDecode(workerUrl = DECODE_WORKER_URL): Promise<{ readonly create: (outputRateHz: number) => DecodeAhead | null; readonly dispose: () => void }> {
  let blobUrl: string | null = null;
  try {
    const response = await fetch(workerUrl);
    if (response.ok) blobUrl = URL.createObjectURL(await response.blob());
  } catch {
    blobUrl = null;
  }
  return {
    create(outputRateHz) {
      try {
        const decode = createDecodeAhead({ outputRateHz, ...(blobUrl === null ? {} : { workerUrl: blobUrl }) });
        window.__decodeAhead = decode;
        return decode;
      } catch (error) {
        window.__decodeAhead = { unavailable: String(error) };
        return null;
      }
    },
    dispose() {
      if (blobUrl !== null) URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    },
  };
}

/** The closing-plan recipe over the tiered package source: the lane's proof that the production source reaches the baseline. */
async function bootParityPackage(context: WebGL2RenderingContext, report: HTMLPreElement, params: URLSearchParams, pack: string): Promise<void> {
  const game = params.get("game") ?? "demo";
  const planText = await (await fetch("/golden/closing/plan.json")).text();
  const { controller, source, bundled } = await loadPackage(params, report, pack);
  const clock = window.__playerClock ?? ((): number => performance.now());
  const decode = await prepareDecode();
  window.addEventListener("pagehide", decode.dispose, { once: true });
  const session = await createLiveSession({ planText, gameName: game, source, bundled, gl: context, clock, decode: decode.create });
  window.__session = session;
  await runParity(session, report, game, pack, () => ({ load: controller.state(), assets: session.loadState(), audio: session.audioState() }));
}

async function bootInteractive(
  context: WebGL2RenderingContext,
  screen: HTMLCanvasElement,
  report: HTMLPreElement,
  params: URLSearchParams,
): Promise<void> {
  const stage = document.querySelector<HTMLElement>("#stage");
  if (stage === null) throw new Error("player: the page is missing its viewport stage");
  const hostViewport: HostViewport = { canvas: screen, viewport: stage };
  const pack = params.get("package");
  if (pack === null) throw new Error("interactive play requires a distribution package in ?package=");
  const { controller, source, bundled } = await loadPackage(params, report, pack);
  const blobs = await durableBlobs(report);
  if (blobs !== null) window.__blobHost = blobs;
  const clock = window.__playerClock ?? ((): number => performance.now());
  const spinner = document.querySelector<HTMLElement>("#spinner");
  const decode = await prepareDecode();
  let stopped = false;
  let generation = 0;
  let activeSession: LiveSession | null = null;
  let disposeLoop: (() => void) | null = null;

  const pagehide = (): void => {
    if (stopped) return;
    stopped = true;
    generation += 1;
    const cleanup = disposeLoop;
    disposeLoop = null;
    const session = activeSession;
    activeSession = null;
    if (cleanup !== null) cleanup();
    else session?.close();
    decode.dispose();
  };
  window.addEventListener("pagehide", pagehide, { once: true });

  const launch = async (): Promise<void> => {
    if (stopped) return;
    const sessionGeneration = ++generation;
    let session: LiveSession | null = null;
    let quitBeforeReady = false;
    let overlay: StallOverlay | null = null;
    try {
      const created = await createLiveSession({
        interactive: true,
        source,
        bundled,
        gl: context,
        hostViewport,
        clock,
        ...(blobs === null ? {} : { blobs }),
        decode: decode.create,
        onLoadChange: () => {
          if (!stopped && sessionGeneration === generation) overlay?.update();
        },
        onQuit: () => {
          if (stopped || sessionGeneration !== generation) return;
          if (session === null) {
            quitBeforeReady = true;
            return;
          }
          restart(sessionGeneration, session);
        },
      });
      session = created;
      if (stopped || sessionGeneration !== generation) {
        created.close();
        return;
      }
      activeSession = created;
      window.__session = created;
      if (quitBeforeReady) {
        restart(sessionGeneration, created);
        return;
      }
      if (spinner !== null) overlay = createStallOverlay({ element: spinner, state: created.loadState, clock });
      disposeLoop = startLiveLoop(created, screen, report, overlay, controller.state, hostViewport);
    } catch (error) {
      if (stopped || sessionGeneration !== generation) return;
      activeSession?.close();
      activeSession = null;
      delete window.__session;
      window.__live = { tick: 0, stateHash: "", drawHash: "", board: null, player: null, error: String(error) };
      report.textContent = `player: ${String(error)}`;
    }
  };

  const restart = (sessionGeneration: number, session: LiveSession): void => {
    if (stopped || sessionGeneration !== generation || activeSession !== session) return;
    generation += 1;
    const cleanup = disposeLoop;
    disposeLoop = null;
    activeSession = null;
    delete window.__session;
    delete window.__live;
    delete window.__report;
    report.textContent = "restarting game…";
    if (cleanup !== null) cleanup();
    else session.close();
    void launch();
  };

  void launch();
}

/**
 * An editor launch uses the same live player as a distribution package, but receives one frozen set of saved files
 * through a private MessagePort. Only the same-origin embedding parent may supply that port. Later editor saves cannot
 * change the files in this session (ADR 0022 D8.4).
 */
async function bootEditorGame(
  context: WebGL2RenderingContext,
  screen: HTMLCanvasElement,
  report: HTMLPreElement,
  vscode: { postMessage(message: unknown): void } | null = null,
): Promise<void> {
  const channel = vscode === null ? await new Promise<MessagePort>((resolve) => {
    if (window.parent === window) throw new Error("editor launch requires an embedding editor");
    const receive = (event: MessageEvent): void => {
      if (event.source !== window.parent || event.origin !== location.origin || event.data !== "tkr-editor-connect" || event.ports.length !== 1) return;
      window.removeEventListener("message", receive);
      resolve(event.ports[0]!);
    };
    window.addEventListener("message", receive);
    window.parent.postMessage("tkr-player-ready", location.origin);
  }) : (() => {
    const pair = new MessageChannel();
    window.addEventListener("message", (event: MessageEvent<unknown>) => pair.port2.postMessage(event.data));
    pair.port2.onmessage = (event: MessageEvent<unknown>) => vscode.postMessage({ type: "status", status: event.data });
    vscode.postMessage({ type: "ready" });
    return pair.port1;
  })();
  editorChannel = channel;
  const payload: unknown = await new Promise((resolve) => {
    channel.onmessage = (event: MessageEvent<unknown>) => resolve(event.data);
    channel.start();
  });
  if (typeof payload !== "object" || payload === null || !("main" in payload) || typeof payload.main !== "string"
    || !("project" in payload) || typeof payload.project !== "string"
    || !("projectFolder" in payload) || typeof payload.projectFolder !== "string"
    || !("seed" in payload) || typeof payload.seed !== "number"
    || !("files" in payload) || !(payload.files instanceof Map || Array.isArray(payload.files))) throw new Error("invalid editor launch");
  const toFiles = (entries: Iterable<unknown>): Map<string, Uint8Array> => {
    const result = new Map<string, Uint8Array>();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !(entry[1] instanceof Uint8Array)) {
        throw new Error("invalid editor launch file");
      }
      result.set(entry[0], entry[1]);
    }
    return result;
  };
  const files = toFiles(payload.files);
  let scene: { board: string; program: string } | undefined;
  if ("scene" in payload) {
    if (typeof payload.scene !== "object" || payload.scene === null || !("board" in payload.scene)
      || typeof payload.scene.board !== "string" || !("program" in payload.scene) || typeof payload.scene.program !== "string") {
      throw new Error("invalid isolated scene launch");
    }
    scene = { board: payload.scene.board, program: payload.scene.program };
  }
  const snapshotDetails = document.querySelector<HTMLDetailsElement>("#run-snapshot");
  const snapshotOutput = snapshotDetails?.querySelector("pre") ?? null;
  const snapshot: unknown = snapshotOutput === null ? null : JSON.parse(snapshotOutput.textContent ?? "null");
  if (snapshotOutput !== null && (typeof snapshot !== "object" || snapshot === null || !("stateHash" in snapshot)
    || !(snapshot.stateHash === null || typeof snapshot.stateHash === "string"))) throw new Error("invalid run snapshot");
  const renderSnapshot = (): void => {
    if (snapshotOutput !== null && snapshotDetails?.open) snapshotOutput.textContent = JSON.stringify(snapshot, null, 2);
  };
  snapshotDetails?.addEventListener("toggle", renderSnapshot);
  const folder = payload.projectFolder.replace(/^\/+|\/+$/g, "");
  if (folder !== "" && !folder.toLowerCase().startsWith("game/")) throw new Error("the game folder must be under Game/");
  const assetRoot = folder === "" ? { kind: "package" as const } : { kind: "game" as const, projectPath: folder.slice(5) };
  const stage = document.querySelector<HTMLElement>("#stage");
  if (stage === null) throw new Error("player: the page is missing its viewport stage");
  let bundled: ReadonlyMap<string, Uint8Array>;
  let audioWorkletUrl: string | undefined;
  let decodeWorkerUrl: string | undefined;
  if (vscode === null) {
    const listing = await fetch("/apps/browser/bundled.json");
    if (!listing.ok) throw new Error(`bundled assets unavailable: ${listing.status}`);
    const listed = await listing.json() as { readonly files: readonly string[] };
    bundled = await fetchBundledFiles("", listed.files);
  } else {
    if (!("bundled" in payload) || !Array.isArray(payload.bundled)
      || !("workletUrl" in payload) || typeof payload.workletUrl !== "string"
      || !("decodeWorkerUrl" in payload) || typeof payload.decodeWorkerUrl !== "string") throw new Error("invalid VS Code player assets");
    bundled = toFiles(payload.bundled);
    audioWorkletUrl = payload.workletUrl;
    decodeWorkerUrl = payload.decodeWorkerUrl;
  }
  const blobs = await durableBlobs(report);
  if (blobs !== null) window.__blobHost = blobs;
  const decode = await prepareDecode(decodeWorkerUrl);
  const hostViewport: HostViewport = { canvas: screen, viewport: stage };
  const clock = (): number => performance.now();
  let dispose: (() => void) | null = null;
  let sessionForQuit: LiveSession | null = null;
  let quitBeforeReady = false;
  const rememberLiveHash = (tick: number, stateHash: string): void => {
    if (stateHash === "") return;
    const history = window.__liveHistory ?? [];
    history.push({ tick, stateHash });
    if (history.length > 256) history.shift();
    window.__liveHistory = history;
  };
  const updateSnapshotHash = (stateHash: string): void => {
    if (typeof snapshot === "object" && snapshot !== null && "stateHash" in snapshot
      && stateHash !== "" && snapshot.stateHash !== stateHash) {
      snapshot.stateHash = stateHash;
      renderSnapshot();
    }
  };
  const onQuit = (): void => {
    if (sessionForQuit === null) {
      quitBeforeReady = true;
      return;
    }
    const stateHash = sessionForQuit.stateHash();
    const tick = sessionForQuit.tick();
    const board = sessionForQuit.boardKey();
    const diagnostics = sessionForQuit.diagnostics();
    const live = { ...(window.__live ?? { drawHash: "", player: null }), tick, board, stateHash,
      player: sessionForQuit.playerPosition(), diagnostics };
    window.__live = live;
    window.__report = live;
    rememberLiveHash(tick, stateHash);
    updateSnapshotHash(stateHash);
    channel.postMessage({ state: "ended", tick, board, stateHash, stalledOn: null,
      diagnostics, message: "The game ended." });
    dispose?.();
  };
  const session = await createLiveSession({
    interactive: true, files, mainFile: payload.main, gameIdentity: payload.project, assetRoot, seed: payload.seed,
    ...(scene === undefined ? {} : { scene }),
    bundled, gl: context, hostViewport, clock,
    decode: decode.create,
    ...(audioWorkletUrl === undefined ? {} : { audioWorkletUrl }),
    ...(blobs === null ? {} : { blobs }),
    onQuit,
  });
  sessionForQuit = session;
  if (quitBeforeReady) {
    onQuit();
    decode.dispose();
    return;
  }
  window.__session = session;
  const spinner = document.querySelector<HTMLElement>("#spinner");
  const overlay = spinner === null ? null : createStallOverlay({ element: spinner, state: session.loadState, clock });
  const load: LoadState = {
    phase: "ready", mode: "whole", progress: { received: 0, total: null },
    storage: { persisted: "not-requested", quota: "not-needed", kept: false, error: null }, error: null,
  };
  dispose = startLiveLoop(session, screen, report, overlay, () => load, hostViewport, (live) => {
    updateSnapshotHash(live.stateHash);
    rememberLiveHash(live.tick, live.stateHash);
    channel.postMessage({ state: live.error ? "failed" : live.stalls?.blocking ? "stalled" : "running",
      tick: live.tick, board: live.board, stateHash: live.stateHash, stalledOn: live.stalls?.blocking ?? null,
      diagnostics: live.diagnostics ?? [], message: live.error ?? null });
  });
  const stop = (): void => {
    dispose?.();
    decode.dispose();
    channel.close();
    snapshotDetails?.removeEventListener("toggle", renderSnapshot);
  };
  channel.onmessage = (event) => { if (event.data === "stop") stop(); };
  window.addEventListener("pagehide", stop, { once: true });
}

async function runParity(session: LiveSession, report: HTMLPreElement, game: string, pack: string | null, extra: () => object = () => ({})): Promise<void> {
  await session.advance(0);
  let inputs: InputRecord[] = [];
  for (const tick of [30, 60, 90, 120]) {
    await session.advance(tick - session.tick(), inputs);
    inputs = [];
    if (tick < 120) {
      inputs.push({ tick, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: true } });
      inputs.push({ tick, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: false } });
    }
  }
  await session.cuesSettled();
  const frame = session.draw(0);
  const stateHash = session.stateHash();
  const alphaFrame = session.draw(1);
  const result = {
    game,
    package: pack,
    tick: session.tick(),
    stateHash,
    drawHash: frame.drawHash,
    alphaDrawHash: alphaFrame.drawHash,
    alphaStateHash: session.stateHash(),
    commands: frame.commands,
    render: frame.render,
  };
  window.__report = { ...result, ...extra() };
  report.textContent = [`${game} tick ${result.tick}`, `state ${result.stateHash}`, `draw  ${result.drawHash}`, `commands ${result.commands}: drawn ${frame.render.drawn}, deferred ${frame.render.deferred}`].join("\n");
}

function startLiveLoop(
  session: LiveSession,
  canvas: HTMLCanvasElement,
  report: HTMLPreElement,
  overlay: StallOverlay | null,
  loadState: () => LoadState,
  hostViewport: HostViewport,
  onLive?: (report: LiveReport) => void,
): () => void {
  const stepMs = 1000 / 60;
  let previous = performance.now();
  let accumulator = 0;
  let disposed = false;
  let advancing = false;
  let frameId: number | null = null;
  let pending: PendingInput[] = [];
  let titleFrames = 0;
  let titleWindowStart = performance.now();
  const viewSize = session.viewSize();
  const displayGeometry = createObservedHostGeometry(session.displayGeometry());
  const fallbackControlKeys = new Set<string>();
  let fallbackActionSequence = 0;
  const dispatchFallbackAction = (action: "up" | "down" | "left" | "right" | "confirm" | "cancel", down: boolean, modalId: number | null = null): number => {
    let event: InputRecord["event"];
    if (modalId === null) {
      event = { kind: "action", action, down, source: "runner.fallback", modalId: null };
    } else if (action === "confirm" || action === "cancel") {
      event = { kind: "action", action, down, source: "runner.fallback", modalId };
    } else {
      throw new Error("only confirm or cancel may target a modal");
    }
    pending.push({ tick: null, event, pointerGeometry: null });
    fallbackActionSequence += 1;
    return fallbackActionSequence;
  };
  const touchControls = createFallbackTouchControls(hostViewport.viewport, displayGeometry.current, dispatchFallbackAction);
  const hostObserver = observeHostState(hostViewport, viewSize, (event) => {
    displayGeometry.observe(event);
    pending.push({ tick: null, event, pointerGeometry: null });
  }, session.hostState ?? undefined);
  session.setGamepadResampler(hostObserver.resampleGamepads);
  session.setHostRestoreSnapshotProvider(() => {
    const snapshot = hostObserver.snapshotForRestore(pending);
    for (const event of snapshot.observations) displayGeometry.observe(event);
    return snapshot;
  });
  const stopPointerInput = attachPointerInput(
    hostViewport.viewport,
    viewSize,
    displayGeometry.current,
    ({ x, y }, buttons) => {
      const geometry = displayGeometry.current();
      reapplyObservedGeometryBeforePointer(session.displayGeometry(), displayGeometry, pending);
      pending.push({ tick: session.tick(), event: { kind: "pointer", x, y, buttons }, pointerGeometry: geometry });
    },
    () => {
      reapplyObservedGeometryBeforePointer(session.displayGeometry(), displayGeometry, pending);
      pending.push({ tick: session.tick(), event: { kind: "pointer.cancel" }, pointerGeometry: null });
    },
    ({ x, y }) => session.engine.runnerControlPointerPreemption(x, y),
    dispatchFallbackAction,
    () => session.engine.surfaceCacheEpoch(),
  );
  const key = (event: KeyboardEvent, down: boolean): void => {
    if (shouldSuppressGameplayKey(event.code, event.repeat, down, isFallbackTouchControlTarget(event.target), fallbackControlKeys)) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    pending.push({ tick: session.tick(), event: { kind: "key", name: event.key.toUpperCase(), code: event.code, char: event.key.length === 1 ? event.key : null, down, ...(event.repeat ? { repeat: true } : {}) }, pointerGeometry: null });
  };
  const onKeyDown = (event: KeyboardEvent): void => key(event, true);
  const onKeyUp = (event: KeyboardEvent): void => key(event, false);
  const focus = (state: "lost" | "gained"): void => {
    pending.push({ tick: session.tick(), event: { kind: "focus", state }, pointerGeometry: null });
  };
  const onBlur = (): void => {
      fallbackControlKeys.clear();
      focus("lost");
    };
  const onFocus = (): void => focus("gained");
  const onVisibility = (): void => focus(document.hidden ? "lost" : "gained");
  const onContextMenu = (event: MouseEvent): void => event.preventDefault();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("contextmenu", onContextMenu);
  const syncTouchControls = (): void => {
    touchControls.update(session.engine.hostFeatures().touch && !session.engine.customTouchControlsDeclared());
  };
  // The spinner is driven by its own timer as well as by each frame, so it appears even if the browser throttles
  // animation frames, and never from the pending `advance`, which cannot resolve while the engine waits on an asset.
  const spinnerTimer = overlay === null ? null : window.setInterval(() => overlay.update(), 100);
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    hostObserver.dispose();
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    if (spinnerTimer !== null) window.clearInterval(spinnerTimer);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    stopPointerInput();
    canvas.removeEventListener("contextmenu", onContextMenu);
    touchControls.close();
    session.close();
  };
  const summary = (spinner: boolean): NonNullable<LiveReport["stalls"]> => {
    const state = session.loadState();
    const hinted = state.stalls.filter((stall) => stall.hinted).length;
    return { count: state.stalls.length, hinted, unhinted: state.stalls.length - hinted, blocking: state.blocking?.key ?? null, spinner };
  };
  const frame = (now: number): void => {
    frameId = null;
    if (disposed) return;
    const elapsed = Math.max(0, now - previous);
    previous = now;
    const spinner = overlay?.update() ?? false;
    hostObserver.poll();
    syncTouchControls();
    // While the engine waits on an asset the simulation is frozen, so wall time is not banked: a long wait must not come
    // back as a burst of catch-up ticks. The last presented frame stays on the canvas and the loop keeps running.
    if (!advancing) {
      accumulator += elapsed;
      const wholeTicks = Math.floor(accumulator / stepMs);
      accumulator -= wholeTicks * stepMs;
      const geometryNeedsTick = reapplyObservedGeometryBeforePointer(session.displayGeometry(), displayGeometry, pending);
      if (wholeTicks !== 0 || !geometryNeedsTick) {
        const inputs = stampPendingInputs(pending, session.tick());
        const submittedActionSequence = fallbackActionSequence;
        const tickBeforeAdvance = session.tick();
        pending = [];
        advancing = true;
        session.advance(wholeTicks, inputs).then(() => {
          if (disposed) return;
          if (session.tick() !== tickBeforeAdvance) touchControls.acknowledgeSubmittedBatch(submittedActionSequence);
          reconcileObservedHostFeaturesAfterAdvance(session.engine.hostFeatures(), hostObserver, pending);
          const restoredGeometryNeedsTick = reconcileObservedGeometryAfterAdvance(session.displayGeometry(), displayGeometry, pending, session.tick());
          advancing = false;
          if (disposed || restoredGeometryNeedsTick) return;
          const drawn = session.draw(accumulator / stepMs);
          const player = session.playerPosition();
          const state = loadState();
          const live: LiveReport = {
            tick: session.tick(),
            stateHash: session.stateHash(),
            drawHash: drawn.drawHash,
            board: session.boardKey(),
            player,
            load: { mode: state.mode, storage: state.storage },
            stalls: summary(overlay?.update() ?? false),
            diagnostics: session.diagnostics(),
          };
          window.__live = live;
          window.__report = live;
          onLive?.(live);
          report.textContent = [
            `live ${location.search.includes("package=") ? "package" : "game"} — tick ${live.tick}`,
            `state ${live.stateHash}`,
            `draw  ${live.drawHash} (${drawn.commands} commands; ${drawn.render.drawn} drawn, ${drawn.render.deferred} deferred)`,
            player === null ? "player position unavailable" : `player ${player.x}, ${player.y}`,
            `package ${state.mode ?? "?"}; storage ${state.storage.kept ? "kept" : "not kept"}; stalls ${live.stalls?.count ?? 0}`,
            ...(session.audioError() === null ? [] : [`audio: ${session.audioError()}`]),
          ].join("\n");
        }).catch((error: unknown) => {
          advancing = false;
          if (disposed) return;
          window.__live = { tick: session.tick(), stateHash: session.stateHash(), drawHash: "", board: session.boardKey(), player: session.playerPosition(), error: String(error), stalls: summary(false) };
          onLive?.(window.__live);
          report.textContent = `player: ${String(error)}`;
          dispose();
        });
      }
    } else if (window.__live !== undefined) {
      window.__live = { ...window.__live, stalls: summary(spinner) };
    }
    // The project's window title (main-file row 56, `bFpsInTitleBar`) is the host's presentation measurement, so it is
    // recomputed once a second from frames actually presented and never enters simulation state.
    titleFrames += 1;
    const nowMs = performance.now();
    if (nowMs - titleWindowStart >= 1_000) {
      const bar = session.titleBar();
      const fps = titleFrames * 1_000 / (nowMs - titleWindowStart);
      titleFrames = 0;
      titleWindowStart = nowMs;
      if (bar !== undefined && bar.showFps) document.title = formatTitleBar(bar, fps);
    }
    if (!disposed) frameId = window.requestAnimationFrame(frame);
  };
  frameId = window.requestAnimationFrame(frame);
  return dispose;
}
