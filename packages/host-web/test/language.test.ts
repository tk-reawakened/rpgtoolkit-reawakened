// TOOL-10-connect: successful project changes refresh the worker's actual file inventory.
import { deepEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createWebLanguageService, notifyOnChange } from "../src/language.ts";

test("#2780 deleting or renaming a directory refreshes the language inventory", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  let receive!: (files: string[]) => void;
  class FakeWorker {
    onmessage: unknown;
    onerror: unknown;
    onmessageerror: unknown;
    postMessage(message: { method?: string; params?: { files?: Array<{ uri: string }> } }) {
      if (message.method === "rpgcode/project") receive((message.params?.files ?? []).map((file) => file.uri).sort());
    }
    terminate() {}
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: FakeWorker });
  t.after(() => {
    if (original === undefined) Reflect.deleteProperty(globalThis, "Worker");
    else Object.defineProperty(globalThis, "Worker", original);
  });
  const host = createMemoryPlatformServices({ files: {
    "Main/example.gam": new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url))),
    "Prg/lib/help.prg": new TextEncoder().encode("x=1"),
    "Prg/main.prg": new TextEncoder().encode("end()"),
  } });
  const language = createWebLanguageService(host.fs, { workerUrl: "/worker.js" });
  const fs = notifyOnChange(host.fs, (path) => language.notifyWritten(path));
  const connected = await language.connect({ project: { main: "Main/example.gam" } });
  ok(connected.ok);
  t.after(() => connected.value.dispose());
  const snapshot = () => new Promise<string[]>((resolve) => { receive = resolve; });
  const initial = snapshot();
  connected.value.send({ jsonrpc: "2.0", method: "initialized", params: {} });
  deepEqual(await initial, ["file:///project/Prg/lib/help.prg", "file:///project/Prg/main.prg"]);
  const renamed = snapshot();
  ok((await fs.rename("Prg/lib", "Prg/renamed.folder")).ok);
  t.mock.timers.tick(500);
  deepEqual(await renamed, ["file:///project/Prg/main.prg", "file:///project/Prg/renamed.folder/help.prg"]);
  const removed = snapshot();
  ok((await fs.delete("Prg/renamed.folder")).ok);
  t.mock.timers.tick(500);
  deepEqual(await removed, ["file:///project/Prg/main.prg"]);
});
