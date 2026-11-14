// The preferences view over the real model and the in-memory host's settings, under the DOM shim of the other view tests.
import { after, before, test } from "node:test";
import { equal, match, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createPreferences } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";

let mountPreferences: typeof import("../src/index.ts")["mountPreferences"];
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mountPreferences } = await import("@tk-reawakened/editor-ui"));
});
after(() => GlobalRegistrator.unregister());

const settle = async (): Promise<void> => {
  for (let round = 0; round < 6; round += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};

async function setup() {
  const host = createMemoryPlatformServices({});
  const preferences = createPreferences({ settings: host.settings });
  const el = document.createElement("div");
  document.body.append(el);
  const handle = mountPreferences(el, { preferences });
  await settle();
  return { host, preferences, el, handle };
}
const field = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-preference="${id}"]`)!;

test("a toggle changes the user layer, shows where its value comes from, and resets", async () => {
  const { host, el } = await setup();
  const row = field(el, "editor.showTips");
  const box = row.querySelector<HTMLInputElement>("input[type=checkbox]")!;
  equal(box.checked, true);
  match(row.textContent!, /Using the default/);
  await act(async () => { box.click(); });
  await settle();
  deepEqualValue(await host.settings.get("user", "editor.showTips"), false);
  match(field(el, "editor.showTips").textContent!, /Using your setting/);
  const reset = field(el, "editor.showTips").querySelector<HTMLButtonElement>("button")!;
  await act(async () => { reset.click(); });
  await settle();
  deepEqualValue(await host.settings.get("user", "editor.showTips"), null);
});

test("an invalid colour is refused beside its field, announced, and nothing is stored", async () => {
  const { host, el } = await setup();
  const input = field(el, "syntax.keyword.color").querySelector<HTMLInputElement>("input[type=text]")!;
  await act(async () => {
    input.value = "blue";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await settle();
  const alert = field(el, "syntax.keyword.color").querySelector('[role="alert"]');
  ok(alert !== null);
  match(alert.textContent!, /six hexadecimal digits/);
  equal(input.getAttribute("aria-invalid"), "true");
  deepEqualValue(await host.settings.get("user", "syntax.keyword.color"), null);
});

test("only an entry a project may set offers the project layer, and search narrows the list", async () => {
  const { el } = await setup();
  ok(field(el, "board.startLocationDisplay").querySelector(".tkr-pref-layer") !== null);
  equal(field(el, "editor.showTips").querySelector(".tkr-pref-layer"), null);
  const search = el.querySelector<HTMLInputElement>("input[type=search]")!;
  await act(async () => {
    search.value = "splash";
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
  equal(el.querySelectorAll("[data-preference]").length, 1);
});

function deepEqualValue(result: { readonly ok: boolean; readonly value?: unknown }, expected: unknown): void {
  ok(result.ok);
  equal(result.value, expected);
}
