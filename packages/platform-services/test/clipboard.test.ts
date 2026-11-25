// The clipboard service of AD-20 as 13.13 declares it: a browser-style clipboard becomes a service that never throws,
// a page without one gives none, and the in-memory double has one only when its host declares the capability.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { clipboardFromApi } from "../src/index.ts";
import { createMemoryPlatformServices } from "../src/testing.ts";

test("a page without an asynchronous clipboard has no clipboard service", () => {
  equal(clipboardFromApi(undefined), null);
  equal(clipboardFromApi(null), null);
  equal(clipboardFromApi({} as never), null);
});

test("reads and writes pass text through and a rejection becomes permission-denied", async () => {
  let held = "";
  const working = clipboardFromApi({ readText: async () => held, writeText: async (text) => { held = text; } });
  ok(working);
  ok((await working.writeText("hello")).ok);
  const read = await working.readText();
  ok(read.ok);
  equal(read.value, "hello");

  const refused = clipboardFromApi({ readText: async () => { throw new Error("blocked"); }, writeText: async () => { throw new Error("blocked"); } });
  ok(refused);
  const failedRead = await refused.readText();
  const failedWrite = await refused.writeText("x");
  ok(!failedRead.ok && !failedWrite.ok);
  equal(failedRead.error.code, "permission-denied");
  equal(failedWrite.error.code, "permission-denied");
});

test("the in-memory host has a clipboard only with the capability, keeps text, and can be made to refuse", async () => {
  equal(createMemoryPlatformServices().clipboard, undefined);
  const host = createMemoryPlatformServices({ capabilities: ["clipboard"] });
  ok(host.clipboard);
  ok((await host.clipboard.writeText("abc")).ok);
  equal(host.clipboardText, "abc");
  host.clipboardText = "set by a test";
  const read = await host.clipboard.readText();
  ok(read.ok);
  equal(read.value, "set by a test");

  host.failClipboard({ code: "permission-denied", message: "no" });
  const denied = await host.clipboard.writeText("never");
  ok(!denied.ok);
  deepEqual(denied.error, { code: "permission-denied", message: "no" });
  equal(host.clipboardText, "set by a test", "a refused write changes nothing");
  host.failClipboard(null);
  ok((await host.clipboard.readText()).ok);
});
