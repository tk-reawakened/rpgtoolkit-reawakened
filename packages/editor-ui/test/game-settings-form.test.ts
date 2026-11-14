// Story 11.6 (#1704): the staged form over every game setting, rendered over the real model and the in-memory host.
// Fields stage; Apply is one command; Cancel leaves the document as it was; Save writes only what was applied.
import { after, before, test } from "node:test";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentIdentity, openMainDocument, type MainDocument } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type * as EditorUi from "../src/index.ts";
import { exampleMain, exampleTextMain } from "./fixtures.ts";

const PATH = "Main/example.gam";
const identity = createDocumentIdentity("memory-project", PATH);

let mount: typeof EditorUi.mount;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  // Preact reads the DOM when it is first evaluated, so it can only be imported once the shim is registered.
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});
after(() => GlobalRegistrator.unregister());

interface Setup {
  readonly host: MemoryPlatformServices;
  readonly doc: MainDocument;
  readonly el: HTMLElement;
}

async function shown(bytes: Uint8Array = exampleMain(9)): Promise<Setup> {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  const opened = await openMainDocument(host.fs, identity);
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  const el = document.createElement("div");
  document.body.append(el);
  await act(() => { mount(el, { document: opened.document, services: host }); });
  return { host, doc: opened.document, el };
}

/** The control a label names, found by the label's words as a person reads them. */
function field<Element extends HTMLElement = HTMLInputElement>(el: HTMLElement, label: string): Element {
  const found = [...el.querySelectorAll("label")].find((node) => node.textContent === label);
  const control = found === undefined ? null : el.ownerDocument.getElementById(found.getAttribute("for") ?? "");
  if (control === null) throw new Error(`no field labelled "${label}"`);
  return control as Element;
}

function button(el: HTMLElement, label: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  if (found === undefined) throw new Error(`no "${label}" button`);
  return found;
}

const staged = (el: HTMLElement): string => el.querySelector(".tkr-settings-staged")?.textContent ?? "";

async function type(control: HTMLInputElement, text: string): Promise<void> {
  await act(() => {
    control.value = text;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function choose(control: HTMLSelectElement | HTMLInputElement, value: string | boolean): Promise<void> {
  await act(() => {
    if (typeof value === "boolean") (control as HTMLInputElement).checked = value;
    else control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function click(target: HTMLButtonElement): Promise<void> {
  await act(async () => {
    target.click();
    // One macrotask turn lets Apply's promise chain (the document may answer asynchronously) finish; no clock is read.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

test("a staged field changes nothing until Apply, which makes one edit and reports it to the host", async () => {
  const s = await shown();
  equal(staged(s.el), "No staged settings.");
  equal(button(s.el, "Apply changes").disabled, true);
  await type(field(s.el, "Initial board"), "forest.brd");
  await choose(field<HTMLSelectElement>(s.el, "Resolution"), "2");
  await choose(field(s.el, "Full screen"), true);
  match(staged(s.el), /^3 staged settings are not applied yet\. Save writes only applied settings\.$/);
  equal(s.doc.getSnapshot().edits.length, 0, "staging is not an edit");
  equal(s.doc.getSnapshot().dirty, false);
  equal(s.el.querySelector(".tkr-settings-state")?.textContent, "All changes saved", "the document is still clean");

  await click(button(s.el, "Apply changes"));
  const edits = s.doc.getSnapshot().edits;
  equal(edits.length, 1);
  equal(edits[0]?.label, "Change 3 game settings");
  deepEqual(s.host.editedEvents.map((event) => event.label), ["Change 3 game settings"]);
  equal(s.doc.getSnapshot().settings.initBoard, "forest.brd");
  equal(s.doc.getSnapshot().settings.resolution, 2);
  equal(s.doc.getSnapshot().settings.extendToFullScreen, true);
  equal(staged(s.el), "No staged settings.");
  equal(field(s.el, "Initial board").value, "forest.brd", "the field now shows the document's value");
});

test("Cancel drops what was staged and leaves the document and its file as they were", async () => {
  const s = await shown();
  await type(field(s.el, "Start program"), "intro.prg");
  await choose(field(s.el, "Random battles"), false);
  ok(!button(s.el, "Cancel changes").disabled);
  await click(button(s.el, "Cancel changes"));
  equal(field(s.el, "Start program").value, "start.prg");
  equal(field(s.el, "Random battles").checked, true);
  equal(staged(s.el), "No staged settings.");
  equal(s.doc.getSnapshot().edits.length, 0);
  deepEqual(s.host.bytesOf(PATH), exampleMain(9));
});

test("staged validation: an error is shown beside its field, marks it invalid and keeps Apply off until fixed", async () => {
  const s = await shown();
  const speed = field(s.el, "Game speed (−4 to +4)");
  await type(speed, "9");
  equal(speed.getAttribute("aria-invalid"), "true");
  const describedBy = (speed.getAttribute("aria-describedby") ?? "").split(" ");
  const words = describedBy.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
  match(words, /Stored in row 47\./, "the owning row is named");
  match(words, /Error: Game speed \(−4 to \+4\): enter a whole number from -4 to 4\./);
  equal(button(s.el, "Apply changes").disabled, true);
  match(staged(s.el), /fix 1 error to apply/);
  await type(speed, "-3");
  equal(speed.getAttribute("aria-invalid"), null);
  equal(button(s.el, "Apply changes").disabled, false);
  await click(button(s.el, "Apply changes"));
  equal(s.doc.getSnapshot().settings.gameSpeed, -3);
});

test("movement keys are captured as physical keys, conflicts are warned about, and Unbind clears a direction", async () => {
  const s = await shown();
  const east = field(s.el, "East");
  equal(east.value, "ArrowRight");
  await act(() => { east.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", key: "d", bubbles: true })); });
  equal(east.value, "KeyD");
  const south = field(s.el, "South");
  await act(() => { south.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", key: "d", bubbles: true })); });
  match(s.el.textContent ?? "", /Warning: KeyD moves the player East and South\./);
  await click(button(s.el, "Unbind South"));
  equal(south.value, "Unbound");
  await click(button(s.el, "Apply changes"));
  deepEqual(s.doc.getSnapshot().settings.movementScanCodes, [0x20, 0, 0, 0, 0xcb, 0, 0xc8, 0]);
});

test("adding a package shows its description, an unknown one says it is kept as data, and nothing is applied until Apply", async () => {
  const s = await shown();
  const draft = field(s.el, "Package to add");
  await type(draft, "stock_menu");
  await click(button(s.el, "Add package"));
  match(s.el.querySelector(".tkr-settings-added")?.textContent ?? "", /Added "stock_menu": The stock menu screens/);
  await type(field(s.el, "Package to add"), "mystery_pack");
  await click(button(s.el, "Add package"));
  match(s.el.querySelector(".tkr-settings-added")?.textContent ?? "", /does not know that package: it is kept as written, nothing is enabled by the editor/);
  match(s.el.textContent ?? "", /Warning: "mystery_pack" is not a package this editor knows/);
  deepEqual(s.doc.getSnapshot().settings.packages, []);
  await click(button(s.el, "Apply changes"));
  deepEqual(s.doc.getSnapshot().settings.packages, ["stock_menu", "mystery_pack"]);
  match(s.el.querySelector(".tkr-settings-sources")?.textContent ?? "", /mystery_pack — from the TKR package list\./);
});

test("extended run-time keys and enemies are edited by slot: Add opens the first free slot, Remove empties it", async () => {
  const s = await shown();
  await click(button(s.el, "Add run-time key"));
  await type(field(s.el, "Key 1 (ASCII code)"), "72");
  await type(field(s.el, "Program 1"), "help.prg");
  await click(button(s.el, "Remove enemy 1"));
  await click(button(s.el, "Add enemy"));
  await type(field(s.el, "Enemy 1"), "bat.ene");
  await type(field(s.el, "Skill level 1"), "4");
  await click(button(s.el, "Apply changes"));
  const settings = s.doc.getSnapshot().settings;
  deepEqual(settings.extKeys[0], { asciiKey: 72, program: "help.prg" });
  equal(settings.extKeys.length, 51, "the slot count is kept");
  deepEqual(settings.enemies[0], { enemyFile: "bat.ene", skillLevel: 4 });
  equal(settings.enemies.length, 501);
});

test("a row an older file does not store is disabled and says what the engine uses; the file's notes are shown", async () => {
  const s = await shown(exampleMain(3));
  const pathfinding = field<HTMLSelectElement>(s.el, "Default path-finding");
  equal(pathfinding.disabled, true);
  const owner = document.getElementById((pathfinding.getAttribute("aria-describedby") ?? "").split(" ")[0] ?? "")?.textContent ?? "";
  equal(owner, "Not stored by this file (minor 3; row 57 needs minor 9). The engine uses Diagonal (8-way grid).");
  equal(field<HTMLSelectElement>(s.el, "Colour depth").disabled, false);
  match(s.el.querySelector(".tkr-settings-notes")?.textContent ?? "", /This file is minor 3\./);
});

test("a read-only main file offers no Apply and no editable setting", async () => {
  const s = await shown(exampleTextMain());
  equal(field(s.el, "Initial board").disabled, true);
  equal(button(s.el, "Apply changes").disabled, true);
});
