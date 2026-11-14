// #1716, #2609 and #2613 in the real hosts: accepted character edits are submitted to their document immediately, while
// acknowledgements may still be held. Host save, close and backup operate on the shared document; bytes on disk and a
// reopened view prove the result. Nothing here sleeps: acknowledgements are held and released.
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
  make(controlSettleTimers?: boolean): CharacterProofHost;
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
    { name: "VS Code desktop", make: (controlled) => createVscodeCharacterProofHost(true, gam, FILES, act, { controlSettleTimers: controlled === true }) },
    { name: "VS Code for the Web", make: (controlled) => createVscodeCharacterProofHost(false, gam, FILES, act, { controlSettleTimers: controlled === true }) },
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

/** The fixture's character is already named Ada, so these are real edits. Both commands are sent while their acknowledgements are held. */
async function holdTwoEdits(tab: CharacterProofTab): Promise<{ release(): void }> {
  const hold = tab.holdEditAcknowledgements();
  await edit(tab, "Character name", "Ada Lovelace");
  await edit(tab, "Health (HP)", "123");
  await settle(act);
  return hold;
}

async function applyMove(tab: CharacterProofTab): Promise<void> {
  const button = [...tab.element.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.getAttribute("aria-label") === "Apply special-move slot 1");
  ok(button !== undefined, "the first special-move slot has an apply action");
  await act(() => { button.click(); });
  await settle(act);
}

async function moveField(tab: CharacterProofTab, field: "condVar" | "minLevel"): Promise<string> {
  const label = field === "condVar" ? "Condition variable" : "Minimum level";
  return input(tab, label).value;
}

for (const name of ["browser host", "VS Code desktop", "VS Code for the Web"]) {
  describe(`character edits through the host's own save and close: ${name}`, () => {
    const host = (controlSettleTimers?: boolean): CharacterProofHost => {
      const found = entries.find((candidate) => candidate.name === name);
      if (found === undefined) throw new Error(`no ${name} driver`);
      document.body.replaceChildren();
      return found.make(controlSettleTimers);
    };

    test("the host's save waits for both submitted edits while acknowledgements are held, writes both, and the reopened view shows them", async () => {
      const proof = host();
      const tab = await openReady(proof);
      const hold = await holdTwoEdits(tab);
      equal(tab.workbenchDirty(), true, "the first edit reached the document");

      const saving = tab.saveFromWorkbench();
      await settle(act);
      ok(same(await proof.disk(PATH), ORIGINAL), "nothing is written while the edit acknowledgements are still held");

      hold.release();
      equal(await saving, true);
      await settle(act);
      const written = saved(await proof.disk(PATH));
      equal(written.name, "Ada Lovelace");
      equal(written.hp, 123);
      equal(tab.workbenchDirty(), false, "the host marks saved only after both edits were written");
      equal(await tab.close("cancel"), true, "a saved document closes without asking");
      await settle(act);

      const reopened = await openReady(proof);
      equal(input(reopened, "Character name").value, "Ada Lovelace");
      equal(input(reopened, "Health (HP)").value, "123");
      equal(reopened.workbenchDirty(), false);
      await reopened.close("discard");
    });

    test("closing and choosing Save writes both submitted edits while acknowledgements are held", async () => {
      const proof = host();
      const tab = await openReady(proof);
      const hold = await holdTwoEdits(tab);

      const closing = tab.close("save");
      await settle(act);
      ok(same(await proof.disk(PATH), ORIGINAL), "the close waits for the held acknowledgements before writing");

      hold.release();
      equal(await closing, true);
      await settle(act);
      const written = saved(await proof.disk(PATH));
      equal(written.name, "Ada Lovelace");
      equal(written.hp, 123);

      const reopened = await openReady(proof);
      equal(input(reopened, "Character name").value, "Ada Lovelace");
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

    test("the character view says it cannot open linked .prg and .spc files, and offers no Open action (#2609)", async () => {
      const proof = host();
      const tab = await openReady(proof);
      equal(tab.element.querySelector('button[aria-label="Open level-up program"]'), null);
      equal(tab.element.querySelector('button[aria-label="Open special-move file"]'), null);
      const notice = tab.element.querySelector('[aria-label="Linked authoring availability"]')?.textContent ?? "";
      ok(notice.includes("cannot open linked") && notice.includes(".prg") && notice.includes(".spc"), notice);
      await tab.close("discard");
    });
  });
}

for (const name of ["VS Code desktop", "VS Code for the Web"]) {
  describe(`character edits through VS Code's backup and a webview that does not answer: ${name}`, () => {
    const host = (controlSettleTimers?: boolean): CharacterProofHost => {
      const found = entries.find((candidate) => candidate.name === name);
      if (found === undefined) throw new Error(`no ${name} driver`);
      document.body.replaceChildren();
      return found.make(controlSettleTimers);
    };

    test("a nonfinal view can close with held acknowledgements and its sibling still saves every accepted edit (#2652)", async () => {
      const proof = host();
      const first = await openReady(proof);
      const acknowledgements = await holdTwoEdits(first);
      try {
        const sibling = await openReady(proof);
        equal(input(sibling, "Character name").value, "Ada Lovelace");
        equal(input(sibling, "Health (HP)").value, "123");

        // The same document stays open in sibling, so VS Code closes this dirty tab without a save prompt.
        equal(await first.close("cancel"), true);
        equal(await sibling.saveFromWorkbench(), true);
        await settle(act);
        const written = saved(await proof.disk(PATH));
        equal(written.name, "Ada Lovelace");
        equal(written.hp, 123);
        await sibling.close("cancel");
      } finally {
        acknowledgements.release();
      }
    });
    test("independent move-field edits from two views preserve each other's values (#2687)", async () => {
      const proof = host();
      const first = await openReady(proof);
      const sibling = await openReady(proof);
      const acknowledgements = first.holdEditAcknowledgements();
      try {
        await edit(first, "Special-move file", "SpcMove/flare.spc");
        await applyMove(first);
        await edit(sibling, "Condition variable", "quest_flag");
        await applyMove(sibling);
        await edit(first, "Minimum level", "9");
        await applyMove(first);

        equal(await moveField(sibling, "condVar"), "quest_flag");
        equal(await moveField(sibling, "minLevel"), "9");
        acknowledgements.release();
        await settle(act);
        equal(await sibling.saveFromWorkbench(), true);
        const written = await proof.disk(PATH);
        ok(written !== null, "the edited character was written");
        const decoded = readCharacter(new BinaryReader(written));
        ok(decoded.ok, "the written file is a character");
        equal(decoded.value.specialMoves[0]?.condVar, "quest_flag");
        equal(decoded.value.specialMoves[0]?.minLevel, 9);
        await first.close("cancel");
        await sibling.close("cancel");
      } finally {
        acknowledgements.release();
      }
    });

    test("a hot-exit backup includes edits submitted while the view awaits acknowledgements", async () => {
      const proof = host();
      const tab = await openReady(proof);
      const hold = await holdTwoEdits(tab);
      const backing = tab.backupBytes();
      await settle(act);
      hold.release();
      const backup = saved(await backing);
      equal(backup.name, "Ada Lovelace");
      equal(backup.hp, 123);
      await tab.close("discard");
    });

    test("a save refuses while an acknowledgement is held, and succeeds once it arrives", async () => {
      const proof = host(true);
      const expire = proof.expireSettleTimers;
      ok(expire !== undefined, "this host lets the proof end the wait by hand");
      const tab = await openReady(proof);
      const hold = await holdTwoEdits(tab);
      const refused = tab.saveFromWorkbench();
      // The save is waiting on the held edit; the bound running out is signalled by hand, not by elapsed time.
      await settle(act);
      expire();
      equal(await refused, false, "the save does not claim success for an edit it could not include");
      ok(same(await proof.disk(PATH), ORIGINAL), "nothing was written");
      equal(tab.workbenchDirty(), true, "the document stays dirty");

      hold.release();
      await settle(act);
      equal(await tab.saveFromWorkbench(), true);
      await settle(act);
      const written = saved(await proof.disk(PATH));
      equal(written.name, "Ada Lovelace");
      equal(written.hp, 123);
      equal(tab.workbenchDirty(), false);
      await tab.close("discard");
    });
  });
}
