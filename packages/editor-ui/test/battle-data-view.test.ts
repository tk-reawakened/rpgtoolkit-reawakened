// Story 13.10 (T-57, T-58): the two forms against real documents and the memory host. Expected bytes are patched by hand
// at the offsets of the committed annotated listings, never taken from the writer.
import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { EventEmitter, once } from "node:events";
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
async function editDescription(area: HTMLTextAreaElement, text: string, caret: number, inputType: string): Promise<void> {
  await act(() => {
    area.value = text;
    area.setSelectionRange(caret, caret);
    area.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
  });
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

type ApplyMove = () => ReturnType<SpecialMoveDocument["apply"]>;

async function mountWithPending(files: Record<string, Uint8Array>, pick?: string, gate?: (apply: ApplyMove) => Promise<ReturnType<ApplyMove>>) {
  const pendingEdits = createPendingEdits();
  const host = createMemoryPlatformServices({ files });
  const opened = await openSpecialMoveDocument(host.fs, createDocumentIdentity("memory-project", SPC));
  ok(opened.ok);
  const doc = opened.document;
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: gate === undefined ? doc : {
      kind: doc.kind, identity: doc.identity, getSnapshot: () => doc.getSnapshot(), subscribe: (listener) => doc.subscribe(listener),
      save: () => doc.save(), resolveConflict: (choice) => doc.resolveConflict(choice),
      apply: (command: Parameters<SpecialMoveDocument["apply"]>[0]) => gate(() => doc.apply(command)),
    },
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

test("editing a description keeps every separator the file wrote: insert, replace and delete lines in mixed endings", async () => {
  const through = async (stored: string, typed: string): Promise<string> => {
    const bytes = new Uint8Array([...fireball.slice(0, 0x43), ...Uint8Array.from(`${stored}\0`, (c) => c.charCodeAt(0))]);
    const view = await mountWithPending({ [SPC]: bytes, [STE]: burn });
    try {
      const area = view.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]');
      ok(area);
      await act(() => { area.value = typed; area.dispatchEvent(new Event("change", { bubbles: true })); });
      await settle();
      const saved = view.doc.serialize();
      return new TextDecoder("windows-1252").decode(saved.slice(0x43, saved.length - 1));
    } finally { view.dispose(); }
  };
  equal(await through("One\r\nTwo", "One\nInserted\nTwo"), "One\r\nInserted\r\nTwo", "an inserted line copies its neighbour's ending");
  equal(await through("A\r\nB\nC", "X\nB\nC"), "X\r\nB\nC", "a replaced line keeps the separator it had");
  equal(await through("A\r\nB\nC", "A\nC"), "A\r\nC", "deleting a line leaves the others' separators");
  equal(await through("A\r\nB\nC", "A\nB\nZ"), "A\r\nB\nZ", "the last line keeps its absence of a separator");
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
    // `statusdata` trims a status reference, so a space around the name is the same file; the stored text stays as typed.
    await act(() => { const input = field(root, "Status effect file"); input.value = " burn "; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
    await until(() => root.textContent?.includes("Burn: 3 rounds") === true, "a padded status reference resolves as the game trims it");
    equal(field(root, "Status effect file").value, " burn ", "and the stored text is not rewritten");
    // A program is loaded by its exact text: a space around the name is another file, not the one that exists.
    await act(() => { const input = field(root, "Program file"); input.value = " fireball.prg"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
    await until(() => root.textContent?.includes("Prg/ fireball.prg is not in the project") === true, "a padded program reference is looked up exactly and is not found");
    equal(button(programs as HTMLElement, "Open program").disabled, true, "and Open is not offered for it");
  } finally { handle.dispose(); root.remove(); }
});

test("Save my version goes through the same guard: text a field refuses is not saved around, and the other version stays on disk (#3385)", async () => {
  const view = await mountWithPending({ [SPC]: fireball, [STE]: burn });
  try {
    await act(() => { const input = field(view.root, "Damage (FP)"); input.value = "-30"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    // Another program changes the file: the document keeps both versions until the author chooses.
    const theirs = new Uint8Array(fireball);
    new DataView(theirs.buffer).setInt32(0x1e, 99, true);
    view.host.seed(SPC, theirs);
    const checked = await view.doc.checkExternal();
    equal(checked, "conflict", "the change on disk is noticed and waits for a choice");
    await settle();
    await act(() => { const input = field(view.root, "SMP cost to the user"); input.value = "9999999999"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    await act(() => { button(view.root, "Save my version").click(); });
    await settle();
    deepEqual(view.host.bytesOf(SPC), theirs, "the other version was not replaced around the refused text");
    ok(view.root.textContent?.includes("Nothing was saved"), "and the form says so");
    ok(view.doc.getSnapshot().conflict !== null, "the conflict is kept: nothing was adopted or written, so both versions are still the author's to choose between");
    ok([...view.root.querySelectorAll("button")].some((candidate) => candidate.textContent === "Use the version on disk"), "and the other choice is still offered");
  } finally { view.dispose(); }
});

test("the form's Save takes every view of the document into account, not only its own fields (#3385)", async () => {
  const view = await mountWithPending({ [SPC]: fireball, [STE]: burn });
  try {
    // A second view of the same document, in the same registry, holds text the file cannot store.
    const second = view.pendingEdits.register({
      busy: () => false,
      idle: async () => undefined,
      holdsDraft: () => true,
      refusal: (reason) => reason === "explicit" ? "a field in another view still holds text this file cannot store; correct it or discard it" : null,
    });
    await act(() => { const input = field(view.root, "Damage (FP)"); input.value = "-30"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    await act(() => button(view.root, "Save").click());
    await settle();
    deepEqual(view.host.bytesOf(SPC), fireball, "nothing was written around the other view's text");
    ok(view.root.textContent?.includes("Nothing was saved: a field in another view"), "and the form says why");
    second();
    await act(() => button(view.root, "Save").click());
    await settle();
    deepEqual(view.host.bytesOf(SPC), patched(fireball, { [FP]: [0xe2, 0xff, 0xff, 0xff] }), "once that view has nothing held, the save goes through");
  } finally { view.dispose(); }
});

test("a save locks text entry until it is over, so nothing is typed between what it settled and what it wrote (#3385)", async () => {
  const view = await mountWithPending({ [SPC]: fireball, [STE]: burn });
  try {
    const inputs = (): HTMLInputElement[] => ["Damage (FP)", "SMP cost to the user", "Status effect file"].map((label) => field(view.root, label));
    ok(inputs().every((input) => !input.disabled), "open for typing");
    await act(() => { view.pendingEdits.lock(true); });
    ok(inputs().every((input) => input.readOnly), "locked while the host settles and writes");
    ok(view.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]')?.readOnly === true);
    await act(() => { view.pendingEdits.lock(false); });
    ok(inputs().every((input) => !input.readOnly), "open again once the save is over");
  } finally { view.dispose(); }
});

test("Undo in the textarea restores the file's own separators, byte for byte (#3385)", async () => {
  const stored = "A\r\nB\nC";
  const bytes = new Uint8Array([...fireball.slice(0, 0x43), ...Uint8Array.from(`${stored}\0`, (c) => c.charCodeAt(0))]);
  const view = await mountWithPending({ [SPC]: bytes, [STE]: burn });
  try {
    const area = view.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]');
    ok(area);
    await editDescription(area, "AB\nC", 1, "deleteContentBackward");
    await editDescription(area, "A\nB\nC", 1, "historyUndo");
    await act(() => { area.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    deepEqual(view.doc.serialize(), bytes, "the original bytes, not a normalised copy");
    equal(view.doc.getSnapshot().dirty, false, "and no edit was made");

    await editDescription(area, "A\nB\nCx", 6, "insertText");
    await editDescription(area, "AB\nCx", 1, "deleteContentBackward");
    await editDescription(area, "A\nB\nCx", 2, "insertLineBreak");
    await editDescription(area, "AB\nCx", 1, "historyUndo");
    await editDescription(area, "A\nB\nCx", 6, "historyUndo");
    await act(() => { area.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    deepEqual(view.doc.serialize(), Uint8Array.from([...bytes.slice(0, -1), 0x78, 0]), "Undo chose the earlier mixed separators despite identical displayed text");
  } finally { view.dispose(); }
});

test("an acknowledgement cannot clear a later description draft with the same displayed text", async () => {
  const bytesWith = (text: string): Uint8Array => Uint8Array.from([...fireball.slice(0, 0x43), ...Buffer.from(text, "latin1"), 0]);
  const ack = new EventEmitter();
  const held = once(ack, "release");
  const release = (): void => { ack.emit("release"); };
  let applied = false;
  const view = await mountWithPending({ [SPC]: bytesWith("A\r\nB\nC"), [STE]: burn }, undefined, async (apply) => {
    const result = apply();
    applied = true;
    await held;
    return result;
  });
  try {
    const area = view.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]');
    ok(area);
    await editDescription(area, "A\nB\nCx", 6, "insertText");
    await act(() => { area.dispatchEvent(new Event("change", { bubbles: true })); });
    await until(() => applied, "the document applied the first edit but its acknowledgement is held");
    deepEqual(view.doc.serialize(), bytesWith("A\r\nB\nCx"));

    await editDescription(area, "AB\nCx", 1, "deleteContentBackward");
    await editDescription(area, "A\nB\nCx", 2, "insertLineBreak");
    release();
    await settle();
    deepEqual(view.doc.serialize(), bytesWith("A\r\nB\nCx"), "still the old description until the new draft is submitted");

    await act(() => button(view.root, "Save").click());
    await settle();
    deepEqual(view.host.bytesOf(SPC), bytesWith("A\nB\nCx"), "Save applies the newer draft even though the displayed text repeats");
  } finally { release(); view.dispose(); }
});

test("a queued amount returning to the old displayed value still submits after the first edit", async () => {
  const ack = new EventEmitter();
  const held = once(ack, "release");
  let started = false;
  const view = await mountWithPending({ [SPC]: fireball, [STE]: burn }, undefined, async (apply) => {
    started = true;
    await held;
    return apply();
  });
  try {
    const damage = field(view.root, "Damage (FP)");
    await type(damage, "-30");
    await until(() => started, "the first edit is waiting before applying");
    deepEqual(view.doc.serialize(), fireball);
    await type(damage, "12");
    ack.emit("release");
    await settle();
    equal(view.doc.getSnapshot().edits.length, 2, "both gestures reached the document in order");
    await act(() => button(view.root, "Save").click());
    await settle();
    deepEqual(view.host.bytesOf(SPC), fireball, "the last value the author typed reaches disk");
  } finally { ack.emit("release"); view.dispose(); }
});

test("typing while a description acknowledgement is held inherits the already submitted separators", async () => {
  const bytesWith = (text: string): Uint8Array => Uint8Array.from([...fireball.slice(0, 0x43), ...Buffer.from(text, "latin1"), 0]);
  const ack = new EventEmitter();
  const held = once(ack, "release");
  let applied = false;
  const view = await mountWithPending({ [SPC]: bytesWith("A\rB\nC"), [STE]: burn }, undefined, async (apply) => {
    const result = apply();
    applied = true;
    await held;
    return result;
  });
  try {
    const area = view.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]');
    ok(area);
    await editDescription(area, "A\n\nC", 2, "deleteContentBackward");
    await act(() => { area.dispatchEvent(new Event("change", { bubbles: true })); });
    await until(() => applied, "the blank line edit was accepted but its acknowledgement is held");
    deepEqual(view.doc.serialize(), bytesWith("A\r\rC"));
    await editDescription(area, "A\nX\nC", 3, "insertText");
    await act(() => { area.dispatchEvent(new Event("change", { bubbles: true })); });
    ack.emit("release");
    await settle();
    deepEqual(view.doc.serialize(), bytesWith("A\rX\rC"), "the already queued edit uses the newly accepted separators");
    await act(() => button(view.root, "Save").click());
    await settle();
    deepEqual(view.host.bytesOf(SPC), bytesWith("A\rX\rC"));
  } finally { ack.emit("release"); view.dispose(); }
});

test("a discarded textarea branch still supplies exact separator bytes to document Undo", async () => {
  const bytesWith = (text: string): Uint8Array => Uint8Array.from([...fireball.slice(0, 0x43), ...Buffer.from(text, "latin1"), 0]);
  const ack = new EventEmitter();
  const held = once(ack, "release");
  let applied = false;
  const view = await mountWithPending({ [SPC]: bytesWith("A\rB\nC"), [STE]: burn }, undefined, async (apply) => {
    const result = apply();
    applied = true;
    await held;
    return result;
  });
  try {
    const area = view.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]');
    ok(area);
    const blur = async (): Promise<void> => { await act(() => { area.dispatchEvent(new Event("change", { bubbles: true })); }); };
    await editDescription(area, "A\n\nC", 2, "deleteContentBackward");
    await blur();
    await until(() => applied, "the blank line edit applied before acknowledgement");
    deepEqual(view.doc.serialize(), bytesWith("A\r\rC"));

    await editDescription(area, "A\nX\nC", 3, "insertText");
    await blur();
    await editDescription(area, "A\n\nC", 2, "historyUndo");
    await editDescription(area, "A\nY\nC", 3, "insertText");
    await blur();
    ack.emit("release");
    await settle();
    deepEqual(view.doc.serialize(), bytesWith("A\rY\rC"));
    equal(view.doc.getSnapshot().edits.length, 3, "both blurs entered document history, despite the textarea's Undo");

    await act(() => { ok(view.doc.undo().ok); });
    await settle();
    await act(() => button(view.root, "Save").click());
    await settle();
    deepEqual(view.host.bytesOf(SPC), bytesWith("A\rX\rC"), "document Undo restores the queued edit and both accepted CR separators");
  } finally { ack.emit("release"); view.dispose(); }
});

test("a rejected description acknowledgement leaves newer typing and original separators intact", async () => {
  const bytesWith = (text: string): Uint8Array => Uint8Array.from([...fireball.slice(0, 0x43), ...Buffer.from(text, "latin1"), 0]);
  const original = bytesWith("A\rB\nC");
  const ack = new EventEmitter();
  const held = once(ack, "release");
  let refused = false;
  const view = await mountWithPending({ [SPC]: original, [STE]: burn }, undefined, async (apply) => {
    const result = apply();
    if (!result.ok) {
      refused = true;
      await held;
    }
    return result;
  });
  try {
    const area = view.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]');
    ok(area);
    await editDescription(area, "A\n\nC", 2, "deleteContentBackward");
    await editDescription(area, "A\n\nC🙂", 6, "insertText");
    await act(() => { area.dispatchEvent(new Event("change", { bubbles: true })); });
    await until(() => refused, "the document refused the unencodable text but has not responded yet");
    deepEqual(view.doc.serialize(), original);

    await editDescription(area, "A\n\nC", 4, "deleteContentBackward");
    await editDescription(area, "A\nX\nC", 3, "insertText");
    await act(() => { area.dispatchEvent(new Event("change", { bubbles: true })); });
    ack.emit("release");
    await settle();
    await act(() => button(view.root, "Save").click());
    await settle();
    deepEqual(view.host.bytesOf(SPC), bytesWith("A\rX\nC"));
  } finally { ack.emit("release"); view.dispose(); }
});

test("using the version on disk clears refused text from both views of a move", async () => {
  const view = await mountWithPending({ [SPC]: fireball, [STE]: burn });
  const sibling = document.createElement("div");
  document.body.append(sibling);
  const handle = mount(sibling, { document: view.doc, services: view.host, pendingEdits: view.pendingEdits });
  try {
    await type(field(view.root, "Damage (FP)"), "-30");
    await type(field(sibling, "Damage (FP)"), "9999999999");
    const external = fireball.slice();
    new DataView(external.buffer).setInt32(FP, 99, true);
    view.host.seed(SPC, external);
    equal(await view.doc.checkExternal(), "conflict");
    await settle();
    await act(() => button(view.root, "Use the version on disk").click());
    await settle();
    equal(field(sibling, "Damage (FP)").value, "99");
    ok(!view.pendingEdits.holdsDraft());
    equal(sibling.querySelector("[role=alert]"), null);
    await type(field(view.root, "Damage (FP)"), "-31");
    await act(() => button(view.root, "Save").click());
    await settle();
    equal(new DataView(view.host.bytesOf(SPC)!.buffer).getInt32(FP, true), -31);
  } finally { handle.dispose(); sibling.remove(); view.dispose(); }
});

test("a listing miss cannot fall back to a host's Unicode-folding read", async () => {
  const lower = "StatusE/café.ste";
  const host = createMemoryPlatformServices({ files: { [SPC]: fireball, [lower]: burn } });
  const opened = await openSpecialMoveDocument(host.fs, createDocumentIdentity("memory-project", SPC));
  ok(opened.ok);
  const reads: string[] = [];
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: opened.document,
    services: { ...host, fs: { ...host.fs, readProject: (project, path) => {
      reads.push(path);
      return host.fs.readProject(project, /caf[éÉ]\.ste$/i.test(path) ? lower : path);
    } } },
    navigation: { open: async () => null },
  });
  try {
    await type(field(root, "Status effect file"), "CAFÉ.ste");
    await until(() => root.textContent?.includes("CAFÉ.ste is not in the project") === true, "the ASCII resolver reports the file missing");
    equal(reads.some((path) => /caf[éÉ]\.ste$/i.test(path)), false, "no raw read can reopen the missing reference");
    equal(button(root, "Open status effect").disabled, true);
  } finally { handle.dispose(); root.remove(); }
});
