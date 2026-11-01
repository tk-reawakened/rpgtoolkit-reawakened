import type { InputRecord } from "@tk-reawakened/core";
import { interactivePackage } from "@tk-reawakened/runner-web";
import { createLiveSession, type LiveSession } from "@tk-reawakened/runner-web/live-session";

type Host = {
  openPackage(): Promise<{ readonly name: string; readonly bytes: Uint8Array; readonly descriptor: unknown } | null>;
  readBlob(area: "saves" | "files", gameId: string, path: string): Promise<Uint8Array | null>;
  writeBlob(area: "saves" | "files", gameId: string, path: string, bytes: Uint8Array): Promise<boolean>;
  listBlobs(area: "saves" | "files", gameId: string): Promise<string[]>;
};
declare global { interface Window { desktop?: Host; __live?: { tick: number; stateHash: string; drawHash: string; player: { x: number; y: number } | null; error?: string } } }

void start().catch((error: unknown) => {
  const status = document.querySelector<HTMLElement>("#live-status");
  if (status !== null) status.textContent = `player: ${String(error)}`;
  window.__live = { tick: 0, stateHash: "", drawHash: "", player: null, error: String(error) };
});

async function start(): Promise<void> {
  const host = window.desktop;
  const canvas = document.querySelector<HTMLCanvasElement>("#screen");
  const status = document.querySelector<HTMLElement>("#live-status");
  if (host === undefined || canvas === null || status === null) throw new Error("desktop player host or attached canvas is absent");
  const opened = await host.openPackage();
  if (opened === null) throw new Error("no package was named on the command line");
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
  const session = createLiveSession({
    interactive: true,
    mainFile: pkg.main,
    gameIdentity: pkg.gameIdentity,
    files,
    bundled,
    gl,
    blobs: {
      read: (area, gameId, path) => host.readBlob(area, gameId, path),
      write: (area, gameId, path, bytes) => host.writeBlob(area, gameId, path, bytes),
      list: (area, gameId) => host.listBlobs(area, gameId),
    },
  });
  const view = session.viewSize();
  canvas.width = view.width;
  canvas.height = view.height;
  run(session, canvas, status);
}

function run(session: LiveSession, canvas: HTMLCanvasElement, status: HTMLElement): void {
  const stepMs = 1000 / 60;
  let previous = performance.now();
  let accumulator = 0;
  let pending: InputRecord[] = [];
  let disposed = false;
  const onKeyDown = (event: KeyboardEvent): void => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    pending.push({ tick: session.tick(), event: { kind: "key", name: event.key.toUpperCase(), code: event.code, char: event.key.length === 1 ? event.key : null, down: true, ...(event.repeat ? { repeat: true } : {}) } });
  };
  const onKeyUp = (event: KeyboardEvent): void => pending.push({ tick: session.tick(), event: { kind: "key", name: event.key.toUpperCase(), code: event.code, char: event.key.length === 1 ? event.key : null, down: false } });
  const focus = (state: "lost" | "gained"): void => pending.push({ tick: session.tick(), event: { kind: "focus", state } });
  const onBlur = (): void => focus("lost");
  const onFocus = (): void => focus("gained");
  const onVisibility = (): void => focus(document.hidden ? "lost" : "gained");
  const onPointer = (event: PointerEvent): void => {
    const bounds = canvas.getBoundingClientRect();
    pending.push({ tick: session.tick(), event: { kind: "pointer", x: Math.floor((event.clientX - bounds.left) * canvas.width / bounds.width), y: Math.floor((event.clientY - bounds.top) * canvas.height / bounds.height), buttons: event.buttons } });
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", onPointer);
  canvas.addEventListener("pointermove", onPointer);
  canvas.addEventListener("pointerup", onPointer);
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("pointerdown", onPointer);
    canvas.removeEventListener("pointermove", onPointer);
    canvas.removeEventListener("pointerup", onPointer);
    session.close();
  };
  window.addEventListener("pagehide", dispose, { once: true });
  const draw = (now: number): void => {
    if (disposed) return;
    accumulator += Math.max(0, now - previous);
    previous = now;
    const ticks = Math.floor(accumulator / stepMs);
    accumulator -= ticks * stepMs;
    const inputs = pending;
    pending = [];
    void session.advance(ticks, inputs).then(() => {
      if (disposed) return;
      const view = session.viewSize();
      if (canvas.width !== view.width) canvas.width = view.width;
      if (canvas.height !== view.height) canvas.height = view.height;
      const frame = session.draw(accumulator / stepMs);
      const player = session.playerPosition();
      const result = { tick: session.tick(), stateHash: session.stateHash(), drawHash: frame.drawHash, player };
      window.__live = result;
      status.textContent = [`tick ${result.tick}`, `state ${result.stateHash}`, `draw ${result.drawHash}`, player === null ? "player position unavailable" : `player ${player.x}, ${player.y}`, "Move: arrows or WASD; click to walk."].join("\n");
      requestAnimationFrame(draw);
    }).catch((error: unknown) => {
      window.__live = { tick: session.tick(), stateHash: session.stateHash(), drawHash: "", player: session.playerPosition(), error: String(error) };
      status.textContent = `player: ${String(error)}`;
      dispose();
    });
  };
  requestAnimationFrame(draw);
}
