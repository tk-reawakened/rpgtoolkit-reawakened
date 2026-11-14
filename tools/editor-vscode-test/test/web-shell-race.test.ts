import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

test("a stale shell open cannot replace the newer project", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tkr-shell-race-"));
  GlobalRegistrator.register();
  try {
    document.body.innerHTML = `<button id="open-project"></button><input id="open-session" type="file"><label id="project-game-label"></label><select id="project-game"></select><button id="open-selected-game"></button><label id="recent-project-label"></label><select id="recent-project"></select><button id="reopen-project"></button><div id="document-actions" hidden><button id="undo"></button><button id="redo"></button><button id="save-as"></button><button id="save-all"></button><button id="revert"></button><button id="close"></button></div><p id="host-status"></p><section id="settings"></section>`;
    const hostUrl = pathToFileURL(resolve("packages/host-web/dist/index.js")).href;
    const modelUrl = pathToFileURL(resolve("packages/editor-model/dist/index.js")).href;
    const fixtureUrl = pathToFileURL(resolve("docs/spec/examples/game/Main/example.gam")).href;
    await writeFile(join(dir, "host.mjs"), `
import * as real from ${JSON.stringify(hostUrl)};
import { readFileSync } from 'node:fs';
const data = new Uint8Array(readFileSync(new URL(${JSON.stringify(fixtureUrl)})));
export const A = real.createSessionCopy('game.gam', data);
globalThis.A = A;
A.services.fs.list = async () => ({ok:true,value:[{name:'game.gam',kind:'file'},{name:'other.gam',kind:'file'}]});
export const openWebProject = async () => A;
export const reopenWebProject = real.reopenWebProject;
export const listRecentWebProjects = async () => [];
export const createSessionCopy = real.createSessionCopy;
export const mountGameSettings = real.mountGameSettings;
let count = 0;
let releaseFirst;
let releaseSecond;
const firstGate = new Promise(resolve => { releaseFirst = resolve; });
const secondGate = new Promise(resolve => { releaseSecond = resolve; });
globalThis.releaseStaleFirst = releaseFirst;
globalThis.releaseStaleSecond = releaseSecond;
export async function openGameSettings(project, path, element) {
  if (project !== A) return real.openGameSettings(project, path, element);
  if (++count === 1) {
    const result = await real.openGameSettings(project, path, element);
    globalThis.staleFirstViewReady = true;
    await firstGate;
    return result;
  }
  const opened = await project.workspace.open(path);
  globalThis.staleSecondDocumentReady = true;
  await secondGate;
  if (!opened.ok) return opened;
  return { ok: true, document: opened.document, view: real.mountGameSettings(project, opened.document, element) };
}
`);
    const source = await readFile(resolve("tools/browser/editor-web/main.tsx"), "utf8");
    const transformed = await transform(source, { loader: "tsx", format: "esm" });
    await writeFile(join(dir, "shell.mjs"), transformed.code
      .replace('"@tk-reawakened/host-web"', JSON.stringify(pathToFileURL(join(dir, "host.mjs")).href))
      .replace('"@tk-reawakened/editor-model"', JSON.stringify(modelUrl)));
    await import(pathToFileURL(join(dir, "shell.mjs")).href);
    const until = async (condition: () => boolean) => {
      for (let i = 0; i < 1000; i++) {
        if (condition()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error("shell did not reach expected state");
    };
    const byId = (id: string) => document.getElementById(id)!;
    byId("open-project").click();
    await until(() => (byId("project-game") as HTMLSelectElement).options.length === 2);
    byId("open-selected-game").click();
    byId("open-selected-game").click();
    const controls = globalThis as typeof globalThis & {
      staleFirstViewReady?: boolean;
      staleSecondDocumentReady?: boolean;
      releaseStaleFirst?: () => void;
      releaseStaleSecond?: () => void;
      A?: { workspace: { documents(): readonly { identity: { path: string } }[] } };
    };
    await until(() => controls.staleSecondDocumentReady === true);
    controls.releaseStaleFirst!();
    await until(() => document.querySelectorAll("#settings > div").length === 1);
    assert.deepEqual(controls.A!.workspace.documents().map((item) => item.identity.path), ["game.gam"], "the candidate close must leave the registered document for the pending open");
    controls.releaseStaleSecond!();
    await until(() => byId("host-status").textContent?.includes(": game.gam") === true);
    assert.deepEqual(controls.A!.workspace.documents().map((item) => item.identity.path), ["game.gam"], "the newer view owns the shared document");
    const original = await readFile(new URL(fixtureUrl));
    const input = byId("open-session") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [{ name: "B.gam", arrayBuffer: async () => Uint8Array.from(original).buffer }] });
    input.dispatchEvent(new Event("change"));
    await until(() => byId("host-status").textContent?.includes("B.gam") === true);
    await until(() => document.querySelectorAll("#settings > div").length === 1);
    assert.match(byId("host-status").textContent ?? "", /B\.gam/);
    const title = document.querySelector<HTMLInputElement>("#settings input")!;
    title.value = "Still writable";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    const apply = document.querySelector<HTMLButtonElement>("#settings .tkr-settings-apply")!;
    await until(() => !apply.disabled);
    apply.click();
    await until(() => document.querySelector("#settings .tkr-settings-state")?.textContent === "Unsaved changes");
    const button = [...document.querySelectorAll<HTMLButtonElement>("#settings button")].find((item) => item.textContent === "Save")!;
    button.click();
    await until(() => byId("settings").textContent?.includes("All changes saved") === true);
  } finally {
    GlobalRegistrator.unregister();
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed and later opens clean stale documents only after same-workspace acquisition settles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tkr-shell-open-failure-"));
  GlobalRegistrator.register();
  try {
    document.body.innerHTML = `<button id="open-project"></button><input id="open-session" type="file"><label id="project-game-label"></label><select id="project-game"></select><button id="open-selected-game"></button><label id="recent-project-label"></label><select id="recent-project"></select><button id="reopen-project"></button><div id="document-actions" hidden><button id="undo"></button><button id="redo"></button><button id="save-as"></button><button id="save-all"></button><button id="revert"></button><button id="close"></button></div><p id="host-status"></p><section id="settings"></section>`;
    const hostUrl = pathToFileURL(resolve("packages/host-web/dist/index.js")).href;
    const modelUrl = pathToFileURL(resolve("packages/editor-model/dist/index.js")).href;
    const fixtureUrl = pathToFileURL(resolve("docs/spec/examples/game/Main/example.gam")).href;
    await writeFile(join(dir, "host.mjs"), `
import * as real from ${JSON.stringify(hostUrl)};
import { readFileSync } from 'node:fs';
const data = new Uint8Array(readFileSync(new URL(${JSON.stringify(fixtureUrl)})));
export const A = real.createSessionCopy('game.gam', data, { dialogs: { ask: async () => 'discard', pickSavePath: async () => null } });
globalThis.A = A;
A.services.fs.list = async () => {
  globalThis.projectListings = (globalThis.projectListings || 0) + 1;
  return {ok:true,value:[{name:'game.gam',kind:'file'},{name:'other.gam',kind:'file'}]};
};
let folderCalls = 0;
export const openWebProject = async () => {
  globalThis.folderCalls = ++folderCalls;
  return A;
};
export const reopenWebProject = real.reopenWebProject;
export const listRecentWebProjects = async () => [];
export const createSessionCopy = real.createSessionCopy;
export const mountGameSettings = real.mountGameSettings;
let count = 0;
let closeAttempts = 0;
let releaseFirst;
let releaseSecond;
let releaseClose;
const firstGate = new Promise(resolve => { releaseFirst = resolve; });
const secondGate = new Promise(resolve => { releaseSecond = resolve; });
const closeGate = new Promise(resolve => { releaseClose = resolve; });
globalThis.releaseFirst = releaseFirst;
globalThis.releaseSecond = releaseSecond;
globalThis.releaseClose = releaseClose;
export async function openGameSettings(project, path, element) {
  if (++count === 1) {
    const result = await real.openGameSettings(project, path, element);
    const close = project.workspace.close.bind(project.workspace);
    project.workspace.close = async document => {
      globalThis.staleCloseStarted = true;
      await closeGate;
      closeAttempts += 1;
      globalThis.workspaceCloseAttempts = closeAttempts;
      if (closeAttempts === 1) {
        globalThis.workspaceCloseRejected = true;
        throw new Error('simulated workspace close rejection');
      }
      const closed = await close(document);
      globalThis.workspaceCloseResult = closed;
      globalThis.workspaceCloseReturned = true;
      return closed;
    };
    globalThis.firstViewReady = true;
    await firstGate;
    return result;
  }
  if (count === 2) {
    await project.workspace.open(path);
    globalThis.secondOpenReady = true;
    await secondGate;
    throw new Error('simulated view mount failure');
  }
  globalThis.thirdOpenStarted = true;
  return real.openGameSettings(project, path, element);
}
`);
    const source = await readFile(resolve("tools/browser/editor-web/main.tsx"), "utf8");
    const transformed = await transform(source, { loader: "tsx", format: "esm" });
    await writeFile(join(dir, "shell.mjs"), transformed.code
      .replace('"@tk-reawakened/host-web"', JSON.stringify(pathToFileURL(join(dir, "host.mjs")).href))
      .replace('"@tk-reawakened/editor-model"', JSON.stringify(modelUrl)));
    await import(pathToFileURL(join(dir, "shell.mjs")).href);
    const until = async (condition: () => boolean) => {
      for (let i = 0; i < 1000; i++) {
        if (condition()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error("shell did not reach expected state");
    };
    const byId = (id: string) => document.getElementById(id)!;
    let gameChoiceResets = 0;
    let gameChoicePopulates = 0;
    const gameSelect = byId("project-game") as HTMLSelectElement;
    const replaceChoices = gameSelect.replaceChildren.bind(gameSelect);
    gameSelect.replaceChildren = (...nodes: (string | Node)[]) => {
      if (nodes.length === 0) gameChoiceResets += 1;
      else gameChoicePopulates += 1;
      replaceChoices(...nodes);
    };
    let thirdCandidateAppended = false;
    let candidateAppends = 0;
    let thirdCandidateAppendTarget: number | null = null;
    const settings = byId("settings");
    const append = settings.append.bind(settings);
    settings.append = (...nodes: (string | Node)[]) => {
      candidateAppends += nodes.length;
      if (thirdCandidateAppendTarget !== null && candidateAppends > thirdCandidateAppendTarget) thirdCandidateAppended = true;
      append(...nodes);
    };
    byId("open-project").click();
    await until(() => (byId("project-game") as HTMLSelectElement).options.length === 2);
    byId("open-selected-game").click();
    byId("open-selected-game").click();
    const controls = globalThis as typeof globalThis & {
      firstViewReady?: boolean;
      secondOpenReady?: boolean;
      staleCloseStarted?: boolean;
      thirdOpenStarted?: boolean;
      folderCalls?: number;
      projectListings?: number;
      workspaceCloseReturned?: boolean;
      workspaceCloseRejected?: boolean;
      workspaceCloseAttempts?: number;
      workspaceCloseResult?: { closed: boolean };
      releaseFirst?: () => void;
      releaseSecond?: () => void;
      releaseClose?: () => void;
      A?: { workspace: { documents(): readonly { identity: { path: string } }[] } };
    };
    await until(() => controls.secondOpenReady === true);
    controls.releaseFirst!();
    await until(() => document.querySelectorAll("#settings > div").length === 1);
    assert.deepEqual(controls.A!.workspace.documents().map((item) => item.identity.path), ["game.gam"], "keep the registered document available while the newer open resolves");
    controls.releaseSecond!();
    await until(() => controls.staleCloseStarted === true);
    assert.deepEqual(controls.A!.workspace.documents().map((item) => item.identity.path), ["game.gam"], "keep the registered document while workspace close is in flight");

    thirdCandidateAppendTarget = candidateAppends;
    const resetsBeforeThirdFolder = gameChoiceResets;
    const populationsBeforeThirdFolder = gameChoicePopulates;
    byId("open-project").click();
    await until(() => gameChoiceResets > resetsBeforeThirdFolder);
    await until(() => gameChoicePopulates > populationsBeforeThirdFolder);
    (byId("project-game") as HTMLSelectElement).value = "game.gam";
    byId("open-selected-game").click();
    await until(() => thirdCandidateAppended).catch((error: unknown) => {
      const select = byId("project-game") as HTMLSelectElement;
      throw new Error(`${error instanceof Error ? error.message : String(error)}; shell state=${JSON.stringify({
        folderCalls: controls.folderCalls,
        projectListings: controls.projectListings,
        selectorHidden: select.hidden,
        gameOptions: [...select.options].map((option) => option.value),
        selectedGame: select.value,
        openSelectedHidden: (byId("open-selected-game") as HTMLButtonElement).hidden,
        gameChoiceResets,
        gameChoicePopulates,
        candidateAppends,
        candidateAppendBaseline: thirdCandidateAppendTarget,
        settingsChildren: document.querySelectorAll("#settings > *").length,
        status: byId("host-status").textContent,
      })}`);
    });
    assert.equal(controls.thirdOpenStarted, undefined, "a later acquisition waits for stale-document cleanup");
    controls.releaseClose!();
    await until(() => controls.workspaceCloseRejected === true);
    await until(() => controls.thirdOpenStarted === true);
    await until(() => controls.workspaceCloseReturned === true);
    assert.equal(controls.workspaceCloseAttempts, 2, "the rejected cleanup remains queued for a later attempt");
    assert.equal(controls.workspaceCloseResult?.closed, false, "the later view now owns the document");
    await until(() => byId("host-status").textContent?.includes(": game.gam") === true);
    assert.deepEqual(controls.A!.workspace.documents().map((item) => item.identity.path), ["game.gam"], "the later open acquires its own live document after cleanup");
  } finally {
    GlobalRegistrator.unregister();
    await rm(dir, { recursive: true, force: true });
  }
});

test("same stable project id in separate workspaces does not share pending-open ownership", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tkr-shell-workspace-scope-"));
  GlobalRegistrator.register();
  try {
    document.body.innerHTML = `<button id="open-project"></button><input id="open-session" type="file"><label id="project-game-label"></label><select id="project-game"></select><button id="open-selected-game"></button><label id="recent-project-label"></label><select id="recent-project"></select><button id="reopen-project"></button><div id="document-actions" hidden><button id="undo"></button><button id="redo"></button><button id="save-as"></button><button id="save-all"></button><button id="revert"></button><button id="close"></button></div><p id="host-status"></p><section id="settings"></section>`;
    const hostUrl = pathToFileURL(resolve("packages/host-web/dist/index.js")).href;
    const modelUrl = pathToFileURL(resolve("packages/editor-model/dist/index.js")).href;
    const fixtureUrl = pathToFileURL(resolve("docs/spec/examples/game/Main/example.gam")).href;
    await writeFile(join(dir, "host.mjs"), `
import * as real from ${JSON.stringify(hostUrl)};
import { readFileSync } from 'node:fs';
const data = new Uint8Array(readFileSync(new URL(${JSON.stringify(fixtureUrl)})));
export const A = real.createSessionCopy('game.gam', data);
export const B = real.createSessionCopy('game.gam', data);
B.project.id = A.project.id;
globalThis.A = A;
globalThis.B = B;
let projectCount = 0;
export const openWebProject = async () => ++projectCount === 1 ? A : B;
export const reopenWebProject = real.reopenWebProject;
export const listRecentWebProjects = async () => [];
export const createSessionCopy = real.createSessionCopy;
export const mountGameSettings = real.mountGameSettings;
let releaseFirst;
let releaseSecond;
const firstGate = new Promise(resolve => { releaseFirst = resolve; });
const secondGate = new Promise(resolve => { releaseSecond = resolve; });
globalThis.releaseFirst = releaseFirst;
globalThis.releaseSecond = releaseSecond;
export async function openGameSettings(project, path, element) {
  if (project === A) {
    const result = await real.openGameSettings(project, path, element);
    globalThis.firstViewReady = true;
    await firstGate;
    return result;
  }
  const opened = await project.workspace.open(path);
  globalThis.secondOpenReady = true;
  await secondGate;
  if (!opened.ok) return opened;
  return { ok: true, document: opened.document, view: real.mountGameSettings(project, opened.document, element) };
}
`);
    const source = await readFile(resolve("tools/browser/editor-web/main.tsx"), "utf8");
    const transformed = await transform(source, { loader: "tsx", format: "esm" });
    await writeFile(join(dir, "shell.mjs"), transformed.code
      .replace('"@tk-reawakened/host-web"', JSON.stringify(pathToFileURL(join(dir, "host.mjs")).href))
      .replace('"@tk-reawakened/editor-model"', JSON.stringify(modelUrl)));
    await import(pathToFileURL(join(dir, "shell.mjs")).href);
    const until = async (condition: () => boolean) => {
      for (let i = 0; i < 1000; i++) {
        if (condition()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error("shell did not reach expected state");
    };
    const byId = (id: string) => document.getElementById(id)!;
    byId("open-project").click();
    const controls = globalThis as typeof globalThis & {
      firstViewReady?: boolean;
      secondOpenReady?: boolean;
      releaseFirst?: () => void;
      releaseSecond?: () => void;
      A?: { workspace: { documents(): readonly { identity: { path: string } }[] } };
      B?: { workspace: { documents(): readonly { identity: { path: string } }[] } };
    };
    await until(() => controls.firstViewReady === true);
    byId("open-project").click();
    await until(() => controls.secondOpenReady === true);
    controls.releaseFirst!();
    await until(() => document.querySelectorAll("#settings > div").length === 1);
    assert.deepEqual(controls.A!.workspace.documents(), [], "the stale candidate closes in its own workspace despite B's pending open");
    assert.deepEqual(controls.B!.workspace.documents().map((item) => item.identity.path), ["game.gam"]);
    controls.releaseSecond!();
    await until(() => byId("host-status").textContent?.includes(": game.gam") === true);
    assert.deepEqual(controls.A!.workspace.documents(), []);
    assert.deepEqual(controls.B!.workspace.documents().map((item) => item.identity.path), ["game.gam"]);
  } finally {
    GlobalRegistrator.unregister();
    await rm(dir, { recursive: true, force: true });
  }
});

test("cancelling a browser document switch unregisters only its candidate and preserves the dirty shown document", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tkr-shell-cancel-"));
  GlobalRegistrator.register();
  try {
    document.body.innerHTML = `<button id="open-project"></button><input id="open-session" type="file"><label id="project-game-label"></label><select id="project-game"></select><button id="open-selected-game"></button><label id="recent-project-label"></label><select id="recent-project"></select><button id="reopen-project"></button><div id="document-actions" hidden><button id="undo"></button><button id="redo"></button><button id="save-as"></button><button id="save-all"></button><button id="revert"></button><button id="close"></button></div><p id="host-status"></p><section id="settings"></section>`;
    const hostUrl = pathToFileURL(resolve("packages/host-web/dist/index.js")).href;
    const modelUrl = pathToFileURL(resolve("packages/editor-model/dist/index.js")).href;
    const fixtureUrl = pathToFileURL(resolve("docs/spec/examples/game/Main/example.gam")).href;
    await writeFile(join(dir, "host.mjs"), `
import * as real from ${JSON.stringify(hostUrl)};
import { readFileSync } from 'node:fs';
const data = new Uint8Array(readFileSync(new URL(${JSON.stringify(fixtureUrl)})));
export const A = real.createSessionCopy('A.gam', data);
globalThis.A = A;
await A.services.fs.write('B.gam', data);
globalThis.makeShownDocumentDirty = () => A.workspace.documents()[0].apply({type:'set-game-title',title:'Unsaved title to keep'});
export const openWebProject = async () => A;
export const reopenWebProject = real.reopenWebProject;
export const listRecentWebProjects = async () => [];
export const createSessionCopy = real.createSessionCopy;
export const mountGameSettings = real.mountGameSettings;
export const openGameSettings = real.openGameSettings;
`);
    const source = await readFile(resolve("tools/browser/editor-web/main.tsx"), "utf8");
    const transformed = await transform(source, { loader: "tsx", format: "esm" });
    await writeFile(join(dir, "shell.mjs"), transformed.code
      .replace('"@tk-reawakened/host-web"', JSON.stringify(pathToFileURL(join(dir, "host.mjs")).href))
      .replace('"@tk-reawakened/editor-model"', JSON.stringify(modelUrl)));
    await import(pathToFileURL(join(dir, "shell.mjs")).href);
    const until = async (condition: () => boolean) => {
      for (let i = 0; i < 1000; i++) {
        if (condition()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error("shell did not reach expected state");
    };
    const byId = (id: string) => document.getElementById(id)!;
    byId("open-project").click();
    await until(() => (byId("project-game") as HTMLSelectElement).options.length === 2);
    const select = byId("project-game") as HTMLSelectElement;
    select.value = "A.gam";
    byId("open-selected-game").click();
    await until(() => document.querySelector<HTMLInputElement>("#settings input") !== null);
    const controls = globalThis as typeof globalThis & {
      makeShownDocumentDirty?: () => { ok: boolean };
      A?: { workspace: { documents(): readonly { identity: { path: string }; getSnapshot(): { dirty: boolean; gameTitle: string } }[] } };
    };
    assert.equal(controls.makeShownDocumentDirty!().ok, true, "edit the actual document through its host API");
    await until(() => controls.A!.workspace.documents()[0]?.getSnapshot().dirty === true);
    byId("open-project").click();
    await until(() => (byId("project-game") as HTMLSelectElement).options.length === 2);
    select.value = "B.gam";
    byId("open-selected-game").click();
    await until(() => document.querySelector("dialog") !== null);
    [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find((button) => button.textContent === "Cancel")!.click();
    await until(() => byId("host-status").textContent?.includes("A.gam is still open") === true);

    const docs = controls.A!.workspace.documents();
    assert.deepEqual(docs.map((item) => item.identity.path), ["A.gam"]);
    assert.equal(docs[0]!.getSnapshot().dirty, true, "the original unsaved edit remains dirty");
    assert.equal(docs[0]!.getSnapshot().gameTitle, "Unsaved title to keep");
    assert.match(byId("host-status").textContent ?? "", /A\.gam is still open; B\.gam was not opened\./);
  } finally {
    GlobalRegistrator.unregister();
    await rm(dir, { recursive: true, force: true });
  }
});
