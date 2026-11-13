// The page's `dialogs` (AD-20, ADR 0022 D3.4, D3.6) under a DOM shim: a question is answered by pressing one of its
// buttons, dismissing it answers the question's `cancel`, and a Save As dialog returns what was typed or nothing.
import { equal, ok } from "node:assert/strict";
import { after, before, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createPageDialogs } from "../src/dialogs.ts";

let dialogs: ReturnType<typeof createPageDialogs>;

before(() => {
  GlobalRegistrator.register();
  dialogs = createPageDialogs(document);
});
after(() => GlobalRegistrator.unregister());

const CLOSE = {
  message: "Save the changes to Main/example.gam before closing it?",
  detail: "If you close it without saving, the changes are lost.",
  choices: [
    { id: "save", label: "Save" },
    { id: "discard", label: "Don't save" },
    { id: "cancel", label: "Cancel" },
  ],
  cancel: "cancel",
} as const;

function shownDialog(): HTMLDialogElement {
  const dialog = document.querySelector("dialog");
  ok(dialog instanceof HTMLDialogElement, "a modal dialog is in the page");
  return dialog;
}

function press(label: string): void {
  const button = [...shownDialog().querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  ok(button !== undefined, `the dialog shows "${label}"`);
  button.click();
}

test("a question is answered by the button that is pressed, and the dialog is removed", async () => {
  const answer = dialogs.ask(CLOSE);
  const dialog = shownDialog();
  equal(dialog.open, true, "shown modally");
  equal(dialog.querySelector("p")?.textContent, CLOSE.message);
  press("Don't save");
  equal(await answer, "discard");
  equal(document.querySelector("dialog"), null, "the dialog is gone once answered");
});

test("dismissing a question answers its cancel, and the page default is prevented", async () => {
  const answer = dialogs.ask(CLOSE);
  const dialog = shownDialog();
  const cancelled = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(cancelled);
  equal(cancelled.defaultPrevented, true, "the element is closed by our own code");
  equal(await answer, "cancel");
  equal(document.querySelector("dialog"), null);
});

test("a Save As dialog returns the typed path and the suggested start, or nothing when cancelled", async () => {
  const answer = dialogs.pickSavePath({ document: "Main/example.gam", suggested: "Main/example.gam" });
  const dialog = shownDialog();
  const input = dialog.querySelector("input");
  ok(input instanceof HTMLInputElement);
  equal(input.value, "Main/example.gam", "starts at the suggested path");
  input.value = "  Main/copy.gam  ";
  dialog.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
  equal(await answer, "Main/copy.gam", "surrounding space is trimmed");
  equal(document.querySelector("dialog"), null);

  const cancelled = dialogs.pickSavePath({ document: "Main/example.gam", suggested: "Main/example.gam" });
  press("Cancel");
  equal(await cancelled, null);

  const empty = dialogs.pickSavePath({ document: "Main/example.gam", suggested: "Main/example.gam" });
  const emptyDialog = shownDialog();
  const emptyInput = emptyDialog.querySelector("input");
  ok(emptyInput instanceof HTMLInputElement);
  emptyInput.value = "   ";
  emptyDialog.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
  equal(await empty, null, "an empty path is a cancel, never a write to the project root");
});
