import { mountCreatorTests, type CreatorTestsController, type CreatorTestsState, type CreatorTestsFrame } from "@tk-reawakened/editor-ui";
import { platformError, type PlatformResult } from "@tk-reawakened/platform-services";

interface VsCodeApi {
  postMessage(message: unknown): void;
}
interface Request {
  readonly id: string;
  readonly method: "run" | "openSource";
  readonly args: readonly unknown[];
  readonly resolve: (result: PlatformResult<void>) => void;
}

declare global {
  interface Window { acquireVsCodeApi(): VsCodeApi }
}

const root = document.getElementById("root");
if (root === null) throw new Error("Creator tests view root is missing.");
const nonce = root.dataset.bridgeNonce;
if (nonce === undefined || !/^[a-f0-9]{36}$/.test(nonce)) throw new Error("Creator tests bridge nonce is invalid.");
const vscode = window.acquireVsCodeApi();
const listeners = new Set<() => void>();
const pending = new Map<string, Request>();
let state: CreatorTestsState = { phase: "idle", report: null, frame: null, message: null };
let disposed = false;
let sequence = 0;

const controller: CreatorTestsController = {
  getSnapshot: () => state,
  subscribe(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  run(request) {
    return send("run", [request]);
  },
  openSource(path, line, column) {
    return send("openSource", [path, line, column]);
  },
  dispose: close,
};

function send(method: Request["method"], args: readonly unknown[]): Promise<PlatformResult<void>> {
  if (disposed) return Promise.resolve(platformError("unavailable", "The saved-tests view has closed."));
  const id = `${(++sequence).toString(16).padStart(8, "0")}${[...crypto.getRandomValues(new Uint8Array(8))].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  return new Promise((resolve) => {
    pending.set(id, { id, method, args, resolve });
    try {
      vscode.postMessage({ type: "creator-tests:request", nonce, id, method, args });
    } catch (error) {
      pending.delete(id);
      resolve(platformError("io-error", `Could not send saved-tests request: ${String(error)}`));
    }
  });
}

function receive(event: MessageEvent<unknown>): void {
  const message = event.data;
  if (typeof message !== "object" || message === null || Array.isArray(message)) return;
  const value = message as Record<string, unknown>;
  if (value.nonce !== nonce) return;
  if (value.type === "creator-tests:snapshot") {
    const next = parseState(value.state);
    if (next === undefined) return;
    state = next;
    for (const listener of listeners) listener();
    return;
  }
  if (value.type === "creator-tests:response" && typeof value.id === "string") {
    const request = pending.get(value.id);
    if (request === undefined) return;
    pending.delete(value.id);
    request.resolve(parseResult(value.result));
  }
}

function parseState(value: unknown): CreatorTestsState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (!(["idle", "preparing", "running", "complete", "failed", "closed"] as unknown[]).includes(item.phase)
    || !(item.report === null || isPlainRecord(item.report)) || !(item.message === null || typeof item.message === "string")) return undefined;
  let frame: CreatorTestsFrame | null = null;
  if (item.frame !== null) {
    if (!isPlainRecord(item.frame) || !Number.isSafeInteger(item.frame.tick) || (item.frame.tick as number) < 0
      || !Number.isSafeInteger(item.frame.width) || (item.frame.width as number) < 1 || (item.frame.width as number) > 640
      || !Number.isSafeInteger(item.frame.height) || (item.frame.height as number) < 1 || (item.frame.height as number) > 480
      || !Array.isArray(item.frame.rgba) || item.frame.rgba.length !== (item.frame.width as number) * (item.frame.height as number) * 4
      || item.frame.rgba.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) return undefined;
    frame = { tick: item.frame.tick as number, width: item.frame.width as number, height: item.frame.height as number, rgba: Uint8Array.from(item.frame.rgba as number[]) };
  }
  return { phase: item.phase as CreatorTestsState["phase"], report: item.report as CreatorTestsState["report"], frame, message: item.message as string | null };
}

function parseResult(value: unknown): PlatformResult<void> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return platformError("io-error", "The saved-tests host returned an invalid response.");
  const item = value as Record<string, unknown>;
  if (item.ok === true && item.value === undefined) return { ok: true, value: undefined };
  if (item.ok === false && typeof item.error === "object" && item.error !== null && !Array.isArray(item.error)) {
    const error = item.error as Record<string, unknown>;
    if (typeof error.code === "string" && typeof error.message === "string") return { ok: false, error: { code: error.code as never, message: error.message } };
  }
  return platformError("io-error", "The saved-tests host returned an invalid response.");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function close(): void {
  if (disposed) return;
  disposed = true;
  window.removeEventListener("message", receive);
  window.removeEventListener("pagehide", close);
  for (const request of pending.values()) request.resolve(platformError("unavailable", "The saved-tests view closed before the request completed."));
  pending.clear();
  listeners.clear();
}

window.addEventListener("message", receive);
window.addEventListener("pagehide", close);
const view = mountCreatorTests(root, { controller });
window.addEventListener("pagehide", () => view.dispose(), { once: true });
