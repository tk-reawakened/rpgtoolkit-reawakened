import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { createUniqueWebProjectId, registerWebProject } from "../src/projects.ts";
import { hostErrors } from "../src/host-log.ts";

test("browser project identities retry UUID collisions and remain unique", () => {
  const existing = new Set(["web:duplicate"]);
  const generated: string[] = [];
  const ids = ["duplicate", "new-project"];
  const id = createUniqueWebProjectId(existing, () => {
    const next = ids.shift();
    if (next === undefined) throw new Error("UUID generator exhausted");
    generated.push(next);
    return next;
  });
  equal(id, "web:new-project");
  deepEqual(generated, ["duplicate", "new-project"]);
});

test("a projects database version mismatch is logged with the operation that failed", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const versionError = new DOMException("the requested version is older than the stored one", "VersionError");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        const request: { error?: unknown; onerror?: () => void } = { error: versionError };
        queueMicrotask(() => request.onerror?.());
        return request;
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  });
  equal(await registerWebProject({} as FileSystemDirectoryHandle), null);
  const last = hostErrors().at(-1);
  equal(last?.scope, "projects.open");
  equal(last?.name, "VersionError");
});
