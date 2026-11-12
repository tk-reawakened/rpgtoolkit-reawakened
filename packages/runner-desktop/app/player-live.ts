import type { InputRecord } from "@tk-reawakened/core";
import { interactivePackage } from "@tk-reawakened/runner-web";
import { formatTitleBar, type LaunchInfo } from "@tk-reawakened/runner-web";
import type { DesktopHost } from "../src/preload.ts";
import { createFallbackTouchControls, isFallbackTouchControlTarget, shouldSuppressGameplayKey } from "@tk-reawakened/runner-web/touch-controls";
import { attachPointerInput } from "@tk-reawakened/runner-web/pointer";
import { soundFontDecoderReady } from "@tk-reawakened/synth";
import { createLiveSession, type LiveSession } from "@tk-reawakened/runner-web/live-session";
import { createObservedHostGeometry, observeHostState, reapplyObservedGeometryBeforePointer, reconcileObservedGeometryAfterAdvance, reconcileObservedHostFeaturesAfterAdvance, stampPendingInputs, type HostViewport, type PendingInput } from "@tk-reawakened/runner-web/host-state";

declare global { interface Window { desktop?: DesktopHost; __live?: { tick: number; stateHash: string; drawHash: string; board: string | null; player: { x: number; y: number } | null; error?: string }; __session?: LiveSession } }

void start().catch((error: unknown) => {
  console.error("player startup failed", error);
  const status = document.querySelector<HTMLElement>("#live-status");
  if (status !== null) {
    status.textContent = `player: ${String(error)}`;
    status.hidden = false;
  }
  window.__live = { tick: 0, stateHash: "", drawHash: "", board: null, player: null, error: String(error) };
});

type Stage = { readonly canvas: HTMLCanvasElement; readonly status: HTMLElement; readonly viewport: HTMLElement };

async function start(): Promise<void> {
  await soundFontDecoderReady;
  const host = window.desktop;
  const canvas = document.querySelector<HTMLCanvasElement>("#screen");
  const status = document.querySelector<HTMLElement>("#live-status");
  const viewport = document.querySelector<HTMLElement>("#viewport");
  if (host === undefined || canvas === null || status === null || viewport === null) throw new Error("desktop player host or attached canvas is absent");
  const stage: Stage = { canvas, status, viewport };
  const info = await host.launchInfo?.();
  if (info !== undefined && (info.step === "library" || info.step === "none")) {
    offerLibrary(host, info, stage);
    return;
  }
  const opened = await host.openPackage();
  if (opened === null) throw new Error("no game was chosen and the library is empty");
  await play(host, opened, stage);
}

/**
 * The fallback the ruled order names: the installed games and the sentence that says why none opened. This is the seam
 * epic 25's Launcher UI replaces (entry 25.4); it is deliberately a list of buttons and nothing else.
 */
function offerLibrary(host: DesktopHost, info: LaunchInfo, stage: Stage): void {
  stage.status.hidden = false;
  stage.status.textContent = info.reason ?? "No game was chosen.";
  window.__live = { tick: 0, stateHash: "", drawHash: "", board: null, player: null };
  const list = document.createElement("div");
  list.id = "library";
  list.style.cssText = "padding: 0 12px 12px; display: flex; flex-wrap: wrap; gap: 8px;";
  for (const row of info.rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${row.title} (${row.version})`;
    button.addEventListener("click", () => {
      list.remove();
      stage.status.textContent = `opening ${row.title}…`;
      void host.openPackage(row.gameId).then(async (opened) => {
        if (opened === null) throw new Error(`the library no longer offers ${row.gameId}`);
        await play(host, opened, stage);
      }).catch((error: unknown) => {
        console.error("player could not open the library game", error);
        stage.status.textContent = `player: ${error instanceof Error ? error.message : String(error)}`;
        window.__live = { tick: 0, stateHash: "", drawHash: "", board: null, player: null, error: String(error) };
      });
    });
    list.append(button);
  }
  if (info.rows.length === 0) list.remove();
  else stage.viewport.after(list);
}

/** Boot the live session for one resolved game: the bytes arrive already chosen, whatever rule chose them. */
async function play(host: DesktopHost, opened: { readonly name: string; readonly bytes: Uint8Array; readonly descriptor: unknown }, stage: Stage): Promise<void> {
  const { canvas, status, viewport } = stage;
  const pkg = await interactivePackage(opened.name, new Uint8Array(opened.bytes), opened.descriptor);
  const files = pkg.files;
  const listed = (await (await fetch("/apps/bundled.json")).json()) as { readonly files: readonly string[] };
  const bundled = new Map<string, Uint8Array>();
  for (const name of listed.files) {
    const response = await fetch(`/${name}`);
    if (response.ok) bundled.set(name, new Uint8Array(await response.arrayBuffer()));
  }
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (gl === null) throw new Error("no WebGL2 context for the visible player");
  const debug = await host.debug?.();
  let quitRequested = false;
  let stopPlayer: (() => void) | undefined;
  const session = await createLiveSession({
    interactive: true,
    ...(debug === undefined || debug.drawVectorsFlags === 0 ? {} : { debug: { drawVectorsFlags: debug.drawVectorsFlags } }),
    mainFile: pkg.main,
    gameIdentity: pkg.gameIdentity,
    files,
    bundled,
    gl,
    hostViewport: { canvas, viewport },
    blobs: {
      read: (area, gameId, path) => host.readBlob(area, gameId, path),
      write: (area, gameId, path, bytes) => host.writeBlob(area, gameId, path, bytes),
      list: (area, gameId) => host.listBlobs(area, gameId),
    },
    onQuit: () => {
      quitRequested = true;
      stopPlayer?.();
      void host.quit();
    },
    onDiagnostic: ({ code, file, line, message }, tick) => {
      const location = file === "" ? "" : ` ${file}:${line}`;
      console.warn(`game tick=${tick} ${code}${location}: ${message}`);
    },
    onBattleChange: (battle, tick) => {
      console.info(`game tick=${tick} battle ${battle === null ? "cleared" : JSON.stringify(battle)}`);
    },
  });
  if (quitRequested) return;
  status.hidden = true;
  window.__session = session;
  // The diagnostics strip is a runner feature, not a project setting: it appears only when this run asked for it.
  const diagnostics = debug?.diagnostics === true ? document.querySelector<HTMLElement>("#diagnostics") : null;
  stopPlayer = run(session, canvas, status, { canvas, viewport }, viewport, diagnostics);
}

function run(session: LiveSession, canvas: HTMLCanvasElement, status: HTMLElement, hostViewport: HostViewport, stage: HTMLElement, diagnostics: HTMLElement | null): () => void {
  const stepMs = 1000 / 60;
  let previous = performance.now();
  let accumulator = 0;
  let titleFrames = 0;
  let titleWindowStart = performance.now();
  let pending: PendingInput[] = [];
  const fallbackControlKeys = new Set<string>();
  let fallbackActionSequence = 0;
  let disposed = false;
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "F3") {
      event.preventDefault();
      if (!event.repeat) status.hidden = !status.hidden;
      return;
    }
    if (shouldSuppressGameplayKey(event.code, event.repeat, true, isFallbackTouchControlTarget(event.target), fallbackControlKeys)) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    pending.push({ tick: session.tick(), event: { kind: "key", name: event.key.toUpperCase(), code: event.code, char: event.key.length === 1 ? event.key : null, down: true, ...(event.repeat ? { repeat: true } : {}) }, pointerGeometry: null });
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === "F3") { event.preventDefault(); return; }
    if (shouldSuppressGameplayKey(event.code, event.repeat, false, isFallbackTouchControlTarget(event.target), fallbackControlKeys)) return;
    pending.push({ tick: session.tick(), event: { kind: "key", name: event.key.toUpperCase(), code: event.code, char: event.key.length === 1 ? event.key : null, down: false }, pointerGeometry: null });
  };
  const focus = (state: "lost" | "gained"): void => {
    pending.push({ tick: session.tick(), event: { kind: "focus", state }, pointerGeometry: null });
  };
  const onBlur = (): void => {
    fallbackControlKeys.clear();
    focus("lost");
  };
  const onFocus = (): void => focus("gained");
  const onVisibility = (): void => focus(document.hidden ? "lost" : "gained");
  const viewSize = session.viewSize();
  const observedGeometry = createObservedHostGeometry(session.displayGeometry());
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
  const touchControls = createFallbackTouchControls(stage, observedGeometry.current, dispatchFallbackAction);
  const hostObserver = observeHostState(hostViewport, viewSize, (event) => {
    observedGeometry.observe(event);
    pending.push({ tick: null, event, pointerGeometry: null });
  }, session.hostState ?? undefined);
  session.setHostRestoreSnapshotProvider(() => {
    const snapshot = hostObserver.snapshotForRestore(pending);
    for (const event of snapshot.observations) observedGeometry.observe(event);
    return snapshot;
  });
  const pointerHost = stage;
  const stopPointerInput = attachPointerInput(
    pointerHost,
    viewSize,
    observedGeometry.current,
    ({ x, y }, buttons) => {
      const geometry = observedGeometry.current();
      reapplyObservedGeometryBeforePointer(session.displayGeometry(), observedGeometry, pending);
      pending.push({ tick: session.tick(), event: { kind: "pointer", x, y, buttons }, pointerGeometry: geometry });
    },
    () => {
      reapplyObservedGeometryBeforePointer(session.displayGeometry(), observedGeometry, pending);
      pending.push({ tick: session.tick(), event: { kind: "pointer.cancel" }, pointerGeometry: null });
    },
    ({ x, y }) => session.engine.runnerControlPointerPreemption(x, y),
    dispatchFallbackAction,
    () => session.engine.surfaceCacheEpoch(),
  );
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("pagehide", dispose);
    hostObserver.dispose();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    stopPointerInput();
    touchControls.close();
    session.close();
  };
  window.addEventListener("pagehide", dispose, { once: true });
  const draw = (now: number): void => {
    if (disposed) return;
    hostObserver.poll();
    touchControls.update(session.engine.hostFeatures().touch && !session.engine.customTouchControlsDeclared());
    accumulator += Math.max(0, now - previous);
    previous = now;
    const ticks = Math.floor(accumulator / stepMs);
    accumulator -= ticks * stepMs;
    const geometryNeedsTick = reapplyObservedGeometryBeforePointer(session.displayGeometry(), observedGeometry, pending);
    if (ticks === 0 && geometryNeedsTick) {
      requestAnimationFrame(draw);
      return;
    }
    const inputs = stampPendingInputs(pending, session.tick());
    const submittedActionSequence = fallbackActionSequence;
    pending = [];
    const tickBeforeAdvance = session.tick();
    void session.advance(ticks, inputs).then(() => {
      if (disposed) return;
      if (session.tick() !== tickBeforeAdvance) touchControls.acknowledgeSubmittedBatch(submittedActionSequence);
      reconcileObservedHostFeaturesAfterAdvance(session.engine.hostFeatures(), hostObserver, pending);
      const restoredGeometryNeedsTick = reconcileObservedGeometryAfterAdvance(session.displayGeometry(), observedGeometry, pending, session.tick());
      if (restoredGeometryNeedsTick) {
        requestAnimationFrame(draw);
        return;
      }
      const frame = session.draw(accumulator / stepMs);
      const player = session.playerPosition();
      const result = { tick: session.tick(), stateHash: session.stateHash(), drawHash: frame.drawHash, board: session.boardKey(), player };
      window.__live = result;
      const audioError = session.audioError();
      // The project's title (main-file row 56): the game's own title, its board-vector count and the measured frame rate.
      titleFrames += 1;
      const nowMs = performance.now();
      const updateTitle = nowMs - titleWindowStart >= 1_000;
      if (updateTitle) {
        const bar = session.titleBar();
        const fps = titleFrames * 1_000 / (nowMs - titleWindowStart);
        titleFrames = 0;
        titleWindowStart = nowMs;
        if (bar.showFps) document.title = formatTitleBar(bar, fps);
      }
      if (diagnostics !== null && (updateTitle || diagnostics.textContent === "")) {
        const located = session.diagnostics();
        diagnostics.textContent = [
          `tick ${result.tick} state ${result.stateHash} draw ${result.drawHash}`,
          `commands ${frame.commands} (drawn ${frame.render.drawn}, deferred ${frame.render.deferred})`,
          ...located.map((entry) => `${entry.code}@${entry.file}:${entry.line}: ${entry.message}`),
        ].join("\n");
        diagnostics.hidden = false;
      }
      status.textContent = [`tick ${result.tick}`, `state ${result.stateHash}`, `draw ${result.drawHash}`, player === null ? "player position unavailable" : `player ${player.x}, ${player.y}`, ...(audioError === null ? [] : [`audio: ${audioError}`]), "Move: arrows or WASD; click to walk."].join("\n");
      requestAnimationFrame(draw);
    }).catch((error: unknown) => {
      console.error(`player stopped at tick ${session.tick()}`, error);
      window.__live = { tick: session.tick(), stateHash: session.stateHash(), drawHash: "", board: session.boardKey(), player: session.playerPosition(), error: String(error) };
      status.textContent = `player: ${String(error)}`;
      status.hidden = false;
      dispose();
    });
  };
  requestAnimationFrame(draw);
  return dispose;
}
