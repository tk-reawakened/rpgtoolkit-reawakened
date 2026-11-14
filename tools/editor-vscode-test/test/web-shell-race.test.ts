import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
type BrowserShellCleanup = typeof globalThis & {
  workbenches?: { dispose(): void }[];
  A?: { deactivate(): void };
  B?: { deactivate(): void };
};

async function cleanupBrowserShell(shellPath?: string): Promise<void> {
  const cleanup = globalThis as BrowserShellCleanup;
  for (const workbench of cleanup.workbenches ?? []) workbench.dispose();
  cleanup.A?.deactivate();
  cleanup.B?.deactivate();
  await GlobalRegistrator.unregister();
  if (shellPath !== undefined) await rm(shellPath, { force: true });
}
/** Put generated shells under the host package so Node resolves workspace dependencies as it does in production. */
function shellModulePath(dir: string): string {
  return join(resolve("packages/host-web/dist"), `${basename(dir)}-shell.mjs`);
}

describe("browser shell lifecycle races", { concurrency: false }, () => {
  test("a stale candidate cannot retire a project with a newer same-project open pending", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tkr-shell-race-"));
  const shellPath = shellModulePath(dir);
  GlobalRegistrator.register();
  try {
    document.body.innerHTML = `<button id="open-project"></button><input id="open-session" type="file"><label id="project-game-label"></label><select id="project-game"></select><button id="open-selected-game"></button><label id="recent-project-label"></label><select id="recent-project"></select><button id="reopen-project"></button><div id="document-actions" hidden><button id="undo"></button><button id="redo"></button><button id="save-as"></button><button id="save-all"></button><button id="revert"></button><button id="close"></button></div><p id="host-status"></p><section id="settings"></section>`;
    document.body.insertAdjacentHTML("beforeend", '<button id="mirror-view"></button><section id="mirror"></section><section id="run"></section>');
    const hostUrl = pathToFileURL(resolve("packages/host-web/dist/index.js")).href;
    const fixtureUrl = pathToFileURL(resolve("docs/spec/examples/game/Main/example.gam")).href;
    await writeFile(join(dir, "host.mjs"), `
import * as real from ${JSON.stringify(hostUrl)};
import { readFileSync } from 'node:fs';
const data = new Uint8Array(readFileSync(new URL(${JSON.stringify(fixtureUrl)})));
export const A = real.createSessionCopy('game.gam', data);
globalThis.A = A;
await A.services.fs.write('other.gam', data);
export const openWebProject = async () => A;
export const reopenWebProject = real.reopenWebProject;
export const listRecentWebProjects = async () => [];
export const createSessionCopy = real.createSessionCopy;
export const mountDocumentView = real.mountDocumentView;
const workbenches = [];
globalThis.workbenches = workbenches;
let count = 0;
let releaseFirst;
let releaseSecond;
const firstGate = new Promise(resolve => { releaseFirst = resolve; });
const secondGate = new Promise(resolve => { releaseSecond = resolve; });
globalThis.releaseStaleFirst = releaseFirst;
globalThis.releaseStaleSecond = releaseSecond;
export function createWorkbench(project, element) {
  const workbench = real.createWorkbench(project, element);
  workbenches.push(workbench);
  const openPath = workbench.openPath.bind(workbench);
  workbench.openPath = async path => {
    const attempt = ++count;
    const result = await openPath(path);
    if (project !== A) return result;
    if (attempt === 1) {
      globalThis.staleFirstViewReady = true;
      await firstGate;
    } else if (attempt === 2) {
      globalThis.staleSecondDocumentReady = true;
      await secondGate;
    }
    return result;
  };
  return workbench;
}
`);
    const source = await readFile(resolve("tools/browser/editor-web/main.tsx"), "utf8");
    const transformed = await transform(source, { loader: "tsx", format: "esm" });
    await writeFile(shellPath, transformed.code.replace('"@tk-reawakened/host-web"', JSON.stringify(pathToFileURL(join(dir, "host.mjs")).href)));
    // Import this generated module dynamically from the package's build directory to exercise normal workspace resolution.
    await import(pathToFileURL(shellPath).href);
    const until = async (condition: () => boolean) => {
      for (let i = 0; i < 1000; i++) {
        if (condition()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error(`shell did not reach expected state: status=${document.getElementById("host-status")?.textContent}; choices=${[...document.querySelectorAll<HTMLOptionElement>("#project-game option")].map((option) => option.value).join(",")}; settings=${document.getElementById("settings")?.textContent}`);
    };
    const byId = (id: string) => document.getElementById(id)!;
    byId("open-project").click();
    await until(() => (byId("project-game") as HTMLSelectElement).options.length === 2);
    const gameSelect = byId("project-game") as HTMLSelectElement;
    gameSelect.value = "game.gam";
    byId("open-selected-game").click();
    const controls = globalThis as typeof globalThis & {
      staleFirstViewReady?: boolean;
      staleSecondDocumentReady?: boolean;
      releaseStaleFirst?: () => void;
      releaseStaleSecond?: () => void;
      A?: { workspace: { documents(): readonly { identity: { path: string } }[] } };
    };
    await until(() => controls.staleFirstViewReady === true);
    byId("open-selected-game").click();
    await until(() => controls.staleSecondDocumentReady === true);
    controls.releaseStaleFirst!();
    await until(() => document.querySelectorAll("#settings > section").length === 1);
    controls.releaseStaleSecond!();
    await until(() => byId("host-status").textContent?.includes(": game.gam") === true);
    assert.deepEqual(controls.A!.workspace.documents().map((item) => item.identity.path), ["game.gam"], "the newer view owns the shared document");
    const original = await readFile(new URL(fixtureUrl));
    const input = byId("open-session") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [{ name: "B.gam", arrayBuffer: async () => Uint8Array.from(original).buffer }] });
    input.dispatchEvent(new Event("change"));
    await until(() => byId("host-status").textContent?.includes("B.gam") === true);
    await until(() => document.querySelector<HTMLInputElement>('#settings input[type="text"]') !== null);
    assert.match(byId("host-status").textContent ?? "", /B\.gam/);
    const title = document.querySelector<HTMLInputElement>('#settings input[type="text"]')!;
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
    await cleanupBrowserShell(shellPath);
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed and later opens clean stale documents only after same-workspace acquisition settles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tkr-shell-open-failure-"));
  const shellPath = shellModulePath(dir);
  GlobalRegistrator.register();
  try {
    document.body.innerHTML = `<button id="open-project"></button><input id="open-session" type="file"><label id="project-game-label"></label><select id="project-game"></select><button id="open-selected-game"></button><label id="recent-project-label"></label><select id="recent-project"></select><button id="reopen-project"></button><div id="document-actions" hidden><button id="undo"></button><button id="redo"></button><button id="save-as"></button><button id="save-all"></button><button id="revert"></button><button id="close"></button></div><p id="host-status"></p><section id="settings"></section>`;
    document.body.insertAdjacentHTML("beforeend", '<button id="mirror-view"></button><section id="mirror"></section><section id="run"></section>');
    const hostUrl = pathToFileURL(resolve("packages/host-web/dist/index.js")).href;
    const fixtureUrl = pathToFileURL(resolve("docs/spec/examples/game/Main/example.gam")).href;
    await writeFile(join(dir, "host.mjs"), `
import * as real from ${JSON.stringify(hostUrl)};
import { readFileSync } from 'node:fs';
const data = new Uint8Array(readFileSync(new URL(${JSON.stringify(fixtureUrl)})));
export const A = real.createSessionCopy('game.gam', data, { dialogs: { ask: async () => 'discard', pickSavePath: async () => null } });
globalThis.A = A;
await A.services.fs.write('other.gam', data);
const list = A.services.fs.list.bind(A.services.fs);
A.services.fs.list = async path => {
  globalThis.projectListings = (globalThis.projectListings || 0) + 1;
  return list(path);
};
let folderCalls = 0;
export const openWebProject = async () => {
  globalThis.folderCalls = ++folderCalls;
  return A;
};
export const reopenWebProject = real.reopenWebProject;
export const listRecentWebProjects = async () => [];
export const createSessionCopy = real.createSessionCopy;
export const mountDocumentView = real.mountDocumentView;
const workbenches = [];
globalThis.workbenches = workbenches;
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
export function createWorkbench(project, element) {
  const workbench = real.createWorkbench(project, element);
  workbenches.push(workbench);
  const openPath = workbench.openPath.bind(workbench);
  workbench.openPath = async path => {
    const attempt = ++count;
    if (attempt === 1) {
      const result = await openPath(path);
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
    if (attempt === 2) {
      await openPath(path);
      globalThis.secondOpenReady = true;
      await secondGate;
      throw new Error('simulated view mount failure');
    }
    globalThis.thirdOpenStarted = true;
    return openPath(path);
  };
  return workbench;
}
`);
    const source = await readFile(resolve("tools/browser/editor-web/main.tsx"), "utf8");
    const transformed = await transform(source, { loader: "tsx", format: "esm" });
    await writeFile(shellPath, transformed.code.replace('"@tk-reawakened/host-web"', JSON.stringify(pathToFileURL(join(dir, "host.mjs")).href)));
    await import(pathToFileURL(shellPath).href);
    const until = async (condition: () => boolean) => {
      for (let i = 0; i < 1000; i++) {
        if (condition()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error(`shell did not reach expected state: status=${document.getElementById("host-status")?.textContent}; choices=${[...document.querySelectorAll<HTMLOptionElement>("#project-game option")].map((option) => option.value).join(",")}; settings=${document.getElementById("settings")?.textContent}`);
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
    (byId("project-game") as HTMLSelectElement).value = "game.gam";
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
    await until(() => controls.firstViewReady === true);
    byId("open-selected-game").click();
    await until(() => controls.secondOpenReady === true);
    controls.releaseFirst!();
    await until(() => document.querySelectorAll("#settings > section").length === 1);
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
    await cleanupBrowserShell(shellPath);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a stale same-project candidate cannot activate after the newer open fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tkr-shell-stale-active-"));
  const shellPath = shellModulePath(dir);
  GlobalRegistrator.register();
  try {
    document.body.innerHTML = `<button id="open-project"></button><input id="open-session" type="file"><label id="project-game-label"></label><select id="project-game"></select><button id="open-selected-game"></button><label id="recent-project-label"></label><select id="recent-project"></select><button id="reopen-project"></button><div id="document-actions" hidden><button id="undo"></button><button id="redo"></button><button id="save-as"></button><button id="save-all"></button><button id="revert"></button><button id="close"></button></div><p id="host-status"></p><section id="settings"></section>`;
    document.body.insertAdjacentHTML("beforeend", '<button id="mirror-view"></button><section id="mirror"></section><section id="run"></section>');
    const hostUrl = pathToFileURL(resolve("packages/host-web/dist/index.js")).href;
    const fixtureUrl = pathToFileURL(resolve("docs/spec/examples/game/Main/example.gam")).href;
    await writeFile(join(dir, "host.mjs"), `
import * as real from ${JSON.stringify(hostUrl)};
import { readFileSync } from 'node:fs';
const data = new Uint8Array(readFileSync(new URL(${JSON.stringify(fixtureUrl)})));
export const A = real.createSessionCopy('A.gam', data);
await A.services.fs.write('B.gam', data);
await A.services.fs.write('broken.gam', data);
globalThis.A = A;
const workbenches = [];
globalThis.workbenches = workbenches;
let releaseStaleOpen;
const staleOpenGate = new Promise(resolve => { releaseStaleOpen = resolve; });
globalThis.releaseStaleOpen = releaseStaleOpen;
export const openWebProject = async () => A;
export const reopenWebProject = real.reopenWebProject;
export const listRecentWebProjects = async () => [];
export const createSessionCopy = real.createSessionCopy;
export const mountDocumentView = real.mountDocumentView;
export function createWorkbench(project, element) {
  const workbench = real.createWorkbench(project, element);
  workbenches.push(workbench);
  const openPath = workbench.openPath.bind(workbench);
  workbench.openPath = async path => {
    if (path === 'broken.gam') {
      globalThis.brokenOpenAttempted = true;
      throw new Error('simulated newer open failure');
    }
    const result = await openPath(path);
    if (path === 'B.gam') {
      globalThis.staleOpenReady = true;
      await staleOpenGate;
    }
    return result;
  };
  return workbench;
}
`);
    const source = await readFile(resolve("tools/browser/editor-web/main.tsx"), "utf8");
    const transformed = await transform(source, { loader: "tsx", format: "esm" });
    await writeFile(shellPath, transformed.code.replace('"@tk-reawakened/host-web"', JSON.stringify(pathToFileURL(join(dir, "host.mjs")).href)));
    await import(pathToFileURL(shellPath).href);
    const until = async (condition: () => boolean) => {
      for (let i = 0; i < 1000; i++) {
        if (condition()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error(`shell did not reach expected state: status=${document.getElementById("host-status")?.textContent}; choices=${[...document.querySelectorAll<HTMLOptionElement>("#project-game option")].map((option) => option.value).join(",")}; settings=${document.getElementById("settings")?.textContent}`);
    };
    const byId = (id: string) => document.getElementById(id)!;
    byId("open-project").click();
    await until(() => (byId("project-game") as HTMLSelectElement).options.length === 3);
    const gameSelect = byId("project-game") as HTMLSelectElement;
    gameSelect.value = "A.gam";
    byId("open-selected-game").click();
    await until(() => byId("host-status").textContent?.includes(": A.gam") === true);

    byId("open-project").click();
    await until(() => (byId("project-game") as HTMLSelectElement).options.length === 3);
    gameSelect.value = "B.gam";
    byId("open-selected-game").click();
    const controls = globalThis as typeof globalThis & {
      A?: { workspace: { documents(): readonly { identity: { path: string } }[] } };
      workbenches?: { tabs: { getSnapshot(): { tabs: readonly { key: string; path: string }[]; active: string | null } } }[];
      staleOpenReady?: boolean;
      releaseStaleOpen?: () => void;
    };
    await until(() => controls.staleOpenReady === true);
    gameSelect.value = "broken.gam";
    byId("open-selected-game").click();
    await until(() => (globalThis as typeof globalThis & { brokenOpenAttempted?: boolean }).brokenOpenAttempted === true);
    assert.match(byId("host-status").textContent ?? "", /simulated newer open failure/);
    const shownTabs = controls.workbenches![0]!.tabs.getSnapshot();
    assert.deepEqual(shownTabs.tabs.map((tab) => tab.path), ["A.gam", "B.gam"]);
    assert.equal(shownTabs.active, shownTabs.tabs[0]!.key);

    controls.releaseStaleOpen!();
    await until(() => controls.workbenches![0]!.tabs.getSnapshot().tabs.length === 1);
    assert.deepEqual(controls.A!.workspace.documents().map((item) => item.identity.path), ["A.gam"]);
    assert.deepEqual(controls.workbenches![0]!.tabs.getSnapshot().tabs.map((tab) => tab.path), ["A.gam"]);
    assert.match(byId("host-status").textContent ?? "", /simulated newer open failure/);
  } finally {
    await cleanupBrowserShell(shellPath);
    await rm(dir, { recursive: true, force: true });
  }
});
test("same stable project id in separate workspaces does not share pending-open ownership", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tkr-shell-workspace-scope-"));
  const shellPath = shellModulePath(dir);
  GlobalRegistrator.register();
  try {
    document.body.innerHTML = `<button id="open-project"></button><input id="open-session" type="file"><label id="project-game-label"></label><select id="project-game"></select><button id="open-selected-game"></button><label id="recent-project-label"></label><select id="recent-project"></select><button id="reopen-project"></button><div id="document-actions" hidden><button id="undo"></button><button id="redo"></button><button id="save-as"></button><button id="save-all"></button><button id="revert"></button><button id="close"></button></div><p id="host-status"></p><section id="settings"></section>`;
    document.body.insertAdjacentHTML("beforeend", '<button id="mirror-view"></button><section id="mirror"></section>');
    const hostUrl = pathToFileURL(resolve("packages/host-web/dist/index.js")).href;
    const platformUrl = pathToFileURL(resolve("packages/platform-services/dist/index.js")).href;
    const modelUrl = pathToFileURL(resolve("packages/editor-model/dist/index.js")).href;
    const fixtureUrl = pathToFileURL(resolve("docs/spec/examples/game/Main/example.gam")).href;
    await writeFile(join(dir, "host.mjs"), `
import * as real from ${JSON.stringify(hostUrl)};
import { bindProjectFileSystem } from ${JSON.stringify(platformUrl)};
import { createDocumentWorkspace } from ${JSON.stringify(modelUrl)};
import { readFileSync } from 'node:fs';
const data = new Uint8Array(readFileSync(new URL(${JSON.stringify(fixtureUrl)})));
export const A = real.createSessionCopy('game.gam', data);
export const B = real.createSessionCopy('game.gam', data);
B.project.id = A.project.id;
const deactivateB = B.deactivate;
const baseFs = B.services.fs;
const fs = bindProjectFileSystem(A.project.id, {
  list: path => baseFs.list(path),
  read: path => baseFs.read(path),
  write: (path, bytes) => baseFs.write(path, bytes),
  stat: path => baseFs.stat(path),
  delete: path => baseFs.delete(path),
  rename: (from, to) => baseFs.rename(from, to),
  watch: (path, onChange) => baseFs.watch(path, onChange),
});
B.services.fs = fs;
B.workspace = createDocumentWorkspace({projectId:A.project.id,services:{fs,dialogs:B.services.dialogs,capabilities:B.services.capabilities}});
B.deactivate = () => { deactivateB(); B.workspace.dispose(); };
globalThis.A = A;
globalThis.B = B;
let projectCount = 0;
let releaseFirst;
let releaseSecond;
const firstGate = new Promise(resolve => { releaseFirst = resolve; });
const secondGate = new Promise(resolve => { releaseSecond = resolve; });
globalThis.releaseFirst = releaseFirst;
globalThis.releaseSecond = releaseSecond;
export const openWebProject = async () => ++projectCount === 1 ? A : B;
export const reopenWebProject = real.reopenWebProject;
export const listRecentWebProjects = async () => [];
export const createSessionCopy = real.createSessionCopy;
export const mountDocumentView = real.mountDocumentView;
const workbenches = [];
globalThis.workbenches = workbenches;
export function createWorkbench(project, element) {
  const workbench = real.createWorkbench(project, element);
  workbenches.push(workbench);
  const openPath = workbench.openPath.bind(workbench);
  workbench.openPath = async path => {
    const result = await openPath(path);
    if (project === A) {
      globalThis.firstViewReady = true;
      await firstGate;
    } else {
      globalThis.secondOpenReady = true;
      await secondGate;
    }
    return result;
  };
  return workbench;
}
`);
    const source = await readFile(resolve("tools/browser/editor-web/main.tsx"), "utf8");
    const transformed = await transform(source, { loader: "tsx", format: "esm" });
    await writeFile(shellPath, transformed.code.replace('"@tk-reawakened/host-web"', JSON.stringify(pathToFileURL(join(dir, "host.mjs")).href)));
    await import(pathToFileURL(shellPath).href);
    const until = async (condition: () => boolean) => {
      for (let i = 0; i < 1000; i++) {
        if (condition()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error(`shell did not reach expected state: status=${document.getElementById("host-status")?.textContent}; choices=${[...document.querySelectorAll<HTMLOptionElement>("#project-game option")].map((option) => option.value).join(",")}; settings=${document.getElementById("settings")?.textContent}`);
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
    await until(() => document.querySelectorAll("#settings > section").length === 1);
    assert.deepEqual(controls.A!.workspace.documents(), [], "the stale candidate closes in its own workspace despite B's pending open");
    assert.deepEqual(controls.B!.workspace.documents().map((item) => item.identity.path), ["game.gam"]);
    controls.releaseSecond!();
    await until(() => byId("host-status").textContent?.includes(": game.gam") === true);
    assert.deepEqual(controls.A!.workspace.documents(), []);
    assert.deepEqual(controls.B!.workspace.documents().map((item) => item.identity.path), ["game.gam"]);
  } finally {
    await cleanupBrowserShell(shellPath);
    await rm(dir, { recursive: true, force: true });
  }
});

});
