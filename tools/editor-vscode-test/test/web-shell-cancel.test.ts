import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

test("cancelling a browser document switch unregisters only its candidate and preserves the dirty shown document", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tkr-shell-cancel-"));
  GlobalRegistrator.register();
  try {
    document.body.innerHTML = `<button id="open-project"></button><input id="open-session" type="file"><label id="project-game-label"></label><select id="project-game"></select><button id="open-selected-game"></button><label id="recent-project-label"></label><select id="recent-project"></select><button id="reopen-project"></button><div id="document-actions" hidden><button id="undo"></button><button id="redo"></button><button id="save-as"></button><button id="save-all"></button><button id="revert"></button><button id="close"></button></div><p id="host-status"></p><section id="settings"></section>`;
    document.body.insertAdjacentHTML("beforeend", '<button id="mirror-view"></button><section id="mirror"></section>');
    const hostUrl = pathToFileURL(resolve("packages/host-web/dist/index.js")).href;
    const modelUrl = pathToFileURL(resolve("packages/editor-model/dist/index.js")).href;
    const fixtureUrl = pathToFileURL(resolve("docs/spec/examples/game/Main/example.gam")).href;
    await writeFile(join(dir, "host.mjs"), `
import * as real from ${JSON.stringify(hostUrl)};
import { readFileSync } from 'node:fs';
const data = new Uint8Array(readFileSync(new URL(${JSON.stringify(fixtureUrl)})));
export const A = real.createSessionCopy('A.gam', data);
globalThis.A = A;
const deactivate = A.deactivate;
A.deactivate = () => { globalThis.projectDeactivated = true; deactivate(); };
await A.services.fs.write('B.gam', data);
globalThis.makeShownDocumentDirty = () => A.workspace.documents()[0].apply({type:'set-game-title',title:'Unsaved title to keep'});
export const openWebProject = async () => A;
export const reopenWebProject = real.reopenWebProject;
export const listRecentWebProjects = async () => [];
export const createSessionCopy = real.createSessionCopy;
export const mountDocumentView = real.mountDocumentView;
const workbenches = [];
globalThis.workbenches = workbenches;
export function createWorkbench(project, element) {
  const workbench = real.createWorkbench(project, element);
  workbenches.push(workbench);
  return workbench;
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
      throw new Error(`shell did not reach expected state: status=${document.getElementById("host-status")?.textContent}; choices=${[...document.querySelectorAll<HTMLOptionElement>("#project-game option")].map((option) => option.value).join(",")}; settings=${document.getElementById("settings")?.textContent}; deactivated=${(globalThis as typeof globalThis & { projectDeactivated?: boolean }).projectDeactivated}`);
    };
    const byId = (id: string) => document.getElementById(id)!;
    byId("open-project").click();
    await until(() => (byId("project-game") as HTMLSelectElement).options.length === 2);
    const select = byId("project-game") as HTMLSelectElement;
    select.value = "A.gam";
    byId("open-selected-game").click();
    await until(() => document.querySelector<HTMLInputElement>('#settings input[type="text"]') !== null);
    const controls = globalThis as typeof globalThis & {
      makeShownDocumentDirty?: () => { ok: boolean };
      A?: { workspace: { documents(): readonly { identity: { path: string }; getSnapshot(): { dirty: boolean; gameTitle: string } }[] } };
    };
    assert.equal(controls.makeShownDocumentDirty!().ok, true, "edit the actual document through its host API");
    await until(() => controls.A!.workspace.documents()[0]?.getSnapshot().dirty === true);
    const original = await readFile(new URL(fixtureUrl));
    const input = byId("open-session") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [{ name: "B.gam", arrayBuffer: async () => Uint8Array.from(original).buffer }] });
    input.dispatchEvent(new Event("change"));
    await until(() => document.querySelector("dialog") !== null);
    [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find((button) => button.textContent === "Cancel")!.click();
    await until(() => byId("host-status").textContent?.includes("A.gam is still open") === true);

    const docs = controls.A!.workspace.documents();
    assert.deepEqual(docs.map((item) => item.identity.path), ["A.gam"]);
    assert.equal(docs[0]!.getSnapshot().dirty, true, "the original unsaved edit remains dirty");
    assert.equal(docs[0]!.getSnapshot().gameTitle, "Unsaved title to keep");
    assert.match(byId("host-status").textContent ?? "", /A\.gam is still open; B\.gam was not opened\./);
  } finally {
    const cleanup = globalThis as typeof globalThis & {
      workbenches?: { dispose(): void }[];
      A?: { deactivate(): void };
    };
    for (const workbench of cleanup.workbenches ?? []) workbench.dispose();
    cleanup.A?.deactivate();
    await GlobalRegistrator.unregister();
    await rm(dir, { recursive: true, force: true });
  }
});
