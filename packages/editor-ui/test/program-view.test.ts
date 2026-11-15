// The program editor (story 11.7) over the real program document and the in-memory platform-services double, rendered
// under the DOM shim. The code editor is the plain text area, or a spy surface where the test is about what the view
// tells its surface. Assertions are on the DOM, the document and the bytes written.
import { after, before, test } from "node:test";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  createDocumentIdentity,
  createPendingEdits,
  DEFAULT_PROGRAM_PREFERENCES,
  openProgramDocument,
  type PendingEdits,
  type ProgramDocument,
  type ProgramPreferences,
} from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { LanguageMessage } from "@tk-reawakened/platform-services";
import type { mount as mountView } from "../src/index.ts";
import type { ProgramViewDocument } from "../src/program-view.tsx";
import type { LanguageFeatures, SurfaceDiagnostic, TextSurface, TextSurfaceFactory, TextSurfaceHost } from "../src/text-surface.ts";

const PATH = "Prg/intro.prg";
const bytes = (value: string): Uint8Array => Uint8Array.from(value, (ch) => ch.charCodeAt(0));

type Mount = typeof mountView;
let mount: Mount;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

/** Let promises and zero-delay timers the view started run, a few rounds. */
async function settled(): Promise<void> {
  for (let round = 0; round < 6; round += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

interface Setup {
  readonly host: MemoryPlatformServices;
  readonly doc: ProgramDocument;
  readonly el: HTMLElement;
  readonly pending: PendingEdits;
}

interface SetupOptions {
  readonly content?: string | Uint8Array;
  readonly capabilities?: readonly ("folderWrite" | "fileWatch" | "stableProjectHandle" | "conflictReload" | "conflictAutoSave" | "languageServer")[];
  readonly onLanguageMessage?: (message: LanguageMessage, session: Parameters<NonNullable<Parameters<typeof createMemoryPlatformServices>[0]>["onLanguageMessage"] & {}>[1]) => void;
}

async function setup(options: SetupOptions = {}): Promise<Setup> {
  const content = options.content ?? "x = 1\r\ny = 2\r\n";
  const host = createMemoryPlatformServices({
    files: { [PATH]: typeof content === "string" ? bytes(content) : content },
    ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
    ...(options.onLanguageMessage === undefined ? {} : { onLanguageMessage: options.onLanguageMessage }),
  });
  const opened = await openProgramDocument(host.fs, createDocumentIdentity("memory-project", PATH));
  if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened.error)}`);
  const el = document.createElement("div");
  document.body.append(el);
  return { host, doc: opened.document, el, pending: createPendingEdits() };
}

interface Show {
  readonly createSurface?: TextSurfaceFactory;
  readonly project?: { readonly main: string } | null;
  readonly preferences?: ProgramPreferences;
  readonly history?: boolean;
}

function show(s: Setup, options: Show = {}) {
  const view: ProgramViewDocument = options.history === false
    ? { kind: s.doc.kind, identity: s.doc.identity, getSnapshot: () => s.doc.getSnapshot(), subscribe: (l) => s.doc.subscribe(l), apply: (c) => s.doc.apply(c), save: () => s.doc.save(), resolveConflict: (c) => s.doc.resolveConflict(c) }
    : { kind: s.doc.kind, identity: s.doc.identity, getSnapshot: () => s.doc.getSnapshot(), subscribe: (l) => s.doc.subscribe(l), apply: (c) => s.doc.apply(c), save: () => s.doc.save(), resolveConflict: (c) => s.doc.resolveConflict(c), undo: () => s.doc.undo(), redo: () => s.doc.redo() };
  let handle: ReturnType<Mount> | undefined;
  void act(() => {
    handle = mount(s.el, {
      document: view,
      services: s.host,
      pendingEdits: s.pending,
      codeEditor: {
        ...(options.createSurface === undefined ? {} : { createSurface: options.createSurface }),
        ...(options.project === undefined ? {} : { project: options.project }),
        ...(options.preferences === undefined ? {} : { preferences: { get: () => options.preferences!, subscribe: () => () => {} } }),
      },
    });
  });
  if (handle === undefined) throw new Error("mount returned nothing");
  return handle;
}

const area = (el: HTMLElement): HTMLTextAreaElement => {
  const found = el.querySelector("textarea");
  if (found === null) throw new Error("no <textarea>");
  return found;
};
const named = (el: HTMLElement, label: string): HTMLButtonElement => {
  const found = [...el.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim().startsWith(label));
  if (found === undefined) throw new Error(`no button "${label}": ${[...el.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  return found;
};
const alerts = (el: HTMLElement): string[] => [...el.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");
const stateOf = (el: HTMLElement): string => el.querySelector(".tkr-program-state")?.textContent ?? "";
const noteOf = (el: HTMLElement): string => el.querySelector(".tkr-program-language-note")?.textContent ?? "";

async function type(el: HTMLElement, value: string): Promise<void> {
  await act(() => {
    const field = area(el);
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(target: HTMLElement, init: KeyboardEventInit): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const textOf = (s: Setup): string => s.doc.getSnapshot().text;

test("the text area shows the document's LF text; typing becomes one labelled edit once the view settles, and Save writes the bytes", async () => {
  const s = await setup();
  show(s);
  equal(area(s.el).value, "x = 1\ny = 2\n");
  await type(s.el, "x = 1\ny = 22\n");
  match(stateOf(s.el), /Unsaved/);
  // Typing not yet handed to the document: the workspace's Save waits for it.
  equal(s.pending.busy(), true);
  equal(textOf(s), "x = 1\ny = 2\n");
  await act(() => s.pending.settle());
  equal(textOf(s), "x = 1\ny = 22\n");
  equal(s.doc.getSnapshot().edits.at(-1)!.label, "Typing");
  equal(s.host.editedEvents.length, 1);
  equal(s.host.editedEvents[0]!.label, "Typing");
  await act(async () => { await named(s.el, "Save").click(); });
  await settled();
  deepEqual(s.host.bytesOf(PATH), bytes("x = 1\r\ny = 22\r\n"));
  match(stateOf(s.el), /All changes saved/);
});

test("Save from the keyboard flushes typing first, so nothing typed a moment ago is left out", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "x = 1\nz = 3\n");
  const event = await key(area(s.el), { key: "s", ctrlKey: true });
  equal(event.defaultPrevented, true);
  await settled();
  deepEqual(s.host.bytesOf(PATH), bytes("x = 1\r\nz = 3\r\n"));
});

test("undo and redo go to the document, and the text area follows it", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "x = 1\ny = 22\n");
  const undo = await key(area(s.el), { key: "z", ctrlKey: true });
  equal(undo.defaultPrevented, true);
  await settled();
  equal(textOf(s), "x = 1\ny = 2\n");
  equal(area(s.el).value, "x = 1\ny = 2\n");
  await key(area(s.el), { key: "z", ctrlKey: true, shiftKey: true });
  await settled();
  equal(area(s.el).value, "x = 1\ny = 22\n");
  equal(textOf(s), "x = 1\ny = 22\n");
});

test("a host with no undo leaves the surface's own undo alone", async () => {
  const s = await setup();
  show(s, { history: false });
  const event = await key(area(s.el), { key: "z", ctrlKey: true });
  equal(event.defaultPrevented, false);
});

test("an edit the document refuses is said in an alert and the text area goes back to the document's text", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "x = 1\ny = 2\n\u2603");
  await act(() => s.pending.settle());
  await settled();
  equal(textOf(s), "x = 1\ny = 2\n");
  equal(area(s.el).value, "x = 1\ny = 2\n");
  ok(alerts(s.el).some((text) => text.includes("U+2603") && text.includes("line 3")), alerts(s.el).join("|"));
  equal(s.host.editedEvents.length, 0);
});

test("Insert header puts the expanded template at the start as one undoable edit", async () => {
  const s = await setup();
  show(s, { preferences: { ...DEFAULT_PROGRAM_PREFERENCES, headerTemplate: "// {name} ({path})\n" } });
  await act(async () => { named(s.el, "Insert header").click(); });
  await settled();
  equal(textOf(s), "// intro (Prg/intro.prg)\nx = 1\ny = 2\n");
  equal(area(s.el).value, textOf(s));
  equal(s.doc.getSnapshot().edits.at(-1)!.label, "Insert header");
  ok(s.doc.undo().ok);
  equal(textOf(s), "x = 1\ny = 2\n");
});

test("an empty header template says so and changes nothing", async () => {
  const s = await setup();
  show(s, { preferences: { ...DEFAULT_PROGRAM_PREFERENCES, headerTemplate: "" } });
  await act(async () => { named(s.el, "Insert header").click(); });
  match(alerts(s.el).join("|"), /empty/);
  equal(textOf(s), "x = 1\ny = 2\n");
});

test("the command reference filters, and inserting replaces the selection with name( and its required parameters", async () => {
  const s = await setup({ content: "before\n" });
  show(s);
  const search = s.el.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(() => {
    search.value = "mwin";
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const rows = [...s.el.querySelectorAll(".tkr-program-reference-list button")];
  ok(rows.length >= 1 && rows.every((row) => /mwin/i.test(row.textContent ?? "") || (row.getAttribute("title") ?? "").length > 0));
  const target = rows.find((row) => /^mwin\(/i.test(row.textContent ?? ""))!;
  area(s.el).setSelectionRange(0, 6);
  await act(async () => { target.dispatchEvent(new Event("dblclick", { bubbles: true })); });
  await settled();
  match(textOf(s), /^mwin\(.*\)\n$/i);
  equal(area(s.el).value, textOf(s));
  const written = textOf(s).trimEnd();
  equal(area(s.el).selectionStart, "mwin(".length);
  equal(area(s.el).selectionEnd, written.length - 1);
});

test("a compiled program is read only: no edit, no insert, and the reason is shown", async () => {
  const s = await setup({ content: Uint8Array.from([0, 1, 2]) });
  show(s);
  match(s.el.querySelector(".tkr-program-readonly")?.textContent ?? "", /compiled/);
  equal(named(s.el, "Insert header").disabled, true);
  equal(named(s.el, "Save").disabled, true);
  equal(area(s.el).readOnly, true);
});

test("distraction-free mode leaves only the text and an exit; Escape and the button both bring the tools back", async () => {
  const s = await setup();
  show(s);
  await act(async () => { named(s.el, "Distraction-free").click(); });
  ok(s.el.querySelector(".tkr-program--focus") !== null);
  equal(s.el.ownerDocument.activeElement, area(s.el), "focus moves into the editor when the toolbar disappears");
  equal(s.el.querySelector(".tkr-program-toolbar"), null);
  equal(s.el.querySelector(".tkr-program-reference"), null);
  ok(area(s.el) !== null, "the text stays");
  await key(area(s.el), { key: "Escape" });
  equal(s.el.querySelector(".tkr-program--focus"), null);
  ok(s.el.querySelector(".tkr-program-toolbar") !== null);
  await act(async () => { named(s.el, "Distraction-free").click(); });
  await act(async () => { named(s.el, "Exit distraction-free").click(); });
  ok(s.el.querySelector(".tkr-program-toolbar") !== null);
  equal(textOf(s), "x = 1\ny = 2\n", "the mode changes nothing in the document");
  equal(s.doc.getSnapshot().dirty, false);
});

test("a host with no language service says so, and the text edits and saves", async () => {
  const s = await setup();
  show(s);
  match(noteOf(s.el), /not available in this host/);
  await type(s.el, "x = 9\n");
  await act(() => s.pending.settle());
  await act(async () => { await named(s.el, "Save").click(); });
  await settled();
  deepEqual(s.host.bytesOf(PATH), bytes("x = 9\r\n"));
});

interface Spy {
  readonly factory: TextSurfaceFactory;
  readonly calls: string[];
  host(): TextSurfaceHost;
  features(): LanguageFeatures | null;
  diagnostics(): readonly SurfaceDiagnostic[];
  text(): string;
  /** The author edits the surface: its own text changes first, then it reports, as Monaco does. */
  edit(from: number, to: number, inserted: string): void;
}

/** A surface that records what the view tells it and holds its text, standing in for Monaco. */
function spySurface(): Spy {
  const calls: string[] = [];
  let hostRef: TextSurfaceHost | null = null;
  let features: LanguageFeatures | null = null;
  let diagnostics: readonly SurfaceDiagnostic[] = [];
  let text = "";
  const surface: TextSurface = {
    setText: (value) => { text = value; calls.push(`setText:${JSON.stringify(value)}`); },
    getText: () => text,
    getSelection: () => ({ from: text.length, to: text.length }),
    select: (from, to) => { calls.push(`select:${from}-${to}`); },
    revealLine: (line) => { calls.push(`reveal:${line}`); },
    setReadOnly: () => undefined,
    setPreferences: () => undefined,
    setDiagnostics: (value) => { diagnostics = value; },
    setLanguage: (value) => { features = value; calls.push(value === null ? "language:off" : "language:on"); },
    focus: () => undefined,
    dispose: () => { calls.push("dispose"); },
  };
  return {
    factory: (_element, host) => {
      hostRef = host;
      text = host.text;
      return surface;
    },
    calls,
    host: () => hostRef!,
    features: () => features,
    diagnostics: () => diagnostics,
    text: () => text,
    edit: (from, to, inserted) => {
      text = text.slice(0, from) + inserted + text.slice(to);
      hostRef!.onChange([{ from, to, text: inserted }]);
    },
  };
}

function languageServer(symbols: readonly unknown[], seen: LanguageMessage[]): NonNullable<SetupOptions["onLanguageMessage"]> {
  return (message, session) => {
    seen.push(message);
    if (message.method === "initialize") session.push({ jsonrpc: "2.0", id: message.id as number, result: { capabilities: {} } });
    else if (message.method === "textDocument/documentSymbol") session.push({ jsonrpc: "2.0", id: message.id as number, result: symbols });
    else if (message.method === "textDocument/hover") session.push({ jsonrpc: "2.0", id: message.id as number, error: { code: -32603, message: "boom" } });
  };
}

test("with a language service the view opens the document on the server, sends every change, shows diagnostics and lists bookmarks", async () => {
  const seen: LanguageMessage[] = [];
  const symbols = [
    { name: "Setup", kind: 15, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } } },
    { name: "go", kind: 12, range: { start: { line: 2, character: 9 }, end: { line: 2, character: 11 } } },
  ];
  const s = await setup({ capabilities: ["folderWrite", "languageServer"], onLanguageMessage: languageServer(symbols, seen) });
  const spy = spySurface();
  show(s, { createSurface: spy.factory, project: { main: "Main/game.gam" } });
  await settled();
  deepEqual(s.host.languageSessions[0]!.options, { project: { main: "Main/game.gam" } });
  const opened = seen.find((message) => message.method === "textDocument/didOpen")!;
  deepEqual(opened.params, { textDocument: { uri: "file:///project/Prg/intro.prg", languageId: "rpgcode", version: 1, text: "x = 1\ny = 2\n" } });
  equal(seen.some((message) => message.method === "initialized"), true);
  equal(spy.features()?.uri, "file:///project/Prg/intro.prg");
  // Diagnostics for this document are shown, others are not.
  s.host.languageSessions[0]!.push({
    jsonrpc: "2.0", method: "textDocument/publishDiagnostics",
    params: { uri: "file:///project/Prg/other.prg", diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: "other" }] },
  });
  s.host.languageSessions[0]!.push({
    jsonrpc: "2.0", method: "textDocument/publishDiagnostics",
    params: { uri: "file:///project/Prg/intro.prg", diagnostics: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, severity: 1, message: "oops" }, { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 4, message: "hint" }] },
  });
  await settled();
  equal(spy.diagnostics().length, 2);
  match(stateOf(s.el), /1 problem/);
  // Bookmarks are the server's outline, in order; choosing one moves the cursor.
  await settled();
  const labels = [...s.el.querySelectorAll(".tkr-program-bookmarks button")].map((node) => node.textContent?.replace(/\s+/g, " ").trim());
  deepEqual(labels, ["Comment Setup line 1", "Function go line 3"]);
  await act(async () => { (s.el.querySelectorAll(".tkr-program-bookmarks button")[1] as HTMLButtonElement).click(); });
  ok(spy.calls.includes("reveal:2"));
  // A request the server answers with an error is an ordinary rejection a surface handles.
  const features = spy.features()!;
  await features.request("textDocument/hover", { position: { line: 0, character: 0 } }).then(
    () => ok(false, "should reject"),
    (error: unknown) => match(String(error), /boom/),
  );
});

test("a surface change reaches the server as full text with a rising version, then the document; closing the view closes the document", async () => {
  const seen: LanguageMessage[] = [];
  const s = await setup({ capabilities: ["folderWrite", "languageServer"], onLanguageMessage: languageServer([], seen) });
  const spy = spySurface();
  const handle = show(s, { createSurface: spy.factory });
  await settled();
  await act(() => {
    spy.edit(12, 12, "z");
  });
  const changes = seen.filter((message) => message.method === "textDocument/didChange");
  equal(changes.length, 1);
  deepEqual(changes[0]!.params, { textDocument: { uri: "file:///project/Prg/intro.prg", version: 2 }, contentChanges: [{ text: "x = 1\ny = 2\nz" }] });
  equal(textOf(s), "x = 1\ny = 2\n", "the document has not taken the burst yet");
  await act(() => s.pending.settle());
  equal(textOf(s), "x = 1\ny = 2\nz");
  equal(spy.calls.filter((call) => call.startsWith("setText")).length, 0, "the surface already held the text, so it is not rewritten");
  handle.dispose();
  await settled();
  ok(seen.some((message) => message.method === "textDocument/didClose"));
  equal(s.host.languageSessions[0]!.disposed(), false, "the shared client lingers for a moment so a tab switch does not restart it");
});

test("a server that cannot start leaves editing alone and the note says why", async () => {
  const s = await setup({ capabilities: ["folderWrite", "languageServer"] });
  s.host.failLanguage("the worker could not start");
  show(s);
  await settled();
  match(noteOf(s.el), /Language features are unavailable: the worker could not start/);
  await type(s.el, "x = 7\n");
  await act(() => s.pending.settle());
  equal(textOf(s), "x = 7\n");
});

test("a server that stops later clears the bookmarks and diagnostics and leaves editing alone", async () => {
  const seen: LanguageMessage[] = [];
  const symbols = [{ name: "Setup", kind: 15, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } } }];
  const s = await setup({ capabilities: ["folderWrite", "languageServer"], onLanguageMessage: languageServer(symbols, seen) });
  show(s);
  await settled();
  equal(s.el.querySelectorAll(".tkr-program-bookmarks button").length, 1);
  s.host.languageSessions[0]!.stop("The server crashed.");
  await settled();
  equal(s.el.querySelectorAll(".tkr-program-bookmarks button").length, 0);
  match(noteOf(s.el), /Language features stopped: The server crashed\./);
  await type(s.el, "x = 8\n");
  await act(() => s.pending.settle());
  equal(textOf(s), "x = 8\n");
});

test("a code editor that throws on start leaves a plain text area and the note says so", async () => {
  const s = await setup();
  show(s, { createSurface: () => { throw new Error("worker blocked"); } });
  ok(area(s.el) !== null);
  match(noteOf(s.el), /code editor could not start \(worker blocked\)/);
  await type(s.el, "x = 5\n");
  await act(() => s.pending.settle());
  equal(textOf(s), "x = 5\n");
});

test("disposing the view hands buffered typing to the document: closing a view never discards text", async () => {
  const s = await setup();
  const handle = show(s);
  await type(s.el, "x = 1\ny = 2\nlast\n");
  handle.dispose();
  await settled();
  equal(textOf(s), "x = 1\ny = 2\nlast\n");
});
