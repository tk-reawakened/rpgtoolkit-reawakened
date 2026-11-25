// The browser host declares `clipboard` exactly when the page has an asynchronous clipboard, and its service is that one.
import { afterEach, test } from "node:test";
import { equal, ok } from "node:assert/strict";
import { createSessionCopy } from "../src/index.ts";

const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");

afterEach(() => {
  if (original === undefined) Reflect.deleteProperty(globalThis, "navigator");
  else Object.defineProperty(globalThis, "navigator", original);
});

const withClipboard = (clipboard: unknown): void => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard } });
};

test("a page with an asynchronous clipboard declares the capability and exchanges text through it", async () => {
  let held = "";
  withClipboard({ readText: async () => held, writeText: async (text: string) => { held = text; } });
  const { services } = createSessionCopy("game.gam", new Uint8Array([1]));
  ok(services.capabilities.has("clipboard"));
  ok(services.clipboard);
  ok((await services.clipboard.writeText("board data")).ok);
  equal(held, "board data");
  const read = await services.clipboard.readText();
  ok(read.ok);
  equal(read.value, "board data");
});

test("a page without one declares no clipboard and offers no service", () => {
  withClipboard(undefined);
  const { services } = createSessionCopy("game.gam", new Uint8Array([1]));
  equal(services.capabilities.has("clipboard"), false);
  equal(services.clipboard, undefined);
});

test("a clipboard the page refuses to use is reported, not thrown", async () => {
  withClipboard({ readText: async () => { throw new Error("denied"); }, writeText: async () => { throw new Error("denied"); } });
  const { services } = createSessionCopy("game.gam", new Uint8Array([1]));
  ok(services.clipboard);
  const written = await services.clipboard.writeText("x");
  ok(!written.ok);
  equal(written.error.code, "permission-denied");
});
