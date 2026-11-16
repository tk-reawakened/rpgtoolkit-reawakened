// The History panel (ADR 0022 D12.6, D12.10) over a real workspace, real documents and the memory host, rendered under the
// DOM shim. Assertions are on what a creator sees and on the bytes in the project.
import { setImmediate as yieldTurn } from "node:timers/promises";
import { after, before, test } from "node:test";
import { equal, match, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentWorkspace, type AnyDocument, type DocumentWorkspace } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { ViewDocument } from "../src/mount.ts";
import { exampleMain, titleOf } from "./fixtures.ts";

const PATH = "Main/example.gam";

type Mount = typeof import("@tk-reawakened/editor-ui").mount;
type MountHistory = typeof import("@tk-reawakened/editor-ui").mountHistory;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;
let mount: Mount;
let mountHistory: MountHistory;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mount, mountHistory } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

// Web Crypto answers on a later event-loop turn than a microtask, so settling yields to the loop (no timer, no duration).
async function settle(): Promise<void> {
  await act(async () => { for (let turn = 0; turn < 60; turn += 1) await yieldTurn(); });
}

const buttonWith = (root: HTMLElement, text: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));
  if (found === undefined) throw new Error(`no button with "${text}" in: ${root.textContent}`);
  return found;
};

async function clickRow(root: HTMLElement, text: string): Promise<void> {
  const row = [...root.querySelectorAll("ol[aria-label='History entries'] button")].find((candidate) => candidate.textContent?.includes(text));
  if (row === undefined) throw new Error(`no timeline row with "${text}"`);
  await act(() => { (row as HTMLButtonElement).click(); });
  await settle();
}

async function click(root: HTMLElement, text: string): Promise<void> {
  await act(() => { buttonWith(root, text).click(); });
  await settle();
}

interface Fixture {
  readonly host: MemoryPlatformServices;
  readonly workspace: DocumentWorkspace;
  readonly document: AnyDocument;
  readonly el: HTMLElement;
}

async function setUp(): Promise<Fixture> {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain(9) } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host, historyPolicy: () => ({ mergeWindowMs: 0, autoFloorMs: 1000, warnBytes: 1 << 30, maxCoveredBytes: 1 << 20 }) });
  const opened = await workspace.open(PATH);
  if (!opened.ok) throw new Error("open failed");
  const el = document.createElement("div");
  document.body.append(el);
  return { host, workspace, document: opened.document, el };
}

function show(fixture: Fixture): void {
  void act(() => {
    mountHistory(fixture.el, {
      workspace: fixture.workspace,
      files: fixture.host.fs,
      activePath: PATH,
      mountPreview: (element, preview: AnyDocument) => mount(element, { document: preview as unknown as ViewDocument, services: fixture.host }),
    });
  });
}

test("a creator browses a document's history, previews a saved version in the same editor read-only, restores it and takes the restore back", async () => {
  const fixture = await setUp();
  const original = titleOf(exampleMain(9));
  for (const title of ["First draft", "Second draft"]) {
    ok(fixture.document.apply({ type: "set-game-title", title }).ok);
    ok((await fixture.document.save("manual")).ok);
  }
  show(fixture);
  await settle();

  match(fixture.el.querySelector("[data-history-location]")?.textContent ?? "", /\.tkr-history folder/, "it says where history lives");
  const rows = [...fixture.el.querySelectorAll("ol[aria-label='History entries'] button")];
  equal(rows.length, 3, "the original, then the two saves, newest first");
  match(rows[0]!.textContent ?? "", /saved/);
  match(rows[2]!.textContent ?? "", /checkpoint/);

  await clickRow(fixture.el, "checkpoint");
  const preview = fixture.el.querySelector(".tkr-history-preview-editor");
  ok(preview !== null && preview.children.length > 0, `the same editor is mounted over the saved bytes; page: ${fixture.el.textContent}`);
  const titleField = [...fixture.el.querySelectorAll("input")].find((input) => input.value === original);
  ok(titleField !== undefined, `the preview shows the original title; page: ${fixture.el.textContent}`);
  ok(titleField.disabled || titleField.readOnly || /read-only|read only/i.test(preview.textContent ?? ""), "the preview cannot be edited");
  equal(titleOf(fixture.host.bytesOf(PATH)!), "Second draft", "previewing wrote nothing");

  await click(fixture.el, "Restore this version");
  ok(buttonWith(fixture.el, "Confirm restore") !== undefined, "restore asks first");
  equal(titleOf(fixture.host.bytesOf(PATH)!), "Second draft", "asking changed nothing");
  await click(fixture.el, "Confirm restore");
  equal(titleOf(fixture.host.bytesOf(PATH)!), original, "the project holds the restored version");
  const report = fixture.el.querySelector("[aria-label='Restore report']");
  match(report?.textContent ?? "", /Main\/example\.gam: restored/, "each file is reported separately");
  match(report?.textContent ?? "", /all-or-nothing/);

  await click(fixture.el, "Undo this restore");
  equal(titleOf(fixture.host.bytesOf(PATH)!), "Second draft", "a restore is itself restorable");
});

test("compare shows two saved versions side by side, and the comparison is read-only", async () => {
  const fixture = await setUp();
  ok(fixture.document.apply({ type: "set-game-title", title: "Other" }).ok);
  ok((await fixture.document.save("manual")).ok);
  show(fixture);
  await settle();
  await clickRow(fixture.el, "saved");
  const select = fixture.el.querySelector<HTMLSelectElement>("select[aria-label='Compare with']");
  ok(select !== null);
  await act(() => { select.value = "current"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
  equal(fixture.el.querySelectorAll(".tkr-history-preview").length, 2, `two read-only editors side by side; select=${select.value}; page: ${fixture.el.textContent}`);
});

test("a history problem is shown to the creator instead of being hidden", async () => {
  const fixture = await setUp();
  fixture.workspace.history.reportProblem(PATH, "Main/example.gam was saved, but its history could not be recorded: disk full");
  show(fixture);
  await settle();
  match(fixture.el.querySelector("[aria-label='History problems']")?.textContent ?? "", /disk full/);
});
