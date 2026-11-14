// The settings view of ADR 0025 over the real model and the in-memory platform-services double, rendered under the
// DOM shim of the toolchain (`@happy-dom/global-registrator`, dev-only). Assertions are on the DOM and on bytes, not on
// Preact internals.
import { after, before, test } from "node:test";
import { deepEqual, equal, match, notEqual, ok } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  createDocumentIdentity,
  openMainDocument,
  type MainDocument,
  type MainDocumentSnapshot,
  type SaveFailure,
  type ApplyResult,
} from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { Capability } from "@tk-reawakened/platform-services";
import type { ViewDocument } from "../src/mount.ts";
import { exampleMain, exampleTextMain, titleOf, withTitle } from "./fixtures.ts";

const PATH = "Main/example.gam";
const identity = createDocumentIdentity("memory-project", PATH);

type Mount = typeof import("../src/index.ts").mount;
let mount: Mount;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  // Preact reads the DOM when it renders, so it is imported once the shim is in place.
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

interface Setup {
  readonly host: MemoryPlatformServices;
  readonly doc: MainDocument;
  readonly el: HTMLElement;
}

async function setup(bytes: Uint8Array = exampleMain(9), capabilities?: readonly Capability[]): Promise<Setup> {
  const host = createMemoryPlatformServices(capabilities === undefined ? { files: { [PATH]: bytes } } : { files: { [PATH]: bytes }, capabilities });
  const opened = await openMainDocument(host.fs, identity);
  if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened.error)}`);
  const el = document.createElement("div");
  document.body.append(el);
  return { host, doc: opened.document, el };
}

function show(s: Setup) {
  let handle: ReturnType<Mount> | undefined;
  void act(() => {
    handle = mount(s.el, { document: s.doc, services: s.host });
  });
  if (handle === undefined) throw new Error("mount returned nothing");
  return handle;
}

const input = (el: HTMLElement): HTMLInputElement => {
  const found = el.querySelector("input");
  if (found === null) throw new Error("no <input>");
  return found;
};
const button = (el: HTMLElement): HTMLButtonElement => {
  const found = el.querySelector("button");
  if (found === null) throw new Error("no <button>");
  return found;
};
const alerts = (el: HTMLElement): string[] => [...el.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");
const status = (el: HTMLElement): string => el.querySelector('[role="status"]')?.textContent ?? "";

/** Type a title and explicitly apply it as one staged edit. */
async function type(el: HTMLElement, text: string): Promise<void> {
  const field = input(el);
  await act(() => {
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const apply = el.querySelector<HTMLButtonElement>(".tkr-settings-apply");
  if (apply !== null && !apply.disabled) {
    await act(async () => {
      apply.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

test("the view shows the title, a labelled field, a clean state and a disabled Save", async () => {
  const s = await setup();
  show(s);
  const field = input(s.el);
  equal(field.value, "Example Game");
  const label = s.el.querySelector("label");
  equal(label?.textContent, "Game title");
  equal(label?.getAttribute("for"), field.id, "the label names the field");
  equal(status(s.el), "All changes saved");
  equal(button(s.el).disabled, true);
  deepEqual(alerts(s.el), []);
});

test("typing a title edits the document, marks it unsaved and tells the host about the edit", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "Renamed Quest");
  equal(s.doc.getSnapshot().gameTitle, "Renamed Quest");
  equal(s.doc.getSnapshot().dirty, true);
  equal(status(s.el), "Unsaved changes");
  equal(button(s.el).disabled, false);
  const [event, ...rest] = s.host.editedEvents;
  equal(rest.length, 0, "one command, one document.edited message");
  equal(event?.document, identity.key);
  equal(event?.editId, "edit-1");
  equal(event?.label, "Change game title");
  equal(input(s.el).value, "Renamed Quest");
});

test("Save writes the document's bytes through the host and returns to a clean state", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "Renamed Quest");
  await act(async () => {
    button(s.el).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  deepEqual(s.host.bytesOf(PATH), withTitle(exampleMain(9), "Renamed Quest"));
  equal(status(s.el), "All changes saved");
  equal(button(s.el).disabled, true);
});

test("a failed save keeps the edit visible, keeps the document dirty and shows an error that names the document (ADR 0022 D3.3)", async () => {
  const original = exampleMain(9);
  const s = await setup(original);
  show(s);
  await type(s.el, "Renamed Quest");
  s.host.failWrites({ code: "permission-denied", message: "the folder is read-only" });
  await act(async () => {
    button(s.el).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const shown = alerts(s.el);
  equal(shown.length, 1);
  ok(shown[0]?.includes(PATH), `the error names the document: ${shown[0]}`);
  ok(shown[0]?.includes("the folder is read-only"), shown[0]);
  equal(input(s.el).value, "Renamed Quest", "the edit is still on screen");
  equal(status(s.el), "Unsaved changes");
  equal(button(s.el).disabled, false, "Save can be tried again");
  equal(s.doc.getSnapshot().dirty, true);
  deepEqual(s.host.bytesOf(PATH), original, "nothing was written");

  s.host.failWrites(null);
  await act(async () => {
    button(s.el).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  deepEqual(alerts(s.el), [], "the error goes away once a save succeeds");
  equal(status(s.el), "All changes saved");
  equal(titleOf(s.host.bytesOf(PATH) ?? new Uint8Array(0)), "Renamed Quest");
});

test("a title the file cannot hold is refused whole and the reason is shown beside the field", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "日本語");
  equal(s.doc.getSnapshot().gameTitle, "Example Game", "the document did not change");
  equal(s.doc.getSnapshot().dirty, false);
  equal(s.host.editedEvents.length, 0, "no document.edited for a refused command");
  match(s.el.textContent ?? "", /Game title: character U\+65E5/);
  equal(s.el.querySelector<HTMLButtonElement>(".tkr-settings-apply")?.disabled, true);
  equal(input(s.el).getAttribute("aria-invalid"), "true");
});

test("an undo from the host replaces the field's text with the document's", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "One");
  await act(() => {
    s.doc.undo();
  });
  equal(input(s.el).value, "Example Game");
  equal(status(s.el), "All changes saved");
});

test("a read-only document shows its reason and offers no editing and no Save", async () => {
  const s = await setup(exampleTextMain());
  show(s);
  equal(input(s.el).disabled, true);
  equal(button(s.el).disabled, true);
  const note = s.el.querySelector('[role="note"]');
  match(note?.textContent ?? "", /Read only/);
  equal(input(s.el).value, "Example Game");
});

test("disposing the view removes its listener and its DOM and leaves the document and its undo stack as they were (ADR 0022 D3.7)", async () => {
  const s = await setup();
  // A document that counts the listeners the view adds and removes.
  let live = 0;
  const counted: MainDocument = {
    identity: s.doc.identity,
    kind: s.doc.kind,
    getSnapshot: () => s.doc.getSnapshot(),
    serialize: () => s.doc.serialize(),
    subscribe: (listener) => {
      live += 1;
      const stop = s.doc.subscribe(listener);
      let stopped = false;
      return () => {
        if (!stopped) live -= 1;
        stopped = true;
        stop();
      };
    },
    apply: (command) => s.doc.apply(command),
    undo: (editId) => s.doc.undo(editId),
    redo: (editId) => s.doc.redo(editId),
    save: () => s.doc.save(),
    checkExternal: () => s.doc.checkExternal(),
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
    revert: () => s.doc.revert(),
    saveAs: (storage, target) => s.doc.saveAs(storage, target),
  };
  let handle: ReturnType<Mount> | undefined;
  await act(() => {
    handle = mount(s.el, { document: counted, services: s.host });
  });
  equal(live, 1, "the view subscribed once");
  await type(s.el, "Edited in the view");

  await act(() => {
    handle?.dispose();
  });
  equal(live, 0, "dispose removed the listener");
  equal(s.el.childElementCount, 0, "dispose removed the view");

  // The document is untouched by the disposal: still dirty, edit kept, undo works, and changing it updates no stale view.
  equal(s.doc.getSnapshot().gameTitle, "Edited in the view");
  equal(s.doc.getSnapshot().dirty, true);
  equal(s.doc.getSnapshot().canUndo, true);
  await act(() => {
    s.doc.undo();
  });
  equal(s.doc.getSnapshot().gameTitle, "Example Game");
  equal(s.el.childElementCount, 0, "a disposed view does not come back");
  await act(() => {
    handle?.dispose();
  });
  equal(live, 0, "disposing twice is harmless");
});

test("the rendered view carries no style attribute and no inline handler attribute (strict CSP, ADR 0025 decision 6)", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "x");
  s.host.failWrites({ code: "io-error", message: "disk full" });
  await act(async () => {
    button(s.el).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  equal(alerts(s.el).length, 1, "the error state is part of what is checked");
  const all = [s.el, ...s.el.querySelectorAll("*")];
  for (const node of all) {
    for (const name of node.getAttributeNames()) {
      notEqual(name, "style", `<${node.tagName.toLowerCase()}> has a style attribute`);
      ok(!name.startsWith("on"), `<${node.tagName.toLowerCase()}> has the handler attribute ${name}`);
    }
  }
});

/** Every complaint about the `.ts` and `.tsx` files under `dir`, in any subfolder (ADR 0025 decision 6). */
function cspViolations(dir: string): { readonly files: number; readonly problems: string[] } {
  const names = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((name) => /\.(?:ts|tsx)$/.test(name));
  const problems: string[] = [];
  for (const name of names) {
    const text = readFileSync(join(dir, name), "utf8");
    if (/\bstyle\s*=/.test(text)) problems.push(`${name} sets a style attribute`);
    if (/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|setAttribute\(\s*["']style/.test(text)) problems.push(`${name} writes raw markup`);
    if (/<style[\s>]/.test(text)) problems.push(`${name} injects a <style> element`);
  }
  return { files: names.length, problems };
}

test("no source file of the package writes a style attribute or raw HTML into the page", () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const found = cspViolations(src);
  ok(found.files >= 3, "the scan sees the package's sources");
  deepEqual(found.problems, []);
});

test("the source scan looks inside subfolders", () => {
  const dir = mkdtempSync(join(tmpdir(), "csp-scan-"));
  try {
    mkdirSync(join(dir, "deep", "deeper"), { recursive: true });
    writeFileSync(join(dir, "top.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "deep", "deeper", "view.tsx"), 'export const V = () => <p style="color:red">x</p>;\n');
    const found = cspViolations(dir);
    equal(found.files, 2);
    equal(found.problems.length, 1, JSON.stringify(found));
    match(found.problems[0] ?? "", /view\.tsx sets a style attribute/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Click Save and let the save finish. */
async function save(s: Setup): Promise<void> {
  await act(async () => {
    button(s.el).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("two mounted views have distinct ids, and each label and description points into its own view (defect 3)", async () => {
  const first = await setup();
  const second = await setup();
  show(first);
  show(second);
  const ids = [first.el, second.el].flatMap((el) => [...el.querySelectorAll("[id]")].map((node) => node.id));
  ok(ids.length > 4, "every settings field has its own id");
  equal(new Set(ids).size, ids.length, `no id is used twice: ${ids.join(", ")}`);
  for (const view of [first, second]) {
    const field = input(view.el);
    const label = view.el.querySelector("label");
    equal(label?.getAttribute("for"), field.id, "the label names its own field");
    equal(document.getElementById(field.id), field, "and the page resolves that id to this field");
    const own = view.el.querySelector("section");
    const references = [
      ...[...view.el.querySelectorAll("label[for]")].map((node) => node.getAttribute("for") ?? ""),
      ...[...view.el.querySelectorAll("[aria-describedby]")].flatMap((node) => (node.getAttribute("aria-describedby") ?? "").split(" ")),
    ];
    for (const id of references) {
      equal(document.getElementById(id)?.closest("section"), own, `${id} is inside its own view`);
    }
  }
});

test("Save persists only applied title edits, and Cancel leaves the document and file unchanged", async () => {
  const s = await setup();
  show(s);
  await act(() => {
    input(s.el).value = "Typed, never applied";
    input(s.el).dispatchEvent(new Event("input", { bubbles: true }));
  });
  equal(s.doc.getSnapshot().gameTitle, "Example Game");
  equal(button(s.el).disabled, true, "a draft alone cannot be saved");
  await act(() => s.el.querySelector<HTMLButtonElement>(".tkr-settings-discard")!.click());
  equal(input(s.el).value, "Example Game");
  equal(s.host.editedEvents.length, 0);
  deepEqual(s.host.bytesOf(PATH), exampleMain(9));
});

test("Enter and blur do not apply the title; Apply creates the edit", async () => {
  const s = await setup();
  show(s);
  await act(() => {
    input(s.el).value = "Entered";
    input(s.el).dispatchEvent(new Event("input", { bubbles: true }));
    input(s.el).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input(s.el).dispatchEvent(new Event("change", { bubbles: true }));
  });
  equal(s.doc.getSnapshot().gameTitle, "Example Game");
  equal(s.host.editedEvents.length, 0);
  await act(async () => {
    s.el.querySelector<HTMLButtonElement>(".tkr-settings-apply")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  equal(s.doc.getSnapshot().gameTitle, "Entered");
  equal(s.host.editedEvents.length, 1);
});

test("a pending asynchronous Apply locks the title and Cancel, and reports exactly one accepted edit", async () => {
  const s = await setup();
  let releaseApply: () => void = () => undefined;
  const delayed: ViewDocument = {
    identity: s.doc.identity,
    kind: s.doc.kind,
    getSnapshot: () => s.doc.getSnapshot(),
    subscribe: (listener) => s.doc.subscribe(listener),
    apply: (command) => new Promise<ApplyResult>((resolve) => { releaseApply = () => resolve(s.doc.apply(command)); }),
    save: () => s.doc.save(),
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
  };
  await act(() => { mount(s.el, { document: delayed, services: s.host }); });
  await type(s.el, "First title");
  equal(s.doc.getSnapshot().gameTitle, "Example Game");
  equal(input(s.el).disabled, true);
  equal(s.el.querySelector<HTMLButtonElement>(".tkr-settings-discard")!.disabled, true);
  equal(button(s.el).disabled, true, "Save cannot race the pending edit");
  await act(async () => { releaseApply(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  equal(s.doc.getSnapshot().gameTitle, "First title");
  equal(s.host.editedEvents.length, 1);
  equal(input(s.el).disabled, false);
  await type(s.el, "Second title");
  equal(s.doc.getSnapshot().gameTitle, "First title", "a second Apply is awaiting its acknowledgement");
  await act(async () => { releaseApply(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  equal(s.doc.getSnapshot().gameTitle, "Second title");
  equal(s.host.editedEvents.length, 2);
});
test("Save is disabled and the state says Saving while a save is in flight", async () => {
  const s = await setup();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = await openMainDocument(
    {
      readProject: (projectId, path) => s.host.fs.readProject(projectId, path),
      writeProject: async (projectId, path, bytes) => {
        await gate;
        return s.host.fs.writeProject(projectId, path, bytes);
      },
    },
    identity,
  );
  ok(slow.ok);
  await act(() => {
    mount(s.el, { document: slow.document, services: s.host });
  });
  await type(s.el, "Slow");
  equal(button(s.el).disabled, false);
  await act(() => {
    button(s.el).click();
  });
  equal(slow.document.getSnapshot().saving, true);
  equal(status(s.el), "Saving…");
  equal(button(s.el).disabled, true, "a second click cannot start another save");
  await act(async () => {
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  equal(status(s.el), "All changes saved");
  equal(button(s.el).disabled, true, "clean again");
});

test("a staged validation error is named by the title field's aria-describedby", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "日本語");
  const field = input(s.el);
  const ids = (field.getAttribute("aria-describedby") ?? "").split(" ");
  const descriptions = ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
  match(descriptions, /Game title: character U\+65E5/);
  equal(field.getAttribute("aria-invalid"), "true");
});

test("typing the title the document already has is not an edit", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "Example Game");
  equal(s.doc.getSnapshot().edits.length, 0);
  equal(s.doc.getSnapshot().dirty, false);
  equal(s.host.editedEvents.length, 0, "no document.edited");
  equal(input(s.el).value, "Example Game");
});

test("an external title change does not erase an invalid staged draft; Cancel reveals the new title", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "日本語");
  equal(input(s.el).getAttribute("aria-invalid"), "true");
  await act(() => { s.doc.apply({ type: "set-game-title", title: "From elsewhere" }); });
  equal(input(s.el).value, "日本語");
  await act(() => { s.el.querySelector<HTMLButtonElement>(".tkr-settings-discard")!.click(); });
  equal(input(s.el).getAttribute("aria-invalid"), null);
  equal(input(s.el).value, "From elsewhere");
});

test("a change made between the first render and the subscription is not missed", async () => {
  const s = await setup();
  await act(() => {
    mount(s.el, { document: s.doc, services: s.host });
    // The view has rendered but its effects have not run, so it is not listening yet.
    s.doc.apply({ type: "set-game-title", title: "Slipped in" });
  });
  equal(input(s.el).value, "Slipped in");
  equal(status(s.el), "Unsaved changes");
});

test("undoing after a failed save never shows a clean document beside the old failure (defect 7)", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "Edited");
  s.host.failWrites({ code: "io-error", message: "disk full" });
  await save(s);
  equal(alerts(s.el).length, 1);
  await act(() => {
    s.doc.undo();
  });
  const shown = alerts(s.el);
  ok(!(status(s.el) === "All changes saved" && shown.length > 0), `status "${status(s.el)}" beside ${JSON.stringify(shown)}`);
  equal(status(s.el), "Unsaved changes", "the file may not hold the opened state any more");
  s.host.failWrites(null);
  await save(s);
  deepEqual(alerts(s.el), []);
  equal(status(s.el), "All changes saved");
  deepEqual(s.host.bytesOf(PATH), exampleMain(9), "the undone state was really written");
});

test("each failed save is announced: the same failure twice is a new alert element, not the old one kept", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "Edited");
  s.host.failWrites({ code: "io-error", message: "disk full" });
  const seen: Element[] = [];
  const watcher = new MutationObserver(() => undefined);
  watcher.observe(s.el, { childList: true, subtree: true });
  await save(s);
  const firstAlert = s.el.querySelector('[role="alert"]');
  ok(firstAlert !== null);
  seen.push(firstAlert);
  await save(s);
  const secondAlert = s.el.querySelector('[role="alert"]');
  ok(secondAlert !== null);
  equal(secondAlert.textContent, firstAlert.textContent, "the very same words");
  notEqual(secondAlert, firstAlert, "a live region announces an inserted node, not an unchanged one");
  watcher.disconnect();
});

test("a failure that replaces another with the same words, with no clean state between, is a new alert element", async () => {
  const s = await setup();
  const failure = (): SaveFailure => ({ document: PATH, kind: "write", code: "io-error", message: `Could not save ${PATH}: disk full` });
  let snapshot: MainDocumentSnapshot = { ...s.doc.getSnapshot(), dirty: true, saveError: failure() };
  const listeners = new Set<() => void>();
  const stub: MainDocument = {
    identity: s.doc.identity,
    kind: s.doc.kind,
    getSnapshot: () => snapshot,
    serialize: () => s.doc.serialize(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    apply: (command) => s.doc.apply(command),
    undo: (editId) => s.doc.undo(editId),
    redo: (editId) => s.doc.redo(editId),
    save: () => Promise.resolve({ ok: true }),
    checkExternal: () => s.doc.checkExternal(),
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
    revert: () => s.doc.revert(),
    saveAs: (storage, target) => s.doc.saveAs(storage, target),
  };
  await act(() => {
    mount(s.el, { document: stub, services: s.host });
  });
  const before = s.el.querySelector('[role="alert"]');
  ok(before !== null);
  // The same words again, as a new failure value, and no snapshot without an error in between.
  await act(() => {
    snapshot = { ...snapshot, saveError: failure() };
    for (const listener of listeners) listener();
  });
  const after = s.el.querySelector('[role="alert"]');
  ok(after !== null);
  equal(after.textContent, before.textContent);
  notEqual(after, before, "re-rendered with a new key");
  // The same failure value shown again is not announced again.
  await act(() => {
    snapshot = { ...snapshot, saving: false };
    for (const listener of listeners) listener();
  });
  equal(s.el.querySelector('[role="alert"]'), after, "an unrelated change keeps the alert as it was");
});
test("conflict without reload capability offers keep and cancel, and cancel preserves both versions and conflict", async () => {
  const original = exampleMain(9);
  const s = await setup(original, ["folderWrite"]);
  show(s);
  await type(s.el, "Local version");
  s.host.seed(PATH, withTitle(exampleMain(9), "External version"));
  await act(async () => { await s.doc.checkExternal(); });
  const external = s.host.bytesOf(PATH);
  ok(external !== undefined);
  equal(s.el.querySelector(".tkr-settings-reload"), null);
  ok(s.el.querySelector(".tkr-settings-keep"));
  match(s.el.textContent ?? "", /cannot safely reload/);
  const cancel = s.el.querySelector<HTMLButtonElement>(".tkr-settings-cancel");
  ok(cancel);
  await act(() => cancel.click());
  ok(s.el.querySelector('[role="alert"]'), "conflict warning remains visible");
  const review = s.el.querySelector<HTMLButtonElement>(".tkr-settings-review");
  ok(review);
  equal(s.el.querySelector(".tkr-settings-keep"), null);
  equal(s.doc.getSnapshot().conflict?.externalTitle, "External version");
  equal(s.doc.getSnapshot().gameTitle, "Local version");
  equal(s.doc.getSnapshot().dirty, true);
  deepEqual(s.host.bytesOf(PATH), external);
  await act(() => review.click());
  ok(s.el.querySelector(".tkr-settings-keep"), "the preserved conflict can be reviewed again");
  equal(s.el.querySelector(".tkr-settings-reload"), null);
});

test("keeping a conflict without auto-save capability does not dispatch a save", async () => {
  const s = await setup(exampleMain(9), ["folderWrite"]);
  show(s);
  await type(s.el, "Local version");
  s.host.seed(PATH, withTitle(exampleMain(9), "External version"));
  await act(async () => { await s.doc.checkExternal(); });
  const keep = s.el.querySelector<HTMLButtonElement>(".tkr-settings-keep");
  ok(keep);
  equal(keep.textContent?.trim(), "Keep my version");
  let saves = 0;
  const save = s.doc.save.bind(s.doc);
  s.doc.save = async () => {
    saves += 1;
    return save();
  };
  await act(async () => {
    keep.click();
    await Promise.resolve();
  });
  equal(saves, 0);
  equal(s.doc.getSnapshot().conflict, null);
  equal(s.doc.getSnapshot().dirty, true);
  equal(titleOf(s.host.bytesOf(PATH) ?? new Uint8Array()), "External version");
});

test("conflict with reload capability offers Use disk", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "Local version");
  s.host.seed(PATH, withTitle(exampleMain(9), "External version"));
  await act(async () => { await s.doc.checkExternal(); });
  ok(s.el.querySelector(".tkr-settings-reload"));
});

test("a save that is rejected rather than answered leaves no unhandled rejection (defect 2)", async () => {
  const s = await setup();
  const rejecting: MainDocument = {
    identity: s.doc.identity,
    kind: s.doc.kind,
    getSnapshot: () => ({ ...s.doc.getSnapshot(), dirty: true }),
    serialize: () => s.doc.serialize(),
    subscribe: (listener) => s.doc.subscribe(listener),
    apply: (command) => s.doc.apply(command),
    undo: (editId) => s.doc.undo(editId),
    redo: (editId) => s.doc.redo(editId),
    save: () => Promise.reject(new Error("a document that breaks its contract")),
    checkExternal: () => s.doc.checkExternal(),
    resolveConflict: (choice) => s.doc.resolveConflict(choice),
    revert: () => s.doc.revert(),
    saveAs: (storage, target) => s.doc.saveAs(storage, target),
  };
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    await act(() => {
      mount(s.el, { document: rejecting, services: s.host });
    });
    await act(async () => {
      button(s.el).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await new Promise((resolve) => setImmediate(resolve));
    deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a title the document changes under a committed draft replaces it: a revert shows the file's title, not the stale draft", async () => {
  const original = exampleMain(9);
  const s = await setup(original);
  show(s);
  await type(s.el, "Committed");
  await act(async () => {
    button(s.el).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  equal(status(s.el), "All changes saved");
  await type(s.el, "Not yet saved");
  equal(input(s.el).value, "Not yet saved");
  // The document goes back to the file's version while the draft's command is the latest one: the field must follow it.
  await act(async () => { await s.doc.revert(); });
  equal(input(s.el).value, "Committed", "the field shows the saved revision the file holds, not the discarded draft");
  equal(status(s.el), "All changes saved");
  equal(s.doc.getSnapshot().dirty, false);
});
