// Story 13.10 (T-57, T-58): the two forms against real documents and the memory host. Expected bytes are patched by hand
// at the offsets of the committed annotated listings, never taken from the writer.
import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentIdentity, createPendingEdits, openSpecialMoveDocument, openStatusEffectDocument, type SpecialMoveDocument } from "@tk-reawakened/editor-model";
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
    equal(button(view.root, "Save").disabled, false, "a refused value keeps its text but does not block saving the rest");
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

// Story 13.10 follow-ups from independent review: a save must apply a focused draft, a link resolves the way the game
// does, a reference that leaves its folder says so instead of waiting, a Choose replaces a stale draft, and an undo or a
// revert drops drafts typed against the newer model.

async function mountWithPending(files: Record<string, Uint8Array>, pick?: string) {
  const pendingEdits = createPendingEdits();
  const host = createMemoryPlatformServices({ files });
  const opened = await openSpecialMoveDocument(host.fs, createDocumentIdentity("memory-project", SPC));
  ok(opened.ok);
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: opened.document,
    services: host,
    pendingEdits,
    navigation: {
      open: async () => null,
      ...(pick === undefined ? {} : { pickAsset: async () => ({ chosen: true as const, reference: pick }) }),
    },
  });
  await settle();
  return { root, host, doc: opened.document, pendingEdits, dispose: () => { handle.dispose(); root.remove(); } };
}

test("the view's Save applies a field the author is still typing in, instead of writing the document without it", async () => {
  const view = await mountWithPending({ [SPC]: fireball, [STE]: burn });
  try {
    // Typed but not left: no change event, so the document does not hold it yet.
    await act(() => { const input = field(view.root, "Damage (FP)"); input.value = "-30"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    deepEqual(view.doc.serialize(), fireball, "nothing is in the document yet");
    await act(() => button(view.root, "Save").click());
    await settle();
    deepEqual(view.host.bytesOf(SPC), patched(fireball, { [FP]: [0xe2, 0xff, 0xff, 0xff] }), "the typed damage reached the file");
  } finally { view.dispose(); }
});

test("a refused field refuses the view's save with its reason and offers to discard the text", async () => {
  const view = await mountWithPending({ [SPC]: fireball, [STE]: burn });
  try {
    await act(() => { const input = field(view.root, "Damage (FP)"); input.value = "9999999999"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(() => button(view.root, "Save").click());
    await settle();
    ok(view.root.textContent?.includes("Nothing was saved"), "the save says it did not happen");
    deepEqual(view.host.bytesOf(SPC), fireball, "the file kept its bytes");
    const discard = [...view.root.querySelectorAll("button")].find((candidate) => candidate.textContent === "Discard the unapplied text");
    ok(discard, "the author can discard the refused text");
    await act(() => discard.click());
    await settle();
    equal(field(view.root, "Damage (FP)").value, "12");
    await act(() => button(view.root, "Save").click());
    await settle();
    ok(view.root.textContent?.includes("Special move saved."));
  } finally { view.dispose(); }
});

test("a linked file is found the way the game resolves it: a different case, or the extension left off", async () => {
  const view = await mountWithPending({ [SPC]: fireball, [STE]: burn });
  try {
    await until(() => view.root.textContent?.includes("Burn: 3 rounds") === true, "the stored spelling resolves");
    await type(field(view.root, "Status effect file"), "BURN.STE");
    await until(() => view.root.textContent?.includes("Burn: 3 rounds") === true, "an upper-case reference resolves");
    await type(field(view.root, "Status effect file"), "burn");
    await until(() => view.root.textContent?.includes("Burn: 3 rounds") === true, "a reference without its extension resolves");
    const statusRow = field(view.root, "Status effect file").closest("fieldset");
    ok(statusRow !== null && !statusRow.textContent?.includes("is not in the project"), "the status effect row reports nothing missing");
  } finally { view.dispose(); }
});

test("a reference that steps out of its folder is named as such at once, never left on Checking", async () => {
  const view = await mountWithPending({ [SPC]: fireball, [STE]: burn });
  try {
    await type(field(view.root, "Status effect file"), "../burn.ste");
    await until(() => view.root.textContent?.includes("cannot step out of its folder") === true, "the form explains the reference");
    ok(!view.root.textContent?.includes("Checking"), "no read was sent, so nothing waits on one");
    equal(button(view.root, "Open status effect").disabled, true);
  } finally { view.dispose(); }
});

test("a Choose replaces the text that was typed, so the field and Save agree with the document", async () => {
  const view = await mountWithPending({ [SPC]: fireball, [STE]: burn }, "burn.ste");
  try {
    await type(field(view.root, "Status effect file"), "not-a-file");
    ok(view.root.textContent?.includes("is not in the project"), "the typed reference is reported as missing");
    await act(() => button(view.root, "Choose status effect").click());
    await settle();
    equal(field(view.root, "Status effect file").value, "burn.ste");
    equal(view.doc.getSnapshot().statusEffect, "burn.ste");
    equal(button(view.root, "Save").disabled, false, "no stale draft keeps Save disabled");
  } finally { view.dispose(); }
});

test("a decimal that would round into a whole number is refused, not silently rounded", async () => {
  const view = await mountWithPending({ [SPC]: fireball, [STE]: burn });
  try {
    await type(field(view.root, "Damage (FP)"), "2147483646.99999999");
    ok(view.root.textContent?.includes("a decimal point or an exponent would be rounded"));
    equal(view.doc.getSnapshot().damage, 12, "the document kept its value");
    deepEqual(view.doc.serialize(), fireball);
  } finally { view.dispose(); }
});

test("a description's Windows line endings survive an edit made in the multi-line field", async () => {
  const twoLines = patched(fireball, {});
  // The stored description starts at 0x44 and ends at the closing NUL before EOF; put "One\r\nTwo" there.
  const description = [...twoLines].slice(0x43, twoLines.length - 1);
  const withCrlf = new Uint8Array([...twoLines.slice(0, 0x43), ...Uint8Array.from("One\r\nTwo\0", (char) => char.charCodeAt(0))]);
  void description;
  const view = await mountWithPending({ [SPC]: withCrlf, [STE]: burn });
  try {
    const area = view.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]');
    ok(area, "the description is a multi-line field");
    await act(() => { area.value = "One\nTwo!"; area.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    const saved = view.doc.serialize();
    equal(new TextDecoder("windows-1252").decode(saved.slice(0x43, saved.length - 1)), "One\r\nTwo!", "the file's own line endings are kept");
  } finally { view.dispose(); }
});

test("an explicit save applies a focused draft, autosave and a backup leave the gesture alone, and a revert drops it", async () => {
  const view = await mountWithPending({ [SPC]: fireball, [STE]: burn });
  try {
    const typeDamage = async (value: string): Promise<void> => {
      await act(() => { const input = field(view.root, "Damage (FP)"); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); });
    };
    await typeDamage("-30");
    await view.pendingEdits.settle("autosave");
    equal(view.doc.getSnapshot().damage, 12, "autosave does not commit the field mid-gesture");
    await view.pendingEdits.settle("explicit");
    equal(view.doc.getSnapshot().damage, -30, "an explicit save applies it");
    await act(() => { const input = field(view.root, "Damage (FP)"); input.value = "-7"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await view.pendingEdits.settle("revert");
    equal(field(view.root, "Damage (FP)").value, "-30", "a revert shows the document again");
    equal(view.root.querySelector("[role=alert]")?.textContent?.includes("Nothing was saved") ?? false, false);
  } finally { view.dispose(); }
});

test("a mixed-case file name in the project is found from a lower-case reference", async () => {
  const { host, pendingEdits } = { host: createMemoryPlatformServices({ files: { [SPC]: fireball, "StatusE/Burn.STE": burn } }), pendingEdits: createPendingEdits() };
  const opened = await openSpecialMoveDocument(host.fs, createDocumentIdentity("memory-project", SPC));
  ok(opened.ok);
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, { document: opened.document, services: host, pendingEdits });
  await settle();
  try {
    await until(() => root.textContent?.includes("Burn: 3 rounds") === true, "the stored spelling Burn.STE is found from burn.ste");
  } finally { handle.dispose(); root.remove(); }
});

test("a query settle leaves the drafts alone and only a real revert drops them", async () => {
  const view = await mountWithPending({ [SPC]: fireball, [STE]: burn });
  try {
    await act(() => { const input = field(view.root, "Damage (FP)"); input.value = "-30"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await view.pendingEdits.settle("query");
    equal(field(view.root, "Damage (FP)").value, "-30", "the revert question does not touch the field");
    equal(view.doc.getSnapshot().damage, 12);
    await view.pendingEdits.settle("autosave");
    equal(view.doc.getSnapshot().damage, 12, "autosave leaves the gesture alone");
    await view.pendingEdits.settle("explicit");
    equal(view.doc.getSnapshot().damage, -30, "an explicit save applies it");
  } finally { view.dispose(); }
});

test("a description edit leaves no phantom draft behind, so Save stays available", async () => {
  const twoLines = new Uint8Array([...patched(fireball, {}).slice(0, 0x43), ...Uint8Array.from("One\r\nTwo\0", (c) => c.charCodeAt(0))]);
  const view = await mountWithPending({ [SPC]: twoLines, [STE]: burn });
  try {
    const area = view.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]');
    ok(area, "the description is a multi-line field");
    await act(() => { area.value = "One\nTwo!"; area.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    equal(button(view.root, "Save").disabled, false, "no invisible draft keeps Save disabled");
    equal(view.doc.getSnapshot().description, "One\r\nTwo!", "the file's own line endings are kept");
  } finally { view.dispose(); }
});

test("a backup or query settle neither refuses nor applies a refused draft, and an explicit save refuses only then", async () => {
  const view = await mountWithPending({ [SPC]: fireball, [STE]: burn });
  try {
    await act(() => { const input = field(view.root, "Damage (FP)"); input.value = "9999999999"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await view.pendingEdits.settle("query");
    equal(await view.pendingEdits.settle("autosave").then((outcome) => outcome.ok), true, "a backup is not refused for a field it does not judge");
    ok((await view.pendingEdits.settle("explicit")).ok === false, "an explicit save is refused while the draft cannot be stored");
    equal(field(view.root, "Damage (FP)").value, "9999999999", "the text stays for the author");
  } finally { view.dispose(); }
});

test("inserting a line keeps every surviving description separator as the file wrote it", async () => {
  // The stored description is "One\r\nTwo": a mixed-ending file is not needed to prove the separators survive an insert.
  const stored = new Uint8Array([...patched(fireball, {}).slice(0, 0x43), ...Uint8Array.from("One\r\nTwo\0", (c) => c.charCodeAt(0))]);
  const view = await mountWithPending({ [SPC]: stored, [STE]: burn });
  try {
    const area = view.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]');
    ok(area);
    await act(() => { area.value = "One\nInserted\nTwo"; area.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    const saved = view.doc.serialize();
    equal(new TextDecoder("windows-1252").decode(saved.slice(0x43, saved.length - 1)), "One\r\nInserted\r\nTwo", "the surviving separator is unchanged and the added line copies it");
  } finally { view.dispose(); }
});

test("a status reference without its extension resolves as the runtime does, and a program reference does not", async () => {
  // `statusdata` appends `.ste`; `executeProgram` loads the exact reference. The form must follow each one, or Open would
  // lead to a file the game never runs.
  const host = createMemoryPlatformServices({ files: { [SPC]: fireball, [STE]: burn, "Prg/fireball.prg": new Uint8Array([0x2f, 0x2f, 0x20, 0x78]) } });
  const opened = await openSpecialMoveDocument(host.fs, createDocumentIdentity("memory-project", SPC));
  ok(opened.ok);
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, { document: opened.document, services: host, pendingEdits: createPendingEdits(), navigation: { open: async () => null } });
  await settle();
  try {
    await act(() => { const input = field(root, "Status effect file"); input.value = "burn"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
    await until(() => root.textContent?.includes("Burn: 3 rounds") === true, "an extensionless status resolves, as the runtime appends .ste");
    await act(() => { const input = field(root, "Program file"); input.value = "fireball"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
    await until(() => root.textContent?.includes("Prg/fireball is not in the project") === true, "an extensionless program is not completed");
    const programs = field(root, "Program file").closest("fieldset");
    ok(programs !== null);
    equal(button(programs as HTMLElement, "Open program").disabled, true, "Open is never offered for a file the game will not load");
  } finally { handle.dispose(); root.remove(); }
});
