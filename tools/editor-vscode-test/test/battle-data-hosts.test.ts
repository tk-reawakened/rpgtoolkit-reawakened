// Story 13.10 (T-57, T-58) in every host: a special move and a status effect are opened from their files, edited through
// their forms, saved by the host's own save, closed and reopened. The file holds exactly the bytes patched by hand at the
// offsets of the committed annotated listings (docs/spec/examples/listings/fireball.spc.txt, burn.ste.txt), and the
// reopened form shows the signed values and the inverted usability flag. The browser host and VS Code (desktop and web
// builds) run the same steps.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { CharacterProofHost, CharacterProofTab } from "../conformance/suite.ts";
// The drivers read the DOM when they mount, so they are imported once the DOM shim exists.
import type * as WebHost from "../conformance/web-host.ts";
import type * as VscodeHost from "../conformance/vscode-host.ts";
import { settle, type Act } from "../conformance/view.ts";

const gam = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const example = (path: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../docs/spec/examples/game/Game/Example/${path}`, import.meta.url)));
const SPC = "SpcMove/fireball.spc";
const STE = "StatusE/burn.ste";
const fireball = example(SPC);
const burn = example(STE);
const FILES = { [SPC]: fireball, [STE]: burn };
// fireball.spc: fp 0x1e (i32), battle 0x37, menu 0x38. burn.ste: slow 0x1e, hpAmount 0x24 (i16).
const patched = (original: Uint8Array, edits: Readonly<Record<number, readonly number[]>>): Uint8Array => {
  const copy = original.slice();
  for (const [at, bytes] of Object.entries(edits)) copy.set(bytes, Number(at));
  return copy;
};
const MOVE_EDITED = patched(fireball, { 0x1e: [0xe2, 0xff, 0xff, 0xff], 0x37: [0], 0x38: [1] });
const STATUS_EDITED = patched(burn, { 0x24: [0xfb, 0xff], 0x1e: [1, 0] });

interface Entry {
  readonly name: string;
  make(): CharacterProofHost;
}

let act: Act;
let entries: readonly Entry[] = [];

before(async () => {
  GlobalRegistrator.register();
  const { act: preactAct } = await import("preact/test-utils");
  let queue: Promise<void> = Promise.resolve();
  act = (callback) => {
    const run = queue.then(() => preactAct(callback));
    queue = run.catch(() => undefined);
    return run;
  };
  const { createWebCharacterProofHost }: typeof WebHost = await import("../conformance/web-host.ts");
  const { createVscodeCharacterProofHost }: typeof VscodeHost = await import("../conformance/vscode-host.ts");
  entries = [
    { name: "browser host", make: () => createWebCharacterProofHost(gam, FILES, act) },
    { name: "VS Code desktop", make: () => createVscodeCharacterProofHost(true, gam, FILES, act) },
    { name: "VS Code for the Web", make: () => createVscodeCharacterProofHost(false, gam, FILES, act) },
  ];
});

after(() => GlobalRegistrator.unregister());

async function until(done: () => boolean, message: string): Promise<void> {
  for (let round = 0; round < 400 && !done(); round += 1) await settle(act, 1);
  ok(done(), message);
}

const field = (tab: CharacterProofTab, label: string): HTMLInputElement => {
  const found = tab.element.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (found === null) throw new Error(`no field named ${label}: ${tab.element.textContent}`);
  return found;
};

/** Type `value` into the field and leave it, which is what submits the edit. */
async function type(tab: CharacterProofTab, label: string, value: string): Promise<void> {
  const input = field(tab, label);
  await act(() => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle(act);
}

async function toggle(tab: CharacterProofTab, label: string): Promise<void> {
  const box = field(tab, label);
  await act(() => { box.checked = !box.checked; box.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle(act);
}

async function openReady(host: CharacterProofHost, path: string, label: string): Promise<CharacterProofTab> {
  const tab = await host.open(path);
  await until(() => tab.element.querySelector(`input[aria-label="${label}"]`) !== null, `the form for ${path} is shown`);
  return tab;
}

const same = (left: Uint8Array | null, right: Uint8Array): boolean => left !== null && left.length === right.length && left.every((byte, index) => byte === right[index]);

for (const entry of ["browser host", "VS Code desktop", "VS Code for the Web"]) {
  describe(`special move and status effect forms through the host's own save: ${entry}`, () => {
    const host = (): CharacterProofHost => {
      const found = entries.find((candidate) => candidate.name === entry);
      if (found === undefined) throw new Error(`no ${entry} driver`);
      document.body.replaceChildren();
      return found.make();
    };

    test("a special move's signed damage and inverted usable boxes are written by the host's save, and the reopened form shows them", async () => {
      const proof = host();
      const tab = await openReady(proof, SPC, "Damage (FP)");
      equal(field(tab, "Damage (FP)").value, "12");
      equal(field(tab, "Usable in battle").checked, false, "stored battle byte 1 is not usable");
      equal(field(tab, "Usable from the menu").checked, true, "stored menu byte 0 is usable");
      await type(tab, "Damage (FP)", "-30");
      await toggle(tab, "Usable in battle");
      await toggle(tab, "Usable from the menu");
      equal(tab.workbenchDirty(), true, "the edits reached the shared document");
      ok(same(await proof.disk(SPC), fireball), "nothing is written before the host saves");
      equal(await tab.saveFromWorkbench(), true);
      await settle(act);
      ok(same(await proof.disk(SPC), MOVE_EDITED), "exactly the damage and the two flag bytes changed");
      equal(tab.workbenchDirty(), false);
      equal(await tab.close("discard"), true);

      const reopened = await openReady(proof, SPC, "Damage (FP)");
      equal(field(reopened, "Damage (FP)").value, "-30");
      equal(field(reopened, "Usable in battle").checked, true);
      equal(field(reopened, "Usable from the menu").checked, false);
      deepEqual(await reopened.backupBytes(), MOVE_EDITED);
    });

    test("a status effect's flags, signed HP amount and kept bytes are written by the host's save, and the reopened form shows them", async () => {
      const proof = host();
      const tab = await openReady(proof, STE, "HP per round");
      equal(field(tab, "HP per round").value, "2");
      equal(field(tab, "Slow down").checked, false);
      await type(tab, "HP per round", "-5");
      await toggle(tab, "Slow down");
      equal(await tab.saveFromWorkbench(), true);
      await settle(act);
      ok(same(await proof.disk(STE), STATUS_EDITED), "exactly the HP amount and the slow flag changed");
      equal(await tab.close("discard"), true);

      const reopened = await openReady(proof, STE, "HP per round");
      equal(field(reopened, "HP per round").value, "-5");
      equal(field(reopened, "Slow down").checked, true);
      ok(reopened.element.textContent?.includes("Heals 5 HP each round"));
    });

    test("a value that does not fit refuses the host's own save with its reason and writes nothing", async () => {
      const proof = host();
      const tab = await openReady(proof, SPC, "Damage (FP)");
      await type(tab, "Damage (FP)", "9999999999");
      ok(tab.element.textContent?.includes("whole number from -2147483648 to 2147483647"));
      // Both hosts treat the host's own save as explicit: a field the file cannot store refuses it with its reason.
      equal(await tab.saveFromWorkbench(), false, "the host's save is refused");
      ok(same(await proof.disk(SPC), fireball), "nothing was written");
      ok(tab.element.textContent?.includes("whole number from -2147483648 to 2147483647"), "and the field keeps its reason");
    });

    const damageOnDisk = async (proof: CharacterProofHost): Promise<number | null> => {
      const bytes = await proof.disk(SPC);
      return bytes === null ? null : new DataView(bytes.buffer, bytes.byteOffset).getInt32(0x1e, true);
    };
    const typeWithoutLeaving = async (tab: CharacterProofTab, label: string, value: string): Promise<void> => {
      const input = field(tab, label);
      await act(() => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); });
      await settle(act);
    };

    test("a field still being typed in is applied by the host's own explicit save; a clean document is not offered to VS Code's Save All, which only the browser can reach (#3385)", async () => {
      const proof = host();
      const tab = await openReady(proof, SPC, "Damage (FP)");
      await typeWithoutLeaving(tab, "Damage (FP)", "-30");
      equal(tab.workbenchDirty(), false, "typing never touches the host's undo history or dirty marker: VS Code accepts only an undoable edit event");
      equal(await damageOnDisk(proof), 12, "nothing is written by typing");
      equal(await tab.saveAllFromWorkbench(), true);
      await settle(act);
      if (proof.name === "browser host") {
        equal(await damageOnDisk(proof), -30, "the browser's Save All settles every document, so it writes the typed damage");
      } else {
        // The one condition no host contract reaches: VS Code skips a document it shows as clean, and the API forbids
        // firing a no-undo change for one (#3385). The text stays on screen; the form's Save and Ctrl/Cmd+S apply it.
        equal(await damageOnDisk(proof), 12, "VS Code's Save All skipped the clean document");
        equal(field(tab, "Damage (FP)").value, "-30", "and the text is still there");
      }
      equal(await tab.saveFromWorkbench(), true, "the provider's own save, which VS Code calls for a dirty document, applies it");
      await settle(act);
      equal(await damageOnDisk(proof), -30, "the typed damage was written");
    });

    const draftBesideAcceptedEdit = async (proof: CharacterProofHost): Promise<CharacterProofTab> => {
      const tab = await openReady(proof, SPC, "Damage (FP)");
      await type(tab, "Damage (FP)", "-30");
      await typeWithoutLeaving(tab, "Damage (FP)", "9999999999");
      return tab;
    };

    test("which VS Code saves refuse a field that cannot be stored follows files.autoSave and the timer's earliest moment (#3385)", async () => {
      if (entry === "browser host") return;
      const proof = host();
      proof.configureAutoSave?.("afterDelay", 60_000);
      proof.setClock?.(1_000);
      const tab = await draftBesideAcceptedEdit(proof);
      proof.setClock?.(6_000);
      equal(await tab.saveFromWorkbench(), false, "before the delay no timer can have fired: the author's save is refused");
      equal(await damageOnDisk(proof), 12, "and nothing was written");
      proof.setClock?.(61_500);
      equal(await tab.saveFromWorkbench(), true, "in the second after the delay it is taken for the timer's, and saves only the accepted edit");
      await settle(act);
      equal(await damageOnDisk(proof), -30);
      equal(field(tab, "Damage (FP)").value, "9999999999", "leaving the text with the author");
      proof.setClock?.(80_000);
      equal(await tab.saveFromWorkbench(), false, "long after the delay the timer would already have fired: the author's save is refused");
    });

    test("an autosave on focus or window change saves the accepted edits and leaves a text that cannot be stored alone (#3385)", async () => {
      if (entry === "browser host") return;
      for (const mode of ["onFocusChange", "onWindowChange"] as const) {
        const proof = host();
        proof.configureAutoSave?.(mode);
        const tab = await draftBesideAcceptedEdit(proof);
        equal(await tab.saveFromWorkbench(), true, `${mode}: not refused for text that is not the document's`);
        await settle(act);
        equal(await damageOnDisk(proof), -30, `${mode}: the accepted edit was written`);
        equal(field(tab, "Damage (FP)").value, "9999999999", `${mode}: the text stays`);
      }
    });
  });
}
