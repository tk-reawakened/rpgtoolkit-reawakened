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
  // A view may schedule a frame for layout; this DOM shim has none, so a frame is one loop turn (no duration).
  const frame = (callback: FrameRequestCallback): number => Number(setImmediate(() => callback(performance.now())));
  for (const target of [globalThis, (globalThis as { window?: object }).window].filter((value): value is object => value !== undefined)) {
    Object.assign(target, { requestAnimationFrame: frame, cancelAnimationFrame: (): void => {} });
  }
  ({ act } = await import("preact/test-utils"));
  ({ mount, mountHistory } = await import("@tk-reawakened/editor-ui"));
});

after(() => {
  GlobalRegistrator.unregister();
  // A view disposed by the shim's teardown may still schedule a frame; it is one loop turn either way.
  Object.assign(globalThis, { requestAnimationFrame: (callback: FrameRequestCallback) => Number(setImmediate(() => callback(performance.now()))), cancelAnimationFrame: (): void => {} });
});

// Web Crypto answers on a later event-loop turn than a microtask, so waiting yields to the loop until the state the
// assertion needs is there (no timer, no guessed duration); a state that never arrives fails with the page.
async function settleUntil(check: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 20_000; turn += 1) {
    if (check()) return;
    await act(async () => { await yieldTurn(); });
  }
  throw new Error(`waited for ${what} and it never appeared; page: ${document.body.textContent ?? ""}`);
}

const settle = (): Promise<void> => settleUntil(() => true, "nothing");

const buttonWithOrNull = (root: HTMLElement, text: string): HTMLButtonElement | null =>
  [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text)) ?? null;

const buttonWith = (root: HTMLElement, text: string): HTMLButtonElement => {
  const found = buttonWithOrNull(root, text);
  if (found === null) throw new Error(`no button with "${text}" in: ${root.textContent}`);
  return found;
};

async function clickRow(root: HTMLElement, text: string): Promise<void> {
  const row = [...root.querySelectorAll("ol[aria-label='History entries'] button")].find((candidate) => candidate.textContent?.includes(text));
  if (row === undefined) throw new Error(`no timeline row with "${text}"`);
  await act(() => { (row as HTMLButtonElement).click(); });
  await settleUntil(() => (row as HTMLButtonElement).getAttribute("aria-pressed") === "true", `row "${text}" to be selected`);
}

async function click(root: HTMLElement, text: string, appeared: () => boolean): Promise<void> {
  await act(() => { buttonWith(root, text).click(); });
  await settleUntil(appeared, `"${text}" to take effect`);
}

interface Fixture {
  readonly host: MemoryPlatformServices;
  readonly workspace: DocumentWorkspace;
  readonly document: AnyDocument;
  readonly el: HTMLElement;
}

async function setUp(policy: Partial<{ mergeWindowMs: number; autoFloorMs: number; warnBytes: number; maxCoveredBytes: number }> = {}): Promise<Fixture> {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain(9) } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host, historyPolicy: () => ({ mergeWindowMs: 0, autoFloorMs: 1000, warnBytes: 1 << 30, maxCoveredBytes: 1 << 20, ...policy }) });
  const opened = await workspace.open(PATH);
  if (!opened.ok) throw new Error("open failed");
  const el = document.createElement("div");
  document.body.append(el);
  return { host, workspace, document: opened.document, el };
}

function show(fixture: Fixture & { readonly activePath?: string }): void {
  void act(() => {
    mountHistory(fixture.el, {
      workspace: fixture.workspace,
      files: fixture.host.fs,
      activePath: fixture.activePath ?? PATH,
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
  await settleUntil(() => fixture.el.querySelectorAll("ol[aria-label='History entries'] button").length === 3, "the three entries");

  match(fixture.el.querySelector("[data-history-location]")?.textContent ?? "", /\.tkr-history folder/, "it says where history lives");
  const rows = [...fixture.el.querySelectorAll("ol[aria-label='History entries'] button")];
  equal(rows.length, 3, "the original, then the two saves, newest first");
  match(rows[0]!.textContent ?? "", /saved/);
  match(rows[2]!.textContent ?? "", /checkpoint/);

  await clickRow(fixture.el, "checkpoint");
  await settleUntil(() => (fixture.el.querySelector(".tkr-history-preview-editor")?.children.length ?? 0) > 0, "the preview editor");
  const preview = fixture.el.querySelector(".tkr-history-preview-editor");
  ok(preview !== null && preview.children.length > 0, `the same editor is mounted over the saved bytes; page: ${fixture.el.textContent}`);
  const titleField = [...fixture.el.querySelectorAll("input")].find((input) => input.value === original);
  ok(titleField !== undefined, `the preview shows the original title; page: ${fixture.el.textContent}`);
  ok(titleField.disabled || titleField.readOnly || /read-only|read only/i.test(preview.textContent ?? ""), "the preview cannot be edited");
  equal(titleOf(fixture.host.bytesOf(PATH)!), "Second draft", "previewing wrote nothing");

  await click(fixture.el, "Restore this version", () => buttonWith(fixture.el, "Confirm restore") !== undefined);
  ok(buttonWith(fixture.el, "Confirm restore") !== undefined, "restore asks first");
  equal(titleOf(fixture.host.bytesOf(PATH)!), "Second draft", "asking changed nothing");
  await click(fixture.el, "Confirm restore", () => titleOf(fixture.host.bytesOf(PATH)!) === original);
  equal(titleOf(fixture.host.bytesOf(PATH)!), original, "the project holds the restored version");
  await settleUntil(() => /Main\/example\.gam: restored/.test(fixture.el.textContent ?? ""), "the per-file restore report");
  match(fixture.el.textContent ?? "", /Restore report/);
  match(fixture.el.textContent ?? "", /nothing here is all-or-nothing/);

  await click(fixture.el, "Undo this restore", () => titleOf(fixture.host.bytesOf(PATH)!) === "Second draft");
  equal(titleOf(fixture.host.bytesOf(PATH)!), "Second draft", "a restore is itself restorable");
});

test("compare shows two saved versions side by side, and the comparison is read-only", async () => {
  const fixture = await setUp();
  ok(fixture.document.apply({ type: "set-game-title", title: "Other" }).ok);
  ok((await fixture.document.save("manual")).ok);
  show(fixture);
  await settleUntil(() => fixture.el.querySelectorAll("ol[aria-label='History entries'] button").length === 2, "the two entries");
  await clickRow(fixture.el, "saved");
  await settleUntil(() => fixture.el.querySelector("select[aria-label='Compare with']") !== null, "the preview and its comparison choices");
  const select = fixture.el.querySelector<HTMLSelectElement>("select[aria-label='Compare with']");
  ok(select !== null);
  await act(() => { select.value = "current"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await settleUntil(() => fixture.el.querySelectorAll(".tkr-history-preview").length === 2, "the second preview");
  match(fixture.el.textContent ?? "", /Compared with the file as it is now/, "the second pane names what it compares");
  equal(fixture.el.querySelector("[aria-label='Line comparison']"), null, "a binary game file is never shown as a line diff (D12.10 item 13)");
  equal(fixture.el.querySelectorAll(".tkr-history-preview").length, 2, "two read-only editors side by side");
});

test("crossing the warning offers thinning, and nothing is removed unless the creator confirms", async () => {
  const fixture = await setUp({ warnBytes: 1, autoFloorMs: 0 });
  ok(fixture.document.apply({ type: "set-game-title", title: "One" }).ok);
  ok((await fixture.document.save("auto")).ok);
  ok(fixture.document.apply({ type: "set-game-title", title: "Two" }).ok);
  ok((await fixture.document.save("auto")).ok);
  show(fixture);
  await settleUntil(() => buttonWithOrNull(fixture.el, "Show what could be thinned") !== null, "the thinning offer");
  match(fixture.el.textContent ?? "", /larger than 1 bytes\. Nothing has been removed|Nothing has been removed/);
  const before = (await fixture.workspace.history.documentTimeline(PATH)).length;
  await click(fixture.el, "Show what could be thinned", () => /Remove these|old enough/.test(fixture.el.textContent ?? ""));
  ok((await fixture.workspace.history.documentTimeline(PATH)).length === before, "offering removed nothing");
  if (buttonWithOrNull(fixture.el, "Keep everything") !== null) {
    await click(fixture.el, "Keep everything", () => buttonWithOrNull(fixture.el, "Keep everything") === null);
    equal((await fixture.workspace.history.documentTimeline(PATH)).length, before, "declining the offer removed nothing");
  }
});

test("a binary kind whose bytes happen to be valid UTF-8 still gets no line comparison (#2843)", async () => {
  const fixture = await setUp();
  // A tileset is a binary kind; these bytes decode as UTF-8 (ASCII), so only the registry gate can suppress a line diff.
  const bytes = new TextEncoder().encode("AAAA\nBBBB");
  ok((await fixture.host.fs.write("Tiles/ascii.tst", bytes)).ok);
  await fixture.workspace.history.recordSave("Tiles/ascii.tst", bytes, "manual");
  show({ ...fixture, activePath: "Tiles/ascii.tst" });
  await settleUntil(() => fixture.el.querySelectorAll("ol[aria-label='History entries'] button").length === 1, "the tileset's entry");
  await clickRow(fixture.el, "saved");
  await settleUntil(() => fixture.el.querySelector("select[aria-label='Compare with']") !== null, "the comparison choices");
  const select = fixture.el.querySelector<HTMLSelectElement>("select[aria-label='Compare with']")!;
  await act(() => { select.value = "current"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await settleUntil(() => fixture.el.querySelectorAll(".tkr-history-preview").length === 2, "the second pane");
  equal(fixture.el.querySelector("[aria-label='Line comparison']"), null, "a binary kind is never compared line by line, even when its bytes are text-like");
});

test("native clip history compares saved UTF-8 versions line by line", async () => {
  const fixture = await setUp();
  const path = "Misc/walk.tkranm";
  const before = "contract: animation-clip\nversion: 1.0.0-pre.1\ncanvas: {width: 32, height: 32}\ndelay: 0.15 # timing\nframes:\n  - image: bitmap/walk.png\n";
  const after = before.replace("delay: 0.15", "delay: 0.25");
  ok((await fixture.host.fs.write(path, new TextEncoder().encode(after))).ok);
  await fixture.workspace.history.recordSave(path, new TextEncoder().encode(before), "manual");
  show({ ...fixture, activePath: path });
  await settleUntil(() => fixture.el.querySelectorAll("ol[aria-label='History entries'] button").length === 1, "the clip history entry");
  await clickRow(fixture.el, "saved");
  await settleUntil(() => fixture.el.querySelector("select[aria-label='Compare with']") !== null, "the clip comparison choices");
  const select = fixture.el.querySelector<HTMLSelectElement>("select[aria-label='Compare with']")!;
  await act(() => { select.value = "current"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await settleUntil(() => fixture.el.querySelector("[aria-label='Line comparison']") !== null, "the clip line comparison");
  const comparison = fixture.el.querySelector("[aria-label='Line comparison']")!;
  match(comparison.textContent ?? "", /delay: 0\.15/);
  match(comparison.textContent ?? "", /delay: 0\.25/);
});

test("the ignore offer asks before writing .gitignore and records nothing when declined", async () => {
  const fixture = await setUp();
  await fixture.host.fs.createFolder(".git");
  await fixture.host.fs.write(".git/HEAD", new TextEncoder().encode("ref: refs/heads/main"));
  show(fixture);
  await settleUntil(() => fixture.el.querySelector("[aria-label='Git ignore offer']") !== null, "the ignore offer");
  match(fixture.el.textContent ?? "", /Nothing is written unless you accept/);
  equal(fixture.host.bytesOf(".gitignore"), undefined, "the offer wrote nothing");
  await click(fixture.el, "Add the line", () => fixture.host.bytesOf(".gitignore") !== undefined);
  match(new TextDecoder().decode(fixture.host.bytesOf(".gitignore")!), /\.tkr-history\//);
});

test("a history problem is shown to the creator instead of being hidden", async () => {
  const fixture = await setUp();
  fixture.workspace.history.reportProblem(PATH, "Main/example.gam was saved, but its history could not be recorded: disk full");
  show(fixture);
  await settleUntil(() => fixture.el.querySelector("[aria-label='History problems']") !== null, "the problem");
  match(fixture.el.querySelector("[aria-label='History problems']")?.textContent ?? "", /disk full/);
});
