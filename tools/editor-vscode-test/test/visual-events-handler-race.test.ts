import { deepEqual, equal, match } from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const FAKE_VSCODE = `
const state = { commands: new Map(), textDocuments: [], pendingEdits: [], panel: undefined, activeTextEditor: undefined, messages: [], files: [], quickPicks: [], pickIndex: 0 };
export class Uri { constructor(path) { this.path = path; } static file(path) { return new Uri(path); } static joinPath(base, ...parts) { return new Uri([base.path, ...parts].join("/")); } toString() { return "file://" + this.path; } }
export class Position { constructor(line, character) { this.line = line; this.character = character; } }
export class Range { constructor(start, end) { this.start = start; this.end = end; } }
export class Selection extends Range {}
export const ViewColumn = { One: 1, Beside: 2 };
export const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };
export const TextEditorRevealType = { InCenterIfOutsideViewport: 1 };
export class WorkspaceEdit { replace(uri, range, text) { this.uri = uri; this.range = range; this.text = text; } }
const disposable = { dispose() {} };
export const workspace = {
  textDocuments: state.textDocuments,
  onDidChangeTextDocument() { return disposable; },
  onDidCloseTextDocument() { return disposable; },
  workspaceFolders: [{ uri: { path: "/Game/Example", toString() { return "file:///Game/Example"; } }, name: "Example", index: 0 }],
  fs: {
    // The fake filesystem the pane's asset picker reads: direct children of the directory named by the URI.
    readDirectory(uri) {
      const prefix = uri.path.endsWith("/") ? uri.path : uri.path + "/";
      const entries = new Map();
      for (const path of state.files) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length).split("/");
        if (rest.length === 1) entries.set(rest[0], FileType.File);
        else if (!entries.has(rest[0])) entries.set(rest[0], FileType.Directory);
      }
      return Promise.resolve([...entries]);
    },
  },
  applyEdit(edit) {
    return new Promise((resolve) => state.pendingEdits.push({ edit, resolve: (accepted) => {
      if (accepted) {
        const document = state.textDocuments.find((item) => item.uri.toString() === edit.uri.toString());
        const offset = (position) => document.getText().split("\\n").slice(0, position.line).reduce((length, line) => length + line.length + 1, 0) + position.character;
        const source = document.getText();
        document.source = source.slice(0, offset(edit.range.start)) + edit.text + source.slice(offset(edit.range.end));
        document.version += 1;
      }
      resolve(accepted);
    } }));
  },
};
export const window = {
  get activeTextEditor() { return state.activeTextEditor; },
  visibleTextEditors: [],
  createWebviewPanel() {
    const receiveListeners = [];
    const panel = { webview: { html: "", onDidReceiveMessage(listener) { receiveListeners.push(listener); return disposable; }, postMessage(message) { state.messages.push(message); return Promise.resolve(true); }, asWebviewUri(uri) { return uri; } }, reveal() {}, onDidDispose() { return disposable; }, receive(message) { return Promise.all(receiveListeners.map((listener) => listener(message))); } };
    state.panel = panel;
    return panel;
  },
  async showTextDocument() { return state.activeTextEditor; },
  async showQuickPick(items) { state.quickPicks.push(items); return items[state.pickIndex]; },
  showWarningMessage(message) { state.messages.push({ type: "warning", message }); return Promise.resolve(undefined); },
};
export const commands = {
  registerCommand(id, handler) { state.commands.set(id, handler); return disposable; },
  async executeCommand(id, ...args) { return await state.commands.get(id)?.(...args); },
};
export { state };
`;

interface FakeState {
  readonly commands: Map<string, (...args: unknown[]) => Promise<unknown>>;
  readonly textDocuments: FakeDocument[];
  readonly pendingEdits: { readonly edit: FakeEdit; readonly resolve: (accepted: boolean) => void }[];
  readonly panel?: FakePanel;
  activeTextEditor?: { readonly document: FakeDocument; readonly viewColumn: number };
  readonly messages: Record<string, unknown>[];
  readonly files: string[];
  readonly quickPicks: { readonly label: string; readonly reference: string }[][];
  pickIndex: number;
}
interface FakeDocument {
  readonly uri: { toString(): string; readonly path: string };
  readonly isUntitled: false;
  version: number;
  source: string;
  getText(): string;
}
interface FakeEdit { readonly uri: { toString(): string }; readonly range: { readonly start: { readonly line: number; readonly character: number }; readonly end: { readonly line: number; readonly character: number } }; readonly text: string }
interface FakePanel { readonly receive: (message: unknown) => Promise<unknown[]> }
interface Extension { registerVisualEvents(context: { subscriptions: unknown[]; extensionUri: unknown }): void }

test("registered Visual events handler serializes repeated deletes and reports stale source without touching opaque text", async () => {
  const host = new URL("../../../packages/host-vscode/dist/visual-events.js", import.meta.url).href;
  const fakeUrl = `data:text/javascript;base64,${Buffer.from(FAKE_VSCODE).toString("base64")}`;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      return specifier === "vscode" && context.parentURL === host
        ? { url: fakeUrl, shortCircuit: true }
        : next(specifier, context);
    },
  });
  let extension: Extension;
  try {
    extension = await import(host) as Extension;
  } finally {
    hooks.deregister();
  }
  const { state: fake, Uri } = await import(fakeUrl) as {
    readonly state: FakeState;
    readonly Uri: new (path: string) => FakeDocument["uri"];
  };
  const source = 'mwin("Keep")\nwait()\nmwincls()\n// handwritten opaque line\n';
  const document: FakeDocument = {
    uri: new Uri("/Game/Example/Prg/start.prg"),
    isUntitled: false,
    version: 1,
    source,
    getText() { return this.source; },
  };
  fake.textDocuments.push(document);
  fake.activeTextEditor = { document, viewColumn: 1 };
  extension.registerVisualEvents({ subscriptions: [], extensionUri: new Uri("/editor") });
  await fake.commands.get("tkr.visualEvents.show")!();
  const panel = fake.panel!;
  await panel.receive({ type: "ready" });
  const action = { type: "action", source, version: document.version, action: { type: "delete", from: source.indexOf("mwin") } };

  const first = panel.receive(action);
  const repeated = panel.receive(action);
  equal(fake.pendingEdits.length, 1, "the second same-URI action must wait for the first edit to finish");
  fake.pendingEdits[0]!.resolve(true);
  await Promise.all([first, repeated]);

  equal(fake.pendingEdits.length, 1, "the stale repeated delete must not submit an old-range edit");
  deepEqual(new TextEncoder().encode(document.getText()), new TextEncoder().encode("// handwritten opaque line\n"), "the opaque source bytes after the removed event must remain unchanged");
  const errors = fake.messages.filter((message) => message.type === "error").map((message) => message.message);
  equal(errors.length, 1);
  match(String(errors[0]), /source changed/i);
  deepEqual(fake.messages.filter((message) => message.type === "snapshot").at(-1), {
    type: "snapshot",
    source: "// handwritten opaque line\n",
    version: 2,
    readOnly: false,
    error: "The source changed. The visual event was not applied; review the updated source and try again.",
  });

  // A refused first edit does not advance the version. Reopening the file can then present identical text and
  // version through a different TextDocument, even while the Visual events pane remains open.
  document.source = source;
  const next = { ...action, version: document.version };
  const refused = panel.receive(next);
  const oldQueued = panel.receive(next);
  equal(fake.pendingEdits.length, 2);
  const reopened = { ...document };
  fake.textDocuments[0] = reopened;
  fake.activeTextEditor = { document: reopened, viewColumn: 1 };
  fake.pendingEdits[1]!.resolve(false);
  await setImmediate();
  equal(fake.pendingEdits.length, 2, "queued actions must not edit a reopened TextDocument that reuses the URI and revision");
  await Promise.all([refused, oldQueued]);
  equal(reopened.getText(), source);
  match(String(fake.messages.filter((message) => message.type === "error").at(-1)?.message), /source document was reopened/i);
});

test("every visual action kind reaches the native document as one range edit, and refusals edit nothing", async () => {
  const host = new URL("../../../packages/host-vscode/dist/visual-events.js", import.meta.url).href;
  const fakeUrl = `data:text/javascript;base64,${Buffer.from(FAKE_VSCODE).toString("base64")}`;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      return specifier === "vscode" && context.parentURL === host ? { url: fakeUrl, shortCircuit: true } : next(specifier, context);
    },
  });
  let extension: Extension;
  try {
    extension = await import(host) as Extension;
  } finally {
    hooks.deregister();
  }
  const { state: fake, Uri } = await import(fakeUrl) as { readonly state: FakeState; readonly Uri: new (path: string) => FakeDocument["uri"] };
  const document: FakeDocument = {
    uri: new Uri("/Game/Example/Prg/layout.prg"),
    isUntitled: false,
    version: 1,
    source: '// top\ntext(2, 3, "HP")\ndelay(1)\nif (a == 1) {\n  b()\n}\n',
    getText() { return this.source; },
  };
  fake.textDocuments.length = 0;
  fake.commands.clear();
  fake.pendingEdits.length = 0;
  fake.messages.length = 0;
  fake.textDocuments.push(document);
  fake.activeTextEditor = { document, viewColumn: 1 };
  extension.registerVisualEvents({ subscriptions: [], extensionUri: new Uri("/editor") });
  await fake.commands.get("tkr.visualEvents.show")!();
  const panel = fake.panel!;
  await panel.receive({ type: "ready" });
  const act = async (action: Record<string, unknown>): Promise<void> => {
    const done = panel.receive({ type: "action", source: document.getText(), version: document.version, action });
    await setImmediate();
    const edit = fake.pendingEdits.shift();
    if (edit !== undefined) edit.resolve(true);
    await done;
  };
  const at = (needle: string): number => document.getText().indexOf(needle);

  await act({ type: "nudge", from: at("text("), dx: 1, dy: 0 });
  equal(document.getText(), '// top\ntext(3, 3, "HP")\ndelay(1)\nif (a == 1) {\n  b()\n}\n');
  await act({ type: "move", from: at("text("), x: 4, y: 5 });
  equal(document.getText().split("\n")[1], 'text(4, 5, "HP")');
  await act({ type: "reorder", from: at("delay("), direction: "up" });
  equal(document.getText(), '// top\ndelay(1)\ntext(4, 5, "HP")\nif (a == 1) {\n  b()\n}\n');
  await act({ type: "edit", from: at("delay("), values: [2.5] });
  equal(document.getText().split("\n")[1], "delay(2.5)");
  await act({ type: "condition", from: at("if ("), condition: "a >= 2" });
  equal(document.getText().split("\n")[3], "if (a >= 2) {");
  await act({ type: "add-template", templateId: "wait-key", at: at("if (") });
  equal(document.getText(), '// top\ndelay(2.5)\ntext(4, 5, "HP")\nwait()\nif (a >= 2) {\n  b()\n}\n');
  await act({ type: "add-template", templateId: "give-item" });
  equal(document.getText().endsWith("}\ngiveitem(\"potion.itm\")\n"), true);
  await act({ type: "delete", from: at("wait()") });
  equal(document.getText(), '// top\ndelay(2.5)\ntext(4, 5, "HP")\nif (a >= 2) {\n  b()\n}\ngiveitem("potion.itm")\n');
  equal(fake.pendingEdits.length, 0);

  const before = document.getText();
  const versionBefore = document.version;
  await act({ type: "move", from: at("text("), x: 0, y: 5 });
  await act({ type: "condition", from: at("if ("), condition: "a == 1 && b" });
  await act({ type: "reorder", from: at("delay("), direction: "up" });
  equal(document.getText(), before);
  equal(document.version, versionBefore);
  const reasons = fake.messages.filter((message) => message.type === "error").map((message) => String(message.message));
  equal(reasons.length, 3);
  match(reasons[0]!, /X must be at least 1/);
  match(reasons[1]!, /simple comparison/);
  match(reasons[2]!, /beside another supported event/);

  // A malformed action is ignored before it can reach the handler.
  await panel.receive({ type: "action", source: before, version: document.version, action: { type: "nudge", from: 1, dx: "1", dy: 0 } });
  await panel.receive({ type: "action", source: before, version: document.version, action: { type: "reorder", from: 1, direction: "sideways" } });
  equal(fake.pendingEdits.length, 0);
  equal(document.getText(), before);

  fake.files.push("/Game/Example/Bitmap/sub/pic.png", "/Game/Example/Bitmap/notes.txt", "/Game/Example/Item/potion.itm");
  await panel.receive({ type: "pick-asset", id: 7, request: { kind: "bitmaps", extensions: [".png", ".bmp"], field: "Choose bitmap file" } });
  deepEqual(fake.quickPicks.at(-1), [{ label: "sub\\pic.png", reference: "sub\\pic.png" }]);
  deepEqual(fake.messages.filter((message) => message.type === "asset-picked").at(-1), { type: "asset-picked", id: 7, reference: "sub\\pic.png" });
  const picks = fake.quickPicks.length;
  await panel.receive({ type: "pick-asset", id: 8, request: { kind: "notAKind", extensions: [], field: "x" } });
  equal(fake.quickPicks.length, picks, "an unknown asset kind never reaches the picker");
  await panel.receive({ type: "pick-asset", id: 9, request: { kind: "fonts", extensions: [".ttf"], field: "Choose font" } });
  deepEqual(fake.messages.filter((message) => message.type === "asset-picked").at(-1), { type: "asset-picked", id: 9, reference: null });
  match(String(fake.messages.filter((message) => message.type === "warning").at(-1)?.message), /No matching files/);
});
