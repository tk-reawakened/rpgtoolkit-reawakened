import { createElement, render } from "preact";
import type { ApplyResult, ProgramCommand } from "@tk-reawakened/editor-model";
import { VisualFixtureView, type BoardCoordinates, type VisualFixtureDocument } from "@tk-reawakened/editor-ui";

interface HostSnapshot { readonly text: string; readonly version: number; readonly readOnly: boolean }
interface PendingEdit { resolve(result: ApplyResult): void }
interface VscodeApi { postMessage(message: unknown): void; setState(state: unknown): void; getState(): unknown }
declare function acquireVsCodeApi(): VscodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById("root");
if (root === null) throw new Error("Visual fixture editor has no root element.");
let snapshot: HostSnapshot = { text: "", version: -1, readOnly: false };
const listeners = new Set<() => void>();
const pending = new Map<string, PendingEdit>();
const boardReads = new Map<string, (coordinates: BoardCoordinates | null) => void>();
let nextId = 0;
const identity = { key: "native-visual-fixture" };

const doc: VisualFixtureDocument = {
  identity,
  getSnapshot: () => ({ text: snapshot.text, readOnly: snapshot.readOnly ? { reason: "read-only" } : null }),
  subscribe(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  apply(command: ProgramCommand): Promise<ApplyResult> {
    if (command.edits.length !== 1) {
      return Promise.resolve({ ok: false, rejection: { reason: "invalid", message: "A fixture edit must change one source range." } });
    }
    const edit = command.edits[0]!;
    if (!Number.isInteger(edit.from) || !Number.isInteger(edit.to) || edit.from < 0 || edit.to < edit.from || edit.to > snapshot.text.length) {
      return Promise.resolve({ ok: false, rejection: { reason: "invalid", message: "The source changed; refresh the fixture editor and try again." } });
    }
    const id = `fixture-${++nextId}`;
    const promise = new Promise<ApplyResult>((resolve) => pending.set(id, { resolve }));
    vscode.postMessage({ type: "visual-fixtures:edit", id, version: snapshot.version, from: edit.from, to: edit.to, text: edit.text });
    return promise;
  },
};

function publish(next: HostSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (typeof event.data !== "object" || event.data === null) return;
  const value = event.data as Record<string, unknown>;
  if (value.type === "visual-fixtures:snapshot" && typeof value.text === "string" && typeof value.version === "number" && typeof value.readOnly === "boolean") {
    publish({ text: value.text, version: value.version, readOnly: value.readOnly });
  } else if (value.type === "visual-fixtures:board-mode-result" && typeof value.id === "string") {
    const settle = boardReads.get(value.id);
    if (settle === undefined) return;
    boardReads.delete(value.id);
    const coordinates = value.coordinates;
    if (typeof coordinates !== "object" || coordinates === null) {
      settle(null);
      return;
    }
    const { mode, width, height } = coordinates as Record<string, unknown>;
    settle((mode === "pixel" || mode === "tile") && typeof width === "number" && typeof height === "number"
      ? { mode, width, height }
      : null);
  } else if (value.type === "visual-fixtures:edit-result" && typeof value.id === "string") {
    const edit = pending.get(value.id);
    if (edit === undefined) return;
    pending.delete(value.id);
    edit.resolve(value.ok === true
      ? { ok: true, editId: value.id }
      : { ok: false, rejection: { reason: "invalid", message: typeof value.message === "string" ? value.message : "The source edit was refused." } });
  }
});

function boardCoordinates(path: string): Promise<BoardCoordinates | null> {
  const id = `board-${++nextId}`;
  return new Promise<BoardCoordinates | null>((resolve) => {
    boardReads.set(id, resolve);
    vscode.postMessage({ type: "visual-fixtures:board-mode", id, path });
  });
}

window.addEventListener("load", () => vscode.postMessage({ type: "visual-fixtures:ready" }));
render(createElement(VisualFixtureView, {
  doc,
  onEdited: () => {},
  onRun: (seed) => vscode.postMessage({ type: "visual-fixtures:run", seed }),
  boardCoordinates,
}), root);
