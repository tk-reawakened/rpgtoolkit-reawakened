import { type InputRecord, type SurfaceId } from "@tk-reawakened/core";
import { parseClosingPlan, type ClosingFiles } from "@tk-reawakened/runner-harness";
import { fetchBundled, fetchGame, fontProvider, distributionPackage, interactivePackage, runScriptedFrame } from "../src/index.ts";
import { pointerEventToLogical } from "../src/pointer.ts";
import { createLiveSession, fitCanvas, type LiveSession } from "../src/live-session.ts";

declare global {
  interface Window {
    __report?: unknown;
    __live?: { tick: number; stateHash: string; drawHash: string; board: string | null; player: { x: number; y: number } | null; error?: string };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#screen");
const output = document.querySelector<HTMLPreElement>("#report");
if (canvas === null || output === null) throw new Error("player: the page is missing its canvas or report");
const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: false, preserveDrawingBuffer: true });
if (gl === null) {
  output.textContent = "player: this browser has no WebGL2 context";
  window.__report = { error: "no-webgl2" };
} else {
  void boot(gl, canvas, output);
}

async function boot(context: WebGL2RenderingContext, screen: HTMLCanvasElement, report: HTMLPreElement): Promise<void> {
  try {
    const params = new URLSearchParams(location.search);
    const pack = params.get("package");
    const parity = params.has("parity");
    const tracer = params.has("tracer");
    let planText = "";
    let game = "";
    let files: ClosingFiles;
    let bundled: ClosingFiles;
    let mainFile: string | undefined;
    let gameIdentity: string | undefined;
    if (parity || tracer) {
      planText = await (await fetch("/golden/closing/plan.json")).text();
      game = params.get("game") ?? "demo";
      if (pack === null) files = await fetchGame("", `fixtures/legacy/${game}`);
      else {
        const pkg = distributionPackage(pack.split("/").at(-1) ?? "game.tpk", new Uint8Array(await (await fetch(`/${pack}`)).arrayBuffer()));
        files = pkg.files;
        mainFile = pkg.main;
      }
      bundled = await fetchBundled("", parseClosingPlan(planText).bundled);
    } else {
      if (pack === null) throw new Error("interactive play requires a distribution package in ?package=");
      const packageName = pack.split("/").at(-1) ?? "game.tpk";
      const packageBytes = new Uint8Array(await (await fetch(`/${pack}`)).arrayBuffer());
      const descriptorResponse = await fetch(`/${pack}.json`);
      if (!descriptorResponse.ok) throw new Error(`package descriptor unavailable: ${descriptorResponse.status}`);
      const pkg = await interactivePackage(packageName, packageBytes, await descriptorResponse.json());
      files = pkg.files;
      mainFile = pkg.main;
      gameIdentity = pkg.gameIdentity;
      game = pkg.gameIdentity;
      const listed = (await (await fetch("/apps/bundled.json")).json()) as { readonly folders: readonly string[] };
      bundled = await fetchBundled("", listed.folders);
    }
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
    const session = parity
      ? createLiveSession({ planText, gameName: game, files, bundled, gl: context })
      : createLiveSession({ interactive: true, mainFile: mainFile!, gameIdentity: gameIdentity!, files, bundled, gl: context, blobs: webBlobHost() });
    if (parity) {
      await runParity(session, report, game, pack);
      return;
    }
    const view = session.viewSize();
    const fit = (): void => {
      fitCanvas(screen, view.width, view.height, {
        width: window.innerWidth,
        height: Math.max(80, window.innerHeight - report.offsetHeight - 24),
      });
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("pagehide", () => window.removeEventListener("resize", fit), { once: true });
    startLiveLoop(session, screen, report);
  } catch (error) {
    window.__report = { error: String(error) };
    report.textContent = `player: ${String(error)}`;
  }
}

async function runParity(session: LiveSession, report: HTMLPreElement, game: string, pack: string | null): Promise<void> {
  await session.advance(0);
  let inputs: InputRecord[] = [];
  for (const tick of [30, 60, 90, 120]) {
    await session.advance(tick - session.tick(), inputs);
    inputs = [];
    // The closing harness captures the tick-30 title frame before sending ENTER. Its screen-surface read refreshes
    // core's saved screen surface, so reproducing that capture is necessary for the same later state hashes.
    if (tick === 30) {
      for (let rev = 0; rev < 4096; rev += 1) {
        if (session.engine.surfacePixels(0 as SurfaceId, rev) !== null) break;
      }
    }
    if (tick < 120) {
      inputs.push({ tick, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: true } });
      inputs.push({ tick, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: false } });
    }
  }
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
  window.__report = result;
  report.textContent = [`${game} tick ${result.tick}`, `state ${result.stateHash}`, `draw  ${result.drawHash}`, `commands ${result.commands}: drawn ${frame.render.drawn}, deferred ${frame.render.deferred}`].join("\n");
}

function webBlobHost() {
  const key = (area: string, gameId: string, path: string): string => `tkr:${area}:${gameId}:${path}`;
  return {
    async read(area: "saves" | "files", gameId: string, path: string): Promise<Uint8Array | null> {
      try {
        const value = localStorage.getItem(key(area, gameId, path));
        if (value === null) return null;
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
      } catch {
        return null;
      }
    },
    async write(area: "saves" | "files", gameId: string, path: string, bytes: Uint8Array): Promise<boolean> {
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      try { localStorage.setItem(key(area, gameId, path), btoa(binary)); return true; }
      catch { return false; }
    },
    async list(area: "saves" | "files", gameId: string): Promise<readonly string[]> {
      try {
        const prefix = `tkr:${area}:${gameId}:`;
        const paths: string[] = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const candidate = localStorage.key(i);
          if (candidate?.startsWith(prefix)) paths.push(candidate.slice(prefix.length));
        }
        return paths.sort();
      } catch {
        return [];
      }
    },
  };
}

function startLiveLoop(session: LiveSession, canvas: HTMLCanvasElement, report: HTMLPreElement): void {
  const stepMs = 1000 / 60;
  let previous = performance.now();
  let accumulator = 0;
  let disposed = false;
  let pending: InputRecord[] = [];
  const viewSize = session.viewSize();
  const pointer = (event: PointerEvent): void => {
    const { x, y } = pointerEventToLogical(event, canvas, viewSize);
    pending.push({ tick: session.tick(), event: { kind: "pointer", x, y, buttons: event.buttons } });
  };
  const key = (event: KeyboardEvent, down: boolean): void => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    pending.push({ tick: session.tick(), event: { kind: "key", name: event.key.toUpperCase(), code: event.code, char: event.key.length === 1 ? event.key : null, down, ...(event.repeat ? { repeat: true } : {}) } });
  };
  const onKeyDown = (event: KeyboardEvent): void => key(event, true);
  const onKeyUp = (event: KeyboardEvent): void => key(event, false);
  const focus = (state: "lost" | "gained"): void => {
    pending.push({ tick: session.tick(), event: { kind: "focus", state } });
  };
  const onBlur = (): void => focus("lost");
  const onFocus = (): void => focus("gained");
  const onVisibility = (): void => focus(document.hidden ? "lost" : "gained");
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", pointer);
  canvas.addEventListener("pointermove", pointer);
  canvas.addEventListener("pointerup", pointer);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("pointerdown", pointer);
    canvas.removeEventListener("pointermove", pointer);
    canvas.removeEventListener("pointerup", pointer);
    session.close();
  };
  window.addEventListener("pagehide", dispose, { once: true });
  const frame = (now: number): void => {
    if (disposed) return;
    const elapsed = Math.max(0, now - previous);
    previous = now;
    accumulator += elapsed;
    const wholeTicks = Math.floor(accumulator / stepMs);
    accumulator -= wholeTicks * stepMs;
    const inputs = pending;
    pending = [];
    void session.advance(wholeTicks, inputs).then(() => {
      if (disposed) return;
      const drawn = session.draw(accumulator / stepMs);
      const player = session.playerPosition();
      const live = { tick: session.tick(), stateHash: session.stateHash(), drawHash: drawn.drawHash, board: session.boardKey(), player };
      window.__live = live;
      window.__report = live;
      report.textContent = [
        `live ${location.search.includes("package=") ? "package" : "game"} — tick ${live.tick}`,
        `state ${live.stateHash}`,
        `draw  ${live.drawHash} (${drawn.commands} commands; ${drawn.render.drawn} drawn, ${drawn.render.deferred} deferred)`,
        player === null ? "player position unavailable" : `player ${player.x}, ${player.y}`,
        "Move: arrows or WASD; click the board to walk.",
      ].join("\n");
      requestAnimationFrame(frame);
    }).catch((error: unknown) => {
      window.__live = { tick: session.tick(), stateHash: session.stateHash(), drawHash: "", board: session.boardKey(), player: session.playerPosition(), error: String(error) };
      report.textContent = `player: ${String(error)}`;
      dispose();
    });
  };
  requestAnimationFrame(frame);
}
