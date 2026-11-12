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
    document.body.innerHTML = `<button id="open-project"></button><input id="open-session" type="file"><label id="project-game-label"></label><select id="project-game"></select><button id="open-selected-game"></button><label id="recent-project-label"></label><select id="recent-project"></select><button id="reopen-project"></button><p id="host-status"></p><section id="settings"></section>`;
    const hostUrl = pathToFileURL(resolve("packages/host-web/dist/index.js")).href;
    const fixtureUrl = pathToFileURL(resolve("docs/spec/examples/game/Main/example.gam")).href;
    await writeFile(join(dir, "host.mjs"), `
import * as real from ${JSON.stringify(hostUrl)};
import { readFileSync } from 'node:fs';
const data = new Uint8Array(readFileSync(new URL(${JSON.stringify(fixtureUrl)})));
export const A = real.createSessionCopy('game.gam', data);
A.services.fs.list = async () => ({ok:true,value:[{name:'game.gam',kind:'file'},{name:'game.gam',kind:'file'}]});
export const openWebProject = async () => A;
export const reopenWebProject = real.reopenWebProject;
export const listRecentWebProjects = async () => [];
export const createSessionCopy = real.createSessionCopy;
let count = 0;
let release;
const gate = new Promise(resolve => { release = resolve; });
globalThis.releaseStaleOpen = release;
export async function openGameSettings(project, path, element) {
  const result = await real.openGameSettings(project, path, element);
  if (project === A && ++count === 2) { globalThis.staleOpenReady = true; await gate; }
  return result;
}`);
    const source = await readFile(resolve("tools/browser/editor-web/main.tsx"), "utf8");
    const transformed = await transform(source, { loader: "tsx", format: "esm" });
    await writeFile(join(dir, "shell.mjs"), transformed.code.replace('"@tk-reawakened/host-web"', JSON.stringify(pathToFileURL(join(dir, "host.mjs")).href)));
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
    const controls = globalThis as typeof globalThis & { staleOpenReady?: boolean; releaseStaleOpen?: () => void };
    await until(() => controls.staleOpenReady === true);
    const original = await readFile(new URL(fixtureUrl));
    const input = byId("open-session") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [{ name: "B.gam", arrayBuffer: async () => Uint8Array.from(original).buffer }] });
    input.dispatchEvent(new Event("change"));
    await until(() => byId("host-status").textContent?.includes("B.gam") === true);
    controls.releaseStaleOpen!();
    await until(() => document.querySelectorAll("#settings > div").length === 1);
    assert.match(byId("host-status").textContent ?? "", /B\.gam/);
    const title = document.querySelector<HTMLInputElement>("#settings input")!;
    title.value = "Still writable";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    title.dispatchEvent(new Event("change", { bubbles: true }));
    const button = [...document.querySelectorAll<HTMLButtonElement>("#settings button")].find((item) => item.textContent === "Save")!;
    button.click();
    await until(() => byId("settings").textContent?.includes("All changes saved") === true);
  } finally {
    GlobalRegistrator.unregister();
    await rm(dir, { recursive: true, force: true });
  }
});
