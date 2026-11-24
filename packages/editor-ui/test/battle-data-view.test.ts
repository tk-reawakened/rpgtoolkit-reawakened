// Story 13.10 (T-57, T-58): the two forms against real documents and the memory host. Expected bytes are patched by hand
// at the offsets of the committed annotated listings, never taken from the writer.
import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentIdentity, openSpecialMoveDocument, openStatusEffectDocument, type SpecialMoveDocument } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { mount as mountEditor } from "../src/index.ts";

let mount: typeof mountEditor;
let act: (callback: () => void | Promise<void>) => void | Promise<void>;
before(async () => {
  // The UI reads browser globals at module initialization, so register the DOM before loading it.
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});
after(() => GlobalRegistrator.unregister());

const SPC = "SpcMove/fireball.spc";
const STE = "StatusE/burn.ste";
const example = (path: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../docs/spec/examples/game/Game/Example/${path}`, import.meta.url)));
const fireball = example(SPC);
const burn = example(STE);
const textSte = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/status-effect/status_text.ste", import.meta.url)));
const BATTLE = 0x37;
const MENU = 0x38;
const FP = 0x1e;
const HP_AMOUNT = 0x24;
const SPEED = 0x1c;

const patched = (original: Uint8Array, edits: Readonly<Record<number, readonly number[]>>): Uint8Array => {
  const copy = original.slice();
  for (const [at, bytes] of Object.entries(edits)) copy.set(bytes, Number(at));
  return copy;
};

const settle = async (): Promise<void> => { await act(async () => { for (let turn = 0; turn < 4; turn += 1) await new Promise<void>((resolve) => { setImmediate(resolve); }); }); };
/** Wait until `done` holds, letting the page run; a condition that never holds fails with its own message. */
const until = async (done: () => boolean, message: string): Promise<void> => {
  for (let round = 0; round < 200 && !done(); round += 1) await settle();
  ok(done(), message);
};
const field = (root: HTMLElement, label: string): HTMLInputElement => {
  const found = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  ok(found, `no field named ${label}: ${root.textContent}`);
  return found;
};
const button = (root: HTMLElement, label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll("button")].find((candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent === label);
  ok(found, `no button named ${label}`);
  return found;
};
/** Type into a field and leave it: the form submits when the field is left. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(() => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
}
async function toggle(input: HTMLInputElement): Promise<void> {
  await act(() => { input.checked = !input.checked; input.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
}

interface Mounted {
  readonly root: HTMLElement;
  readonly host: ReturnType<typeof createMemoryPlatformServices>;
  readonly opened: string[];
  readonly doc: SpecialMoveDocument;
  dispose(): void;
}

async function mountMove(files: Record<string, Uint8Array> = { [SPC]: fireball, [STE]: burn }): Promise<Mounted> {
  const host = createMemoryPlatformServices({ files });
  const doc = await openSpecialMoveDocument(host.fs, createDocumentIdentity("memory-project", SPC));
  ok(doc.ok);
  const root = document.createElement("div");
  document.body.append(root);
  const opened: string[] = [];
  const handle = mount(root, { document: doc.document, services: host, navigation: { open: async (path) => { opened.push(path); return null; } } });
  await settle();
  return { root, host, opened, doc: doc.document, dispose: () => { handle.dispose(); root.remove(); } };
}

test("the special move form shows each stored field, with the usable boxes inverted from the stored bytes", async () => {
  const view = await mountMove();
  try {
    equal(field(view.root, "Name").value, "Fireball");
    equal(field(view.root, "Damage (FP)").value, "12");
    equal(field(view.root, "SMP cost to the user").value, "5");
    equal(field(view.root, "Status effect file").value, "burn.ste");
    equal(field(view.root, "Program file").value, "fireball.prg");
    // The committed fireball stores battle = 1 (not usable) and menu = 0 (usable).
    equal(field(view.root, "Usable in battle").checked, false);
    equal(field(view.root, "Usable from the menu").checked, true);
    ok(view.root.textContent?.includes("Stored value 1: 0 means usable"));
    equal(view.root.querySelector("[data-tkr-editor]")?.getAttribute("data-tkr-editor"), "Special move");
  } finally { view.dispose(); }
});

test("ticking the usable boxes writes 0 and 1, and Save puts exactly those bytes in the file", async () => {
  const view = await mountMove();
  try {
    await toggle(field(view.root, "Usable in battle"));
    await toggle(field(view.root, "Usable from the menu"));
    deepEqual(view.doc.serialize(), patched(fireball, { [BATTLE]: [0], [MENU]: [1] }));
    await act(() => button(view.root, "Save").click());
    await settle();
    deepEqual(view.host.bytesOf(SPC), patched(fireball, { [BATTLE]: [0], [MENU]: [1] }));
    ok(view.root.textContent?.includes("Special move saved."));
  } finally { view.dispose(); }
});

test("a negative damage is stored as a signed value and described as healing; a value that does not fit is refused and kept visible", async () => {
  const view = await mountMove();
  try {
    await type(field(view.root, "Damage (FP)"), "-30");
    deepEqual(view.doc.serialize(), patched(fireball, { [FP]: [0xe2, 0xff, 0xff, 0xff] }));
    ok(view.root.textContent?.includes("Heals the target by 30"));
    await type(field(view.root, "Damage (FP)"), "3000000000");
    equal(view.root.querySelector("[role=alert]")?.textContent?.includes("whole number from -2147483648 to 2147483647"), true);
    equal(field(view.root, "Damage (FP)").value, "3000000000", "the typed value stays so it can be corrected");
    equal(view.doc.getSnapshot().damage, -30);
    ok(button(view.root, "Save").disabled, "Save waits while a field holds an unapplied value");
  } finally { view.dispose(); }
});

test("the linked status effect is described from its saved file, opens through the shared visit, and a missing file keeps the reference", async () => {
  const view = await mountMove();
  try {
    await until(() => view.root.textContent?.includes("Burn: 3 rounds; removes 2 HP each round.") === true, "the linked status effect is described from its saved file");
    await act(() => button(view.root, "Open status effect").click());
    await settle();
    deepEqual(view.opened, [STE]);
    await type(field(view.root, "Status effect file"), "gone.ste");
    await until(() => view.root.textContent?.includes("StatusE/gone.ste is not in the project") === true, "a missing linked file is reported");
    equal(view.doc.getSnapshot().statusEffect, "gone.ste", "the reference is kept as typed");
    ok(button(view.root, "Open status effect").disabled);
  } finally { view.dispose(); }
});

test("the status effect form lists signed amounts and keeps an authored non-zero flag until it is turned off", async () => {
  const authored = patched(burn, { [SPEED]: [0xff, 0xff], [HP_AMOUNT]: [0xfe, 0xff] });
  const host = createMemoryPlatformServices({ files: { [STE]: authored } });
  const opened = await openStatusEffectDocument(host.fs, createDocumentIdentity("memory-project", STE));
  ok(opened.ok);
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, { document: opened.document, services: host });
  await settle();
  try {
    equal(field(root, "HP per round").value, "-2");
    ok(root.textContent?.includes("Heals 2 HP each round"));
    equal(field(root, "Speed up").checked, true);
    await until(() => root.textContent?.includes("Stored value -1: any non-zero value is on.") === true, "the authored flag value is shown");
    await toggle(field(root, "Slow down"));
    deepEqual(opened.document.serialize(), patched(authored, { 0x1e: [1, 0] }), "turning a flag on writes 1 and leaves the authored -1 alone");
    await toggle(field(root, "Speed up"));
    deepEqual(opened.document.serialize(), patched(authored, { 0x1e: [1, 0], [SPEED]: [0, 0] }));
    await type(field(root, "Rounds"), "0");
    equal(opened.document.getSnapshot().rounds, 0);
    await act(() => button(root, "Save").click());
    await settle();
    deepEqual(host.bytesOf(STE), patched(authored, { 0x1e: [1, 0], [SPEED]: [0, 0], 0x1a: [0, 0] }));
  } finally { handle.dispose(); root.remove(); }
});

test("a Toolkit 2 text status effect shows its reason and every field is disabled", async () => {
  const host = createMemoryPlatformServices({ files: { [STE]: textSte } });
  const opened = await openStatusEffectDocument(host.fs, createDocumentIdentity("memory-project", STE));
  ok(opened.ok);
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, { document: opened.document, services: host });
  await settle();
  try {
    ok(root.textContent?.includes("Read only: This Toolkit 2 text status effect has no same-version writer"));
    ok(field(root, "Rounds").disabled);
    ok(field(root, "Disable").disabled);
    ok(button(root, "Save").disabled);
  } finally { handle.dispose(); root.remove(); }
});
