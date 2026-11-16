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
function deferred<T = void>(): { readonly promise: Promise<T>; readonly resolve: T extends void ? () => void : (value: T) => void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  const resolve = ((value?: T) => resolvePromise(value as T)) as T extends void ? () => void : (value: T) => void;
  return { promise, resolve };
}


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
  readonly document?: ProgramViewDocument;
  readonly element?: HTMLElement;
}

function show(s: Setup, options: Show = {}) {
  const view: ProgramViewDocument = options.document ?? (options.history === false
    ? { kind: s.doc.kind, identity: s.doc.identity, getSnapshot: () => s.doc.getSnapshot(), subscribe: (l) => s.doc.subscribe(l), apply: (c) => s.doc.apply(c), save: () => s.doc.save(), resolveConflict: (c) => s.doc.resolveConflict(c) }
    : { kind: s.doc.kind, identity: s.doc.identity, getSnapshot: () => s.doc.getSnapshot(), subscribe: (l) => s.doc.subscribe(l), apply: (c) => s.doc.apply(c), save: () => s.doc.save(), resolveConflict: (c) => s.doc.resolveConflict(c), undo: () => s.doc.undo(), redo: () => s.doc.redo() });
  let handle: ReturnType<Mount> | undefined;
  void act(() => {
    handle = mount(options.element ?? s.el, {
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

type DeferredVoid = { readonly promise: Promise<void>; readonly resolve: () => void };

interface SaveGate {
  readonly started: DeferredVoid;
  readonly release: DeferredVoid;
}

function saveGate(): SaveGate {
  return { started: deferred<void>(), release: deferred<void>() };
}

function gatedProgramView(s: Setup, gates: readonly SaveGate[]): ProgramViewDocument {
  let saveCalls = 0;
  return {
    kind: s.doc.kind,
    identity: s.doc.identity,
    getSnapshot: () => s.doc.getSnapshot(),
    subscribe: (listener) => s.doc.subscribe(listener),
    apply: (command) => s.doc.apply(command),
    save: async () => {
      const gate = gates[saveCalls++];
      const result = await s.doc.save();
      if (gate !== undefined) {
        gate.started.resolve();
        await gate.release.promise;
      }
      return result;
    },
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
    undo: () => s.doc.undo(),
    redo: () => s.doc.redo(),
  };
}

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

test("typing repeated text then deleting it after a queued undo does not resurrect the undone text", async () => {
  const s = await setup({ content: "" });
  const gate = deferred<void>();
  const started = deferred<void>();
  const view: ProgramViewDocument = {
    kind: s.doc.kind,
    identity: s.doc.identity,
    getSnapshot: () => s.doc.getSnapshot(),
    subscribe: (listener) => s.doc.subscribe(listener),
    apply: (command) => s.doc.apply(command),
    save: async () => {
      const result = await s.doc.save();
      started.resolve();
      await gate.promise;
      return result;
    },
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
    undo: () => s.doc.undo(),
    redo: () => s.doc.redo(),
  };
  show(s, { document: view });
  await type(s.el, "a");
  await act(async () => { named(s.el, "Save").click(); });
  await started.promise;
  await key(area(s.el), { key: "z", ctrlKey: true });
  await type(s.el, "aa");
  await type(s.el, "a");
  gate.resolve();
  await settled();
  equal(textOf(s), "", "the appended a and its deletion remain edits to the new empty text");
  equal(area(s.el).value, "");
});

test("queued undo preserves a sequential deletion after an earlier buffered edit", async () => {
  const s = await setup({ content: "x" });
  const gate = deferred<void>();
  const started = deferred<void>();
  const view: ProgramViewDocument = {
    kind: s.doc.kind,
    identity: s.doc.identity,
    getSnapshot: () => s.doc.getSnapshot(),
    subscribe: (listener) => s.doc.subscribe(listener),
    apply: (command) => s.doc.apply(command),
    save: async () => {
      const result = await s.doc.save();
      started.resolve();
      await gate.promise;
      return result;
    },
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
    undo: () => s.doc.undo(),
    redo: () => s.doc.redo(),
  };
  show(s, { document: view });
  await type(s.el, "xa");
  await act(async () => { named(s.el, "Save").click(); });
  await started.promise;
  await key(area(s.el), { key: "z", ctrlKey: true });
  await type(s.el, "bxa");
  await type(s.el, "ba");
  gate.resolve();
  await settled();
  equal(textOf(s), "b", "inserting b and then deleting x after undo must not leave x behind");
  equal(area(s.el).value, "b");
});


test("typing after a queued undo rebases onto the undone text instead of restoring it", async () => {
  const s = await setup({ content: "" });
  const gate = deferred<void>();
  const started = deferred<void>();
  const view: ProgramViewDocument = {
    kind: s.doc.kind,
    identity: s.doc.identity,
    getSnapshot: () => s.doc.getSnapshot(),
    subscribe: (listener) => s.doc.subscribe(listener),
    apply: (command) => s.doc.apply(command),
    save: async () => {
      const result = await s.doc.save();
      started.resolve();
      await gate.promise;
      return result;
    },
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
    undo: () => s.doc.undo(),
    redo: () => s.doc.redo(),
  };
  show(s, { document: view });
  await type(s.el, "a");
  await act(async () => { named(s.el, "Save").click(); });
  await started.promise;
  await key(area(s.el), { key: "z", ctrlKey: true });
  await type(s.el, "ab");
  gate.resolve();
  await settled();
  equal(textOf(s), "b", "only the insertion made after undo survives");
  equal(area(s.el).value, "b");
  deepEqual(s.host.bytesOf(PATH), bytes("a"), "the queued undo and later typing do not change the earlier save");
});

test("typing after a queued undo survives disposal without restoring undone text", async () => {
  const s = await setup({ content: "" });
  const gate = deferred<void>();
  const started = deferred<void>();
  const view: ProgramViewDocument = {
    kind: s.doc.kind,
    identity: s.doc.identity,
    getSnapshot: () => s.doc.getSnapshot(),
    subscribe: (listener) => s.doc.subscribe(listener),
    apply: (command) => s.doc.apply(command),
    save: async () => {
      const result = await s.doc.save();
      started.resolve();
      await gate.promise;
      return result;
    },
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
    undo: () => s.doc.undo(),
    redo: () => s.doc.redo(),
  };
  const handle = show(s, { document: view });
  await type(s.el, "a");
  await act(async () => { named(s.el, "Save").click(); });
  await started.promise;
  await key(area(s.el), { key: "z", ctrlKey: true });
  await type(s.el, "ab");
  handle.dispose();
  gate.resolve();
  await settled();
  equal(textOf(s), "b", "closing the surface does not lose input queued behind undo or bring back the undone insertion");
  deepEqual(s.host.bytesOf(PATH), bytes("a"), "disposal does not change what the earlier save wrote");
});

test("an insertion at the undo anchor can be deleted without leaving it behind", async () => {
  const s = await setup({ content: "x" });
  const gate = deferred<void>();
  const started = deferred<void>();
  const view: ProgramViewDocument = {
    kind: s.doc.kind,
    identity: s.doc.identity,
    getSnapshot: () => s.doc.getSnapshot(),
    subscribe: (listener) => s.doc.subscribe(listener),
    apply: (command) => s.doc.apply(command),
    save: async () => {
      const result = await s.doc.save();
      started.resolve();
      await gate.promise;
      return result;
    },
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
    undo: () => s.doc.undo(),
    redo: () => s.doc.redo(),
  };
  show(s, { document: view });
  await type(s.el, "xa");
  await act(async () => { named(s.el, "Save").click(); });
  await started.promise;
  await key(area(s.el), { key: "z", ctrlKey: true });
  await type(s.el, "xba");
  await type(s.el, "xa");
  gate.resolve();
  await settled();
  equal(textOf(s), "x", "inserting b at the deleted text's start and deleting it leaves the original x");
  equal(area(s.el).value, "x");
});

test("a queued undo followed by Save synchronizes the surface even with no later typing", async () => {
  const s = await setup({ content: "" });
  const gate = deferred<void>();
  const started = deferred<void>();
  const view: ProgramViewDocument = {
    kind: s.doc.kind,
    identity: s.doc.identity,
    getSnapshot: () => s.doc.getSnapshot(),
    subscribe: (listener) => s.doc.subscribe(listener),
    apply: (command) => s.doc.apply(command),
    save: async () => {
      const result = await s.doc.save();
      started.resolve();
      await gate.promise;
      return result;
    },
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
    undo: () => s.doc.undo(),
    redo: () => s.doc.redo(),
  };
  show(s, { document: view });
  await type(s.el, "a");
  await act(async () => { named(s.el, "Save").click(); });
  await started.promise;
  await key(area(s.el), { key: "z", ctrlKey: true });
  await act(async () => { named(s.el, "Save").click(); });
  gate.resolve();
  await settled();
  equal(textOf(s), "");
  equal(area(s.el).value, "", "the visible surface follows the undo after the queued Save completes");
  deepEqual(s.host.bytesOf(PATH), bytes(""), "the queued Save writes the empty document");
});


test("typing after a queued undo and Save is rebased from the saved prefix", async () => {
  const s = await setup({ content: "" });
  const firstGate = deferred<void>();
  const firstStarted = deferred<void>();
  const secondStarted = deferred<void>();
  let saveCalls = 0;
  const view: ProgramViewDocument = {
    kind: s.doc.kind,
    identity: s.doc.identity,
    getSnapshot: () => s.doc.getSnapshot(),
    subscribe: (listener) => s.doc.subscribe(listener),
    apply: (command) => s.doc.apply(command),
    save: async () => {
      saveCalls += 1;
      const result = await s.doc.save();
      if (saveCalls === 1) {
        firstStarted.resolve();
        await firstGate.promise;
      } else {
        secondStarted.resolve();
      }
      return result;
    },
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
    undo: () => s.doc.undo(),
    redo: () => s.doc.redo(),
  };
  show(s, { document: view });
  await type(s.el, "a");
  await act(async () => { named(s.el, "Save").click(); });
  await firstStarted.promise;
  await key(area(s.el), { key: "z", ctrlKey: true });
  await type(s.el, "ab");
  await act(async () => { named(s.el, "Save").click(); });
  await type(s.el, "abc");
  firstGate.resolve();
  await secondStarted.promise;
  await settled();
  deepEqual(s.host.bytesOf(PATH), bytes("b"), "the queued save writes the typing that preceded its request");
  equal(textOf(s), "bc", "typing after the queued Save is rebased onto the saved b in the document");
  equal(area(s.el).value, "bc", "typing after the save request stays visible in the surface");
});

test("queued undo and insertion preserve untouched mixed line endings", async () => {
  const s = await setup({ content: "one\r\ntwo\nthree\r\n" });
  const gate = deferred<void>();
  const started = deferred<void>();
  const view: ProgramViewDocument = {
    kind: s.doc.kind,
    identity: s.doc.identity,
    getSnapshot: () => s.doc.getSnapshot(),
    subscribe: (listener) => s.doc.subscribe(listener),
    apply: (command) => s.doc.apply(command),
    save: async () => {
      const result = await s.doc.save();
      started.resolve();
      await gate.promise;
      return result;
    },
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
    undo: () => s.doc.undo(),
    redo: () => s.doc.redo(),
  };
  show(s, { document: view });
  await type(s.el, "one\ntwo!\nthree\n");
  await act(async () => { named(s.el, "Save").click(); });
  await started.promise;
  await key(area(s.el), { key: "z", ctrlKey: true });
  await type(s.el, "one\ntwo!x\nthree\n");
  gate.resolve();
  await settled();
  equal(textOf(s), "one\ntwox\nthree\n");
  await act(async () => { named(s.el, "Save").click(); });
  await settled();
  deepEqual(s.host.bytesOf(PATH), bytes("one\r\ntwox\nthree\r\n"));
});

test("#2760 typing cannot flush and be rejected while a queued Save is pending", async () => {
  const s = await setup({ content: "" });
  const first = saveGate();
  const second = saveGate();
  show(s, { document: gatedProgramView(s, [first, second]) });
  await type(s.el, "a");
  await act(() => { named(s.el, "Save").click(); });
  await first.started.promise;
  await key(area(s.el), { key: "z", ctrlKey: true });
  await act(() => { named(s.el, "Save").click(); });

  first.release.resolve();
  await second.started.promise;
  await type(s.el, "ab");
  await act(() => { area(s.el).blur(); });
  await settled();
  equal(textOf(s), "", "typing stays buffered while the queued save owns its revision");
  equal(area(s.el).value, "ab");

  second.release.resolve();
  await settled();
  equal(textOf(s), "b", "the insertion survives after the stale leading a is undone");
  equal(area(s.el).value, "b");
});

test("#2761 queued saves each write the revision captured at their request", async () => {
  const s = await setup({ content: "" });
  const first = saveGate();
  const second = saveGate();
  const third = saveGate();
  show(s, { document: gatedProgramView(s, [first, second, third]) });
  await type(s.el, "a");
  await act(() => { named(s.el, "Save").click(); });
  await first.started.promise;
  deepEqual(s.host.bytesOf(PATH), bytes("a"), "Save 1 writes the original revision");
  await key(area(s.el), { key: "z", ctrlKey: true });
  await type(s.el, "ab");
  await act(() => { named(s.el, "Save").click(); });
  await type(s.el, "abc");
  await act(() => { named(s.el, "Save").click(); });

  first.release.resolve();
  await second.started.promise;
  deepEqual(s.host.bytesOf(PATH), bytes("b"), "Save 2 owns b, not later typing");
  second.release.resolve();
  await third.started.promise;
  deepEqual(s.host.bytesOf(PATH), bytes("bc"), "Save 3 includes c typed after Save 2");
  third.release.resolve();
  await settled();
  equal(textOf(s), "bc");
  deepEqual(s.host.bytesOf(PATH), bytes("bc"));
});

test("#2762 deleting repeated text after the queued save keeps the live document dirty", async () => {
  const s = await setup({ content: "" });
  const first = saveGate();
  const second = saveGate();
  show(s, { document: gatedProgramView(s, [first, second]) });
  await type(s.el, "a");
  await act(() => { named(s.el, "Save").click(); });
  await first.started.promise;
  await key(area(s.el), { key: "z", ctrlKey: true });
  await type(s.el, "aa");
  await act(() => { named(s.el, "Save").click(); });

  first.release.resolve();
  await second.started.promise;
  deepEqual(s.host.bytesOf(PATH), bytes("a"), "Save 2 writes the newly appended a");
  await type(s.el, "a");
  second.release.resolve();
  await settled();
  equal(textOf(s), "", "backspace removes the new a rather than preserving the repeated old a");
  equal(area(s.el).value, "");
  match(stateOf(s.el), /Unsaved/);
  deepEqual(s.host.bytesOf(PATH), bytes("a"), "the earlier saved a remains on disk");
});

test("#2763 inserting and deleting inside an undone span does not resurrect the inserted character", async () => {
  const s = await setup({ content: "x" });
  const first = saveGate();
  show(s, { document: gatedProgramView(s, [first]) });
  await type(s.el, "xab");
  await act(() => { named(s.el, "Save").click(); });
  await first.started.promise;
  deepEqual(s.host.bytesOf(PATH), bytes("xab"));
  await key(area(s.el), { key: "z", ctrlKey: true });
  await type(s.el, "xacb");
  await type(s.el, "xab");

  first.release.resolve();
  await settled();
  equal(textOf(s), "x");
  equal(area(s.el).value, "x");
});

test("#2764 typing after queued Undo and Redo does not invalidate Redo", async () => {
  const s = await setup({ content: "x" });
  const first = saveGate();
  show(s, { document: gatedProgramView(s, [first]) });
  await type(s.el, "xa");
  await act(() => { named(s.el, "Save").click(); });
  await first.started.promise;
  await key(area(s.el), { key: "z", ctrlKey: true });
  await key(area(s.el), { key: "z", ctrlKey: true, shiftKey: true });
  await type(s.el, "xab");

  first.release.resolve();
  await settled();
  equal(textOf(s), "xab");
  equal(area(s.el).value, "xab");
});

test("#2765 multi-cursor undo preserves typing after the untouched middle line and mixed endings", async () => {
  const s = await setup({ content: "first\r\nmiddle\nthird\r\n" });
  const spy = spySurface();
  show(s, { createSurface: spy.factory });
  await act(() => {
    spy.editMany([
      { from: 0, to: 5, text: "FIRST" },
      { from: 13, to: 18, text: "THIRD" },
    ]);
  });
  await act(() => {
    ok(spy.host().onUndo(), "the document accepts Undo");
    spy.edit(12, 12, "!");
  });

  await settled();
  equal(textOf(s), "first\nmiddle!\nthird\n");
  equal(spy.text(), "first\nmiddle!\nthird\n");
  await act(async () => { await named(s.el, "Save").click(); });
  await settled();
  deepEqual(s.host.bytesOf(PATH), bytes("first\r\nmiddle!\nthird\r\n"));
});

test("a second Save writes the revision that existed when it was invoked", async () => {
  const s = await setup({ content: "" });
  const firstGate = deferred<void>();
  const firstStarted = deferred<void>();
  const secondStarted = deferred<void>();
  let saveCalls = 0;
  const view: ProgramViewDocument = {
    kind: s.doc.kind,
    identity: s.doc.identity,
    getSnapshot: () => s.doc.getSnapshot(),
    subscribe: (listener) => s.doc.subscribe(listener),
    apply: (command) => s.doc.apply(command),
    save: async () => {
      saveCalls += 1;
      const result = await s.doc.save();
      if (saveCalls === 1) {
        firstStarted.resolve();
        await firstGate.promise;
      } else if (saveCalls === 2) {
        secondStarted.resolve();
      }
      return result;
    },
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
    undo: () => s.doc.undo(),
    redo: () => s.doc.redo(),
  };
  show(s, { document: view });
  await type(s.el, "first");
  await act(async () => { named(s.el, "Save").click(); });
  await firstStarted.promise;
  await type(s.el, "second");
  await act(async () => { named(s.el, "Save").click(); });
  await type(s.el, "third");
  await act(() => { area(s.el).dispatchEvent(new Event("blur")); });
  await settled();
  firstGate.resolve();
  await secondStarted.promise;
  await settled();
  deepEqual(s.host.bytesOf(PATH), bytes("second"));
  equal(textOf(s), "third");
  equal(s.doc.getSnapshot().dirty, true, "typing after the second Save remains unsaved");
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

test("quick reference opens on search, closes to its toggle, and insertion returns focus to the program", async () => {
  const s = await setup({ content: "before\n" });
  show(s);
  const toggle = named(s.el, "Command reference");
  s.el.querySelector<HTMLButtonElement>(".tkr-program-reference button")!.click();
  await settled();
  toggle.click();
  await settled();
  const search = s.el.querySelector<HTMLInputElement>(".tkr-program-reference input[type=search]")!;
  equal(document.activeElement, search);
  await act(() => {
    search.value = "mwin";
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const row = [...s.el.querySelectorAll<HTMLButtonElement>(".tkr-program-reference-list button")].find((item) => /^mwin\(/i.test(item.textContent ?? ""))!;
  row.click();
  await settled();
  const insert = named(s.el, "Insert mwin");
  insert.click();
  await settled();
  equal(document.activeElement, area(s.el));
  match(textOf(s), /mwin\(/);
  const close = s.el.querySelector<HTMLButtonElement>(".tkr-program-reference button")!;
  close.click();
  await settled();
  equal(document.activeElement, toggle);
});
test("command insertion still reaches the document when its tab is disposed before the queued command runs", async () => {
  const s = await setup({ content: "before\n" });
  const gate = deferred<void>();
  const entered = deferred<void>();
  const view: ProgramViewDocument = {
    kind: s.doc.kind,
    identity: s.doc.identity,
    getSnapshot: () => s.doc.getSnapshot(),
    subscribe: (listener) => s.doc.subscribe(listener),
    apply: async (command) => {
      entered.resolve();
      await gate.promise;
      return s.doc.apply(command);
    },
    save: () => s.doc.save(),
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
    undo: () => s.doc.undo(),
    redo: () => s.doc.redo(),
  };
  const handle = show(s, { document: view });
  const search = s.el.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(() => {
    search.value = "mwin";
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const target = [...s.el.querySelectorAll(".tkr-program-reference-list button")].find((row) => /^mwin\(/i.test(row.textContent ?? ""))!;
  area(s.el).setSelectionRange(0, 6);
  await act(() => { target.dispatchEvent(new Event("dblclick", { bubbles: true })); });
  await entered.promise;
  handle.dispose();
  gate.resolve();
  await settled();
  match(textOf(s), /^mwin\(.*\)\n$/i);
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
  editMany(changes: readonly { readonly from: number; readonly to: number; readonly text: string }[]): void;
}

/** A surface that records what the view tells it and holds its text, standing in for Monaco. */
function spySurface(): Spy {
  const calls: string[] = [];
  let hostRef: TextSurfaceHost | null = null;
  let features: LanguageFeatures | null = null;
  let diagnostics: readonly SurfaceDiagnostic[] = [];
  let text = "";
  const editMany = (changes: readonly { readonly from: number; readonly to: number; readonly text: string }[]): void => {
    for (const change of changes) text = text.slice(0, change.from) + change.text + text.slice(change.to);
    hostRef!.onChange(changes);
  };
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
    edit: (from, to, inserted) => editMany([{ from, to, text: inserted }]),
    editMany,
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

test("LSP request errors are announced as status and do not stop editing", async () => {
  const s = await setup({
    capabilities: ["folderWrite", "languageServer"],
    onLanguageMessage: (message, session) => {
      if (message.method === "initialize") session.push({ jsonrpc: "2.0", id: message.id as number, result: { capabilities: {} } });
      else if (message.method === "textDocument/documentSymbol") session.push({ jsonrpc: "2.0", id: message.id as number, result: [] });
      else if (message.method === "textDocument/hover") session.push({ jsonrpc: "2.0", id: message.id as number, error: { code: -32603, message: "hover failed" } });
    },
  });
  const spy = spySurface();
  show(s, { createSurface: spy.factory });
  await settled();
  await spy.features()!.request("textDocument/hover", { position: { line: 0, character: 0 } }).then(
    () => ok(false, "the rejected request should stay rejected"),
    (error: unknown) => match(String(error), /hover failed/),
  );
  await settled();
  equal(s.el.querySelector(".tkr-program-language-note[role=status]")?.textContent?.trim(), "Language request textDocument/hover failed: hover failed");
  spy.edit(0, 0, "z");
  await act(() => s.pending.settle());
  equal(textOf(s), "zx = 1\ny = 2\n");
});

test("formatting showMessage refusals are shown only during an unambiguous formatting request", async () => {
  const s = await setup({
    capabilities: ["folderWrite", "languageServer"],
    onLanguageMessage: (message, session) => {
      if (message.method === "initialize") session.push({ jsonrpc: "2.0", id: message.id as number, result: { capabilities: {} } });
      else if (message.method === "textDocument/documentSymbol") session.push({ jsonrpc: "2.0", id: message.id as number, result: [] });
      else if (message.method === "textDocument/formatting") {
        session.push({ jsonrpc: "2.0", method: "window/showMessage", params: { type: 2, message: "Formatting is not available." } });
        session.push({ jsonrpc: "2.0", id: message.id as number, result: null });
      }
    },
  });
  const spy = spySurface();
  show(s, { createSurface: spy.factory });
  await settled();
  s.host.languageSessions[0]!.push({
    jsonrpc: "2.0", method: "window/showMessage", params: { type: 2, message: "Unrelated server message." },
  });
  await settled();
  equal(noteOf(s.el).trim(), "");
  await spy.features()!.request("textDocument/formatting", {});
  await settled();
  equal(s.el.querySelector(".tkr-program-language-note[role=status]")?.textContent?.trim(), "Formatting is not available.");
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

test("views of the same language document share didOpen and only the last view sends didClose", async () => {
  const seen: LanguageMessage[] = [];
  const s = await setup({ capabilities: ["folderWrite", "languageServer"], onLanguageMessage: languageServer([], seen) });
  const first = show(s, { createSurface: spySurface().factory });
  await settled();
  const secondElement = document.createElement("div");
  document.body.append(secondElement);
  const second = show(s, { createSurface: spySurface().factory, element: secondElement });
  await settled();
  equal(seen.filter((message) => message.method === "textDocument/didOpen").length, 1);
  first.dispose();
  await settled();
  equal(seen.filter((message) => message.method === "textDocument/didClose").length, 0);
  second.dispose();
  await settled();
  equal(seen.filter((message) => message.method === "textDocument/didClose").length, 1);
});

test("typing in either shared view refreshes bookmarks in both views", async (t) => {
  let currentText = "x = 1\ny = 2\n";
  const s = await setup({
    capabilities: ["folderWrite", "languageServer"],
    onLanguageMessage: (message, session) => {
      if (message.method === "initialize") {
        session.push({ jsonrpc: "2.0", id: message.id as number, result: { capabilities: {} } });
      } else if (message.method === "textDocument/didChange") {
        const params = message.params;
        if (params !== null && typeof params === "object" && "contentChanges" in params) {
          const changes = params.contentChanges;
          if (Array.isArray(changes)) {
            const change = changes[0];
            if (change !== undefined && typeof change === "object" && change !== null && "text" in change && typeof change.text === "string") {
              currentText = change.text;
            }
          }
        }
      } else if (message.method === "textDocument/documentSymbol") {
        const name = currentText === "first edit" ? "First" : currentText === "second edit" ? "Second" : "Initial";
        session.push({
          jsonrpc: "2.0",
          id: message.id as number,
          result: [{ name, kind: 12, range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } } }],
        });
      }
    },
  });
  const firstSpy = spySurface();
  const first = show(s, { createSurface: firstSpy.factory });
  await settled();
  const secondElement = document.createElement("div");
  document.body.append(secondElement);
  const secondSpy = spySurface();
  const second = show(s, { createSurface: secondSpy.factory, element: secondElement });
  await settled();
  const names = (element: HTMLElement): string[] => [...element.querySelectorAll(".tkr-program-bookmarks button")].map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "");
  deepEqual(names(s.el), ["Function Initial line 1"]);
  deepEqual(names(secondElement), ["Function Initial line 1"]);

  const timers = t.mock.timers;
  const editAndRefresh = async (spy: Spy, text: string): Promise<void> => {
    timers.enable({ apis: ["setTimeout"] });
    try {
      spy.edit(0, spy.text().length, text);
      await act(() => s.pending.settle());
      timers.tick(300);
    } finally {
      timers.reset();
    }
    await settled();
  };
  await editAndRefresh(firstSpy, "first edit");
  deepEqual(names(s.el), ["Function First line 1"]);
  deepEqual(names(secondElement), ["Function First line 1"]);
  await editAndRefresh(secondSpy, "second edit");
  deepEqual(names(s.el), ["Function Second line 1"]);
  deepEqual(names(secondElement), ["Function Second line 1"]);
  first.dispose();
  second.dispose();
  await settled();
});


test("a failed bookmark request clears the outline and announces its error as status", async () => {
  const s = await setup({
    capabilities: ["folderWrite", "languageServer"],
    onLanguageMessage: (message, session) => {
      if (message.method === "initialize") session.push({ jsonrpc: "2.0", id: message.id as number, result: { capabilities: {} } });
      else if (message.method === "textDocument/documentSymbol") session.push({ jsonrpc: "2.0", id: message.id as number, error: { code: -32603, message: "outline failed" } });
    },
  });
  show(s);
  await settled();
  equal(s.el.querySelectorAll(".tkr-program-bookmarks button").length, 0);
  equal(s.el.querySelector(".tkr-program-language-note[role=status]")?.textContent?.trim(), "Language request textDocument/documentSymbol failed: outline failed");
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

test("#2768 a net-zero burst preserves the identity used by the next replacement", async () => {
  const s = await setup({ content: "x" });
  const handle = show(s);
  await type(s.el, "y");
  await type(s.el, "x");
  await act(() => s.pending.settle());
  await type(s.el, "z");
  await act(() => s.pending.settle());
  equal(textOf(s), "z");
  handle.dispose();
});

for (const [original, edited, replacement] of [["x", "xa", "xb"], ["x", "ax", "bx"], ["x\r\ny\nz\r", "ax\ny\nz\n", "bx\ny\nz\n"]]) {
  test(`#2769 queued Undo/Redo preserves replacement ${JSON.stringify(edited)}`, async () => {
    const s = await setup({ content: original! });
    const first = saveGate();
    const handle = show(s, { document: gatedProgramView(s, [first]) });
    await type(s.el, edited!);
    await act(() => { named(s.el, "Save").click(); });
    await first.started.promise;
    await key(area(s.el), { key: "z", ctrlKey: true });
    await key(area(s.el), { key: "z", ctrlKey: true, shiftKey: true });
    await type(s.el, replacement!);
    first.release.resolve();
    await act(() => s.pending.settle());
    equal(textOf(s), replacement);
    await s.doc.save();
    const expected = original!.includes("\r") ? "bx\r\ny\nz\r" : replacement!;
    deepEqual(s.host.bytesOf(PATH), bytes(expected));
    handle.dispose();
  });
}

test("#2769 Redo after a net-zero queued Save preserves the newer unchanged identities", async () => {
  const s = await setup({ content: "x" });
  const first = saveGate();
  const handle = show(s, { document: gatedProgramView(s, [first]) });
  await type(s.el, "xa");
  await act(() => { named(s.el, "Save").click(); });
  await first.started.promise;
  await key(area(s.el), { key: "z", ctrlKey: true });
  await type(s.el, "y");
  await type(s.el, "x");
  await act(() => { named(s.el, "Save").click(); });
  await key(area(s.el), { key: "z", ctrlKey: true, shiftKey: true });
  await type(s.el, "z");
  first.release.resolve();
  await act(() => s.pending.settle());
  equal(textOf(s), "za");
  deepEqual(s.host.bytesOf(PATH), bytes("x"));
  handle.dispose();
});
