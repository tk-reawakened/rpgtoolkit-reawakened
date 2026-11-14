// #1716, #2609 and #2613 in the real hosts: a character edit the view has accepted but not yet handed to its document
// (queued behind an acknowledgement that is held) is saved, backed up and asked about by the host's own save, close and
// backup, and the bytes on disk and the reopened view prove it. The browser host's workspace and VS Code's provider
// behind its webview bridge each run every case. Nothing here sleeps: acknowledgements are held and released.
import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { BinaryReader, readCharacter } from "@tk-reawakened/core";
import type { CharacterProofHost, CharacterProofTab } from "../conformance/suite.ts";
import { settle, type Act } from "../conformance/view.ts";

const PATH = "Chrs/ada.tem";
const gam = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const ORIGINAL = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/character/character_minor8.tem", import.meta.url)));
const FILES = { [PATH]: ORIGINAL };

interface Entry {
  readonly name: string;
  make(settleTimeoutMs?: number): CharacterProofHost;
}

let act: Act;
let entries: readonly Entry[] = [];

before(async () => {
  GlobalRegistrator.register();
  // Preact and the hosts read the DOM when they render, so they are imported once the shim is in place.
  const { act: preactAct } = await import("preact/test-utils");
  let queue: Promise<void> = Promise.resolve();
  act = (callback) => {
    const run = queue.then(() => preactAct(callback));
    queue = run.catch(() => undefined);
    return run;
  };
  const { createWebCharacterProofHost } = await import("../conformance/web-host.ts");
  const { createVscodeCharacterProofHost } = await import("../conformance/vscode-host.ts");
  entries = [
    { name: "browser host", make: () => createWebCharacterProofHost(gam, FILES, act) },
    { name: "VS Code desktop", make: (timeout) => createVscodeCharacterProofHost(true, gam, FILES, act, timeout === undefined ? {} : { settleTimeoutMs: timeout }) },
    { name: "VS Code for the Web", make: (timeout) => createVscodeCharacterProofHost(false, gam, FILES, act, timeout === undefined ? {} : { settleTimeoutMs: timeout }) },
  ];
});

after(() => GlobalRegistrator.unregister());

const input = (tab: CharacterProofTab, label: string): HTMLInputElement => {
  const found = tab.element.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (found === null) throw new Error(`no input named ${label}: ${tab.element.textContent}`);
  return found;
};

/** Type `value` into the field and leave it, which is what submits the edit. */
async function edit(tab: CharacterProofTab, label: string, value: string): Promise<void> {
  const field = input(tab, label);
  await act(() => {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => { field.dispatchEvent(new Event("blur", { bubbles: true })); });
}

async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 400 && !done(); round += 1) await settle(act, 1);
  ok(done(), "the host did what the view asked");
}

async function openReady(host: CharacterProofHost): Promise<CharacterProofTab> {
  const tab = await host.open(PATH);
  await until(() => tab.element.querySelector('input[aria-label="Character name"]') !== null);
  return tab;
}

function saved(bytes: Uint8Array | null): { readonly name: string; readonly hp: number } {
  ok(bytes !== null, "the file exists");
  const read = readCharacter(new BinaryReader(bytes));
  ok(read.ok, "the file is a character");
  return { name: read.value.name, hp: read.value.stats.hp };
}

const same = (left: Uint8Array | null, right: Uint8Array): boolean => left !== null && left.length === right.length && left.every((byte, index) => byte === right[index]);

/** A is with the document and its acknowledgement is held; B was accepted after it and waits in the view. */
async function holdTwoEdits(tab: CharacterProofTab): Promise<{ release(): void }> {
  const hold = tab.holdEditAcknowledgements();
  await edit(tab, "Character name", "Ada");
  await edit(tab, "Health (HP)", "123");
  await settle(act);
  return hold;
}

for (const name of ["browser host", "VS Code desktop", "VS Code for the Web"]) {
  describe(`character edits through the host's own save and close: ${name}`, () => {
    const host = (timeout?: number): CharacterProofHost => {
      const found = entries.find((candidate) => candidate.name === name);
      if (found === undefined) throw new Error(`no ${name} driver`);
      document.body.replaceChildren();
      return found.make(timeout);
    };

    test("the host's save waits for an edit queued behind a held acknowledgement, writes both, and the reopened view shows them", async () => {
      const proof = host();
      const tab = await openReady(proof);
      const hold = await holdTwoEdits(tab);
      equal(tab.workbenchDirty(), true, "the first edit reached the document");

      const saving = tab.saveFromWorkbench();
      await settle(act);
      ok(same(await proof.disk(PATH), ORIGINAL), "nothing is written while the view still holds an edit: that save would have left it out");

      hold.release();
      equal(await saving, true);
      await settle(act);
      const written = saved(await proof.disk(PATH));
      equal(written.name, "Ada");
      equal(written.hp, 123);
      equal(tab.workbenchDirty(), false, "the host marks saved only after both edits were written");
      equal(await tab.close("cancel"), true, "a saved document closes without asking");
      await settle(act);

      const reopened = await openReady(proof);
      equal(input(reopened, "Character name").value, "Ada");
      equal(input(reopened, "Health (HP)").value, "123");
      equal(reopened.workbenchDirty(), false);
      await reopened.close("discard");
    });

    test("closing and choosing Save writes an edit still queued in the view, and the reopened view shows it", async () => {
      const proof = host();
      const tab = await openReady(proof);
      const hold = await holdTwoEdits(tab);

      const closing = tab.close("save");
      await settle(act);
      ok(same(await proof.disk(PATH), ORIGINAL), "the close is waiting for the queued edit, not discarding it");

      hold.release();
      equal(await closing, true);
      await settle(act);
      const written = saved(await proof.disk(PATH));
      equal(written.name, "Ada");
      equal(written.hp, 123);

      const reopened = await openReady(proof);
      equal(input(reopened, "Character name").value, "Ada");
      equal(input(reopened, "Health (HP)").value, "123");
      await reopened.close("discard");
    });

    test("closing and choosing Don't Save discards both edits, as the user chose, and the file keeps its bytes", async () => {
      const proof = host();
      const tab = await openReady(proof);
      const hold = await holdTwoEdits(tab);
      const closing = tab.close("discard");
      hold.release();
      equal(await closing, true);
      await settle(act);
      ok(same(await proof.disk(PATH), ORIGINAL));
    });

    test("the character view says that linked .prg and .spc files cannot be opened from it, and offers no action that would fail (#2609)", async () => {
      const proof = host();
      const tab = await openReady(proof);
      equal(tab.element.querySelector('button[aria-label="Open level-up program"]'), null);
      equal(tab.element.querySelector('button[aria-label="Open special-move file"]'), null);
      const notice = tab.element.querySelector('[aria-label="Linked authoring availability"]')?.textContent ?? "";
      ok(notice.includes(".prg") && notice.includes(".spc") && notice.includes("not available"), notice);
      await tab.close("discard");
    });
  });
}

for (const name of ["VS Code desktop", "VS Code for the Web"]) {
  describe(`character edits through VS Code's backup and a webview that does not answer: ${name}`, () => {
    const host = (timeout?: number): CharacterProofHost => {
      const found = entries.find((candidate) => candidate.name === name);
      if (found === undefined) throw new Error(`no ${name} driver`);
      document.body.replaceChildren();
      return found.make(timeout);
    };

    test("a hot-exit backup includes an edit still queued in the view", async () => {
      const proof = host();
      const tab = await openReady(proof);
      const hold = await holdTwoEdits(tab);
      const backing = tab.backupBytes();
      await settle(act);
      hold.release();
      const backup = saved(await backing);
      equal(backup.name, "Ada");
      equal(backup.hp, 123);
      await tab.close("discard");
    });

    test("a save refuses, with the edits kept unsaved, when the view cannot hand over its queued edit in time, and succeeds once it can", async () => {
      const proof = host(5);
      const tab = await openReady(proof);
      const hold = await holdTwoEdits(tab);
      equal(await tab.saveFromWorkbench(), false, "the save does not claim success for an edit it could not include");
      ok(same(await proof.disk(PATH), ORIGINAL), "nothing was written");
      equal(tab.workbenchDirty(), true, "the document stays dirty");

      hold.release();
      await settle(act);
      equal(await tab.saveFromWorkbench(), true);
      await settle(act);
      const written = saved(await proof.disk(PATH));
      equal(written.name, "Ada");
      equal(written.hp, 123);
      equal(tab.workbenchDirty(), false);
      await tab.close("discard");
    });
  });
}
