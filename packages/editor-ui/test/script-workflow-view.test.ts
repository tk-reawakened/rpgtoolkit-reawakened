// Story 13.16: the reviewed script workflow as an author uses it in the browser workbench. The scope question, the
// progress, the per-file opt-out, the original/result comparison, the fragments left as written, Cancel and Escape (which
// write nothing), and the apply with its failure kept on screen. The model's own rules are in
// `packages/editor-model/test/script-workflow.test.ts`.
import { after, before, test } from "node:test";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  createScriptReview,
  planScriptWorkflow,
  type ScriptTransformAnswer,
  type ScriptTransformId,
  type ScriptWorkflowEnvironment,
  type ScriptWorkflowPlan,
  type ScriptWorkflowScope,
} from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { mountScriptWorkflow as MountScriptWorkflow } from "../src/index.ts";

let mountScriptWorkflow: typeof MountScriptWorkflow;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mountScriptWorkflow } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

const bytes = (text: string): Uint8Array => Uint8Array.from(text, (ch) => ch.charCodeAt(0));
const text = (value: Uint8Array | undefined): string | undefined => (value === undefined ? undefined : String.fromCharCode(...value));

function answer(transform: ScriptTransformId, path: string, source: string, fields: Partial<ScriptTransformAnswer>): ScriptTransformAnswer {
  return { uri: `file:///${path}`, transform, status: "unchanged", text: source, dialect: "tk3", established: true, target: "in-place", steps: [], reviews: [], unsupported: [], ...fields };
}

const FILES = {
  "Prg/one.prg": "IF (x) {\nMWIN(a)\n}\n",
  "Prg/two.prg": "MWIN(b)\n",
  "Prg/legacy.prg": "#Mwin(hi)\n",
  "Prg/quote.prg": 'Say "hi"\n',
  "Prg/fine.prg": "mwin(c)\n",
};

function rig(transform: ScriptTransformId = "format") {
  const host = createMemoryPlatformServices({ files: Object.fromEntries(Object.entries(FILES).map(([path, value]) => [path, bytes(value)])) });
  const planned: ScriptWorkflowScope[] = [];
  const environment: ScriptWorkflowEnvironment = {
    fs: { ...host.fs, writeReviewed: host.fs.write },
    history: { begin: async () => { throw new Error("Script workflow must capture a reviewed batch"); }, prepareScripts: async () => ({ ok: true, groupId: "g1" }), written: async () => ({ ok: true }) },
    openPrograms: () => [],
    provider: {
      async transform(question) {
        const path = question.path;
        if (path.endsWith("one.prg") || path.endsWith("two.prg")) {
          return answer(question.transform, path, question.text, { status: "changed", text: question.text.replace(/MWIN/g, "mwin"), steps: [{ id: "format", title: "Re-indent and normalise capitalisation", applied: true }] });
        }
        if (path.endsWith("legacy.prg")) {
          return answer(question.transform, path, question.text, { status: "changed", text: 'Mwin("hi")\n', dialect: "tk2", target: "copy", reviews: [{ line: 1, index: "key", message: "[key] reads the variable key" }] });
        }
        if (path.endsWith("quote.prg")) {
          return answer(question.transform, path, question.text, { status: "refused", dialect: "tk2", target: "copy", reason: { code: "unsupported-fragments", message: "It has fragments that cannot be converted." }, unsupported: [{ line: 1, code: "dialogue-quote", message: "Loose dialogue with a double quote." }] });
        }
        return answer(question.transform, path, question.text, {});
      },
    },
  };
  return { host, environment, planned, transform };
}

async function show(options: { transform?: ScriptTransformId; active?: string | null; provider?: boolean } = {}) {
  const harness = rig(options.transform ?? "format");
  const environment: ScriptWorkflowEnvironment = options.provider === false ? { ...harness.environment, provider: null } : harness.environment;
  const el = document.createElement("div");
  document.body.append(el);
  const closed = { count: 0 };
  let session: ReturnType<typeof createScriptReview> | null = null;
  await act(() => {
    mountScriptWorkflow(el, {
      transform: options.transform ?? "format",
      activeProgram: options.active === undefined ? "Prg/one.prg" : options.active,
      plan: (scope, control) => {
        harness.planned.push(scope);
        return planScriptWorkflow(environment, options.transform ?? "format", scope, control);
      },
      review: (plan: ScriptWorkflowPlan) => (session = createScriptReview(environment, plan)),
      onClose: () => { closed.count += 1; },
    });
  });
  const settle = async (): Promise<void> => {
    // The memory host and the scripted server answer in microtasks; each turn lets the views render what arrived.
    for (let turn = 0; turn < 100; turn += 1) await act(async () => { await Promise.resolve(); });
  };
  const button = (name: string): HTMLButtonElement => {
    const found = [...el.querySelectorAll("button")].find((candidate) => candidate.textContent?.startsWith(name));
    if (found === undefined) throw new Error(`no button ${name}; buttons: ${[...el.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
    return found;
  };
  const click = async (name: string): Promise<void> => {
    await act(() => { button(name).click(); });
    await settle();
  };
  return { ...harness, el, closed, settle, button, click, session: () => session };
}

test("the dialog says in plain words what the workflow does and offers this program and the whole project", async () => {
  const view = await show({ transform: "update" });
  match(view.el.textContent ?? "", /Update older syntax/);
  match(view.el.textContent ?? "", /Toolkit 2\.x programs are never overwritten/);
  match(view.el.textContent ?? "", /before anything is written/);
  const radios = [...view.el.querySelectorAll<HTMLInputElement>("input[type=radio]")];
  equal(radios.length, 2);
  equal(radios[0]!.checked, true, "the open program is the default scope");
  const none = await show({ active: null });
  equal(none.el.querySelector<HTMLInputElement>("input[type=radio]")!.disabled, true, "This program needs one open");
});

test("checking a project lists every program with its state, a comparison, and the reasons for those left alone", async () => {
  const view = await show();
  await act(() => { view.el.querySelectorAll<HTMLInputElement>("input[type=radio]")[1]!.click(); });
  await view.click("Check programs");
  deepEqual(view.planned, [{ kind: "project" }]);
  const rows = [...view.el.querySelectorAll(".tkr-script-file")].map((row) => `${row.querySelector(".tkr-script-file-name")?.textContent}:${row.getAttribute("data-state")}`);
  deepEqual(rows, ["fine.prg:unchanged", "legacy.prg:ready", "one.prg:ready", "quote.prg:refused", "two.prg:ready"]);
  match(view.el.querySelector(".tkr-script-count")?.textContent ?? "", /3 of 3 changed programs are selected\. 1 left as it was/);
  await view.click("one.prg");
  // The comparison names the lines that change and folds none of a short program.
  const changes = [...view.el.querySelectorAll(".tkr-script-diff .tkr-script-line")].map((row) => `${row.getAttribute("data-change")}:${row.querySelector(".tkr-script-text")?.textContent}`);
  deepEqual(changes, ["same:IF (x) {", "removed:MWIN(a)", "added:mwin(a)", "same:}", "same:"]);
  await view.click("legacy.prg");
  match(view.el.querySelector(".tkr-script-note")?.textContent ?? "", /3\.1 version is saved as a copy at \.tkr-migrated\/3\.1\/Prg\/legacy\.prg; the original is never changed/);
  match(view.el.querySelector(".tkr-script-reviews")?.textContent ?? "", /Line 1: \[key\] reads the variable key/);
  await view.click("quote.prg");
  match(view.el.querySelector(".tkr-script-refusal")?.textContent ?? "", /cannot be converted/);
  match(view.el.querySelector(".tkr-script-unsupported")?.textContent ?? "", /Line 1: Loose dialogue with a double quote/);
  equal(view.el.querySelectorAll(".tkr-script-diff").length, 0, "a refused program shows no result to apply");
  equal(view.el.querySelectorAll<HTMLInputElement>(".tkr-script-file[data-state=refused] input").length, 0, "a refused program cannot be ticked");
});

test("unticking a program leaves it out, and Apply writes only the ones left in", async () => {
  const view = await show();
  await act(() => { view.el.querySelectorAll<HTMLInputElement>("input[type=radio]")[1]!.click(); });
  await view.click("Check programs");
  const box = (path: string): HTMLInputElement => view.el.querySelector<HTMLInputElement>(`input[aria-label="Apply to ${path}"]`)!;
  await act(() => { box("Prg/two.prg").click(); });
  equal(box("Prg/two.prg").checked, false);
  match(view.button("Apply to").textContent ?? "", /Apply to 2 programs/);
  await view.click("Apply to");
  equal(text(view.host.bytesOf("Prg/one.prg")), "IF (x) {\nmwin(a)\n}\n");
  equal(text(view.host.bytesOf("Prg/two.prg")), "MWIN(b)\n", "the unticked program is untouched");
  equal(text(view.host.bytesOf("Prg/legacy.prg")), "#Mwin(hi)\n", "the Toolkit 2.x original is untouched");
  equal(text(view.host.bytesOf(".tkr-migrated/3.1/Prg/legacy.prg")), 'Mwin("hi")\n');
  match(view.el.querySelector(".tkr-script-outcome")?.textContent ?? "", /2 programs updated \(1 converted copy written to \.tkr-migrated\/3\.1; use the copies in a separately migrated 3\.1 project\. This project and the originals are unchanged\); 1 left out; 1 refused/);
  equal(view.button("Close").textContent, "Close");
  equal(view.el.querySelector(".tkr-script-apply")?.hasAttribute("disabled"), true, "a finished review cannot apply twice");
});

test("Cancel and Escape write nothing at any stage", async () => {
  const cancel = await show();
  await act(() => { cancel.el.querySelectorAll<HTMLInputElement>("input[type=radio]")[1]!.click(); });
  await cancel.click("Check programs");
  await cancel.click("Cancel");
  equal(cancel.closed.count, 1);
  equal(cancel.session()?.getSnapshot().phase, "cancelled");
  equal(text(cancel.host.bytesOf("Prg/one.prg")), FILES["Prg/one.prg"]);
  deepEqual(cancel.host.editedEvents, []);

  const escape = await show();
  await act(() => { escape.el.querySelectorAll<HTMLInputElement>("input[type=radio]")[1]!.click(); });
  await escape.click("Check programs");
  await act(() => { escape.el.querySelector(".tkr-script-workflow")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  equal(escape.closed.count, 1);
  equal(text(escape.host.bytesOf("Prg/one.prg")), FILES["Prg/one.prg"]);

  const early = await show();
  await early.click("Cancel");
  equal(early.closed.count, 1, "cancelling before checking asks the server nothing");
  deepEqual(early.planned, []);
});

test("a failed write stays on screen with its reason and the program as it was", async () => {
  const view = await show();
  await act(() => { view.el.querySelectorAll<HTMLInputElement>("input[type=radio]")[1]!.click(); });
  await view.click("Check programs");
  view.host.failWrites({ kind: "io", message: "disk is read-only" } as never);
  await view.click("Apply to");
  match(view.el.querySelector(".tkr-script-failures")?.textContent ?? "", /disk is read-only/);
  equal(text(view.host.bytesOf("Prg/one.prg")), FILES["Prg/one.prg"], "the program is as it was");
  equal(view.closed.count, 0, "the review stays open so the failure can be read");
  ok(!view.el.querySelector(".tkr-script-apply")?.hasAttribute("disabled") || view.session()?.getSnapshot().selected === 0);
});

test("a host without a language server says so and offers only Close", async () => {
  const view = await show({ provider: false });
  await act(() => { view.el.querySelectorAll<HTMLInputElement>("input[type=radio]")[1]!.click(); });
  await view.click("Check programs");
  match(view.el.querySelector(".tkr-script-unavailable")?.textContent ?? "", /no language server/);
  equal(view.el.querySelectorAll(".tkr-script-file").length, 0);
  await view.click("Close");
  equal(view.closed.count, 1);
});

test("Escape is always heard, even when every scope choice is unavailable", async () => {
  const view = await show({ active: null, provider: false });
  equal(view.el.querySelector<HTMLInputElement>("input[type=radio]")!.disabled, true, "This program is unavailable");
  ok(document.activeElement?.closest(".tkr-script-workflow") !== null, "focus rests inside the dialog, never on the page behind it");
  await act(() => { view.el.querySelector(".tkr-script-workflow")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  equal(view.closed.count, 1);
});
