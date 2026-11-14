// The browser host's settings: the user layer in storage, the project layer in a plain project file.
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createWebSettings, PROJECT_SETTINGS_PATH } from "../src/index.ts";

const storage = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
};

test("the project layer is a JSON file in the project and removing a value removes its key", async () => {
  const host = createMemoryPlatformServices({});
  const settings = createWebSettings(host.fs, storage(), true);
  await settings.set("project", "board.startLocationDisplay", "every");
  const file = await host.fs.read(PROJECT_SETTINGS_PATH);
  equal(file.ok && new TextDecoder().decode(file.value), '{\n  "board.startLocationDisplay": "every"\n}\n');
  deepEqual(await settings.get("project", "board.startLocationDisplay"), { ok: true, value: "every" });
  await settings.set("project", "board.startLocationDisplay", null);
  deepEqual(await settings.get("project", "board.startLocationDisplay"), { ok: true, value: null });
});

test("the user layer survives a new settings object over the same storage and stays out of the project", async () => {
  const host = createMemoryPlatformServices({});
  const store = storage();
  await createWebSettings(host.fs, store, true).set("user", "editor.showTips", false);
  deepEqual(await createWebSettings(host.fs, store, true).get("user", "editor.showTips"), { ok: true, value: false });
  equal((await host.fs.read(PROJECT_SETTINGS_PATH)).ok, false);
});

test("without storage the user layer lasts for the page; a read-only project refuses the project layer", async () => {
  const host = createMemoryPlatformServices({});
  const settings = createWebSettings(host.fs, null, false);
  await settings.set("user", "editor.showSplash", false);
  deepEqual(await settings.get("user", "editor.showSplash"), { ok: true, value: false });
  const refused = await settings.set("project", "board.startLocationDisplay", "every");
  equal(refused.ok, false);
  equal((await host.fs.read(PROJECT_SETTINGS_PATH)).ok, false);
});

test("a project file that is not an object of settings reads as empty", async () => {
  const host = createMemoryPlatformServices({ files: { [PROJECT_SETTINGS_PATH]: new TextEncoder().encode("[1]") } });
  deepEqual(await createWebSettings(host.fs, null, true).get("project", "x"), { ok: true, value: null });
});
