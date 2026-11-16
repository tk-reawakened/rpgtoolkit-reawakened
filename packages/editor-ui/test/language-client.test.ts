// The program editor's JSON-RPC client over `language.connect()` (docs/spec/engine/rpgcode-tooling.md#tool-10-connect),
// against the in-memory double playing the server.
import { test } from "node:test";
import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import type { LanguageMessage } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices, type MemoryLanguageSession } from "@tk-reawakened/platform-services/testing";
import { leaseLanguageClient, startLanguageClient } from "../src/language-client.ts";

function host(answer: (message: LanguageMessage, session: MemoryLanguageSession) => void = () => {}) {
  return createMemoryPlatformServices({
    capabilities: ["languageServer"],
    onLanguageMessage: (message, session) => {
      if (message.method === "initialize") session.push({ jsonrpc: "2.0", id: message.id as number, result: { capabilities: {} } });
      answer(message, session);
    },
  });
}

test("the handshake sends initialize then initialized, and a request resolves with the server's result", async () => {
  const services = host((message, session) => {
    if (message.method === "echo") session.push({ jsonrpc: "2.0", id: message.id as number, result: message.params });
  });
  const client = await startLanguageClient(services.language!, { project: null });
  deepEqual(services.languageSessions[0]!.sent.map((message) => message.method), ["initialize", "initialized"]);
  deepEqual(await client.request("echo", { a: 1 }), { a: 1 });
});

test("a server error rejects the request with its message, and a server that never starts is reported", async () => {
  const services = host((message, session) => {
    if (message.method === "fail") session.push({ jsonrpc: "2.0", id: message.id as number, error: { code: -1, message: "no such thing" } });
  });
  const client = await startLanguageClient(services.language!, { project: null });
  await rejects(client.request("fail", {}), /no such thing/);
  const broken = createMemoryPlatformServices({
    capabilities: ["languageServer"],
    onLanguageMessage: (message, session) => {
      if (message.method === "initialize") session.push({ jsonrpc: "2.0", id: message.id as number, error: { code: -32603, message: "boot failed" } });
    },
  });
  await rejects(startLanguageClient(broken.language!, { project: null }), /did not start: boot failed/);
  equal(broken.languageSessions[0]!.disposed(), true, "a failed handshake releases the session");
});

test("notifications reach their listeners, and a request from the server is answered method-not-found", async () => {
  const services = host();
  const client = await startLanguageClient(services.language!, { project: null });
  const seen: unknown[] = [];
  const stop = client.onNotification("window/showMessage", (params) => seen.push(params));
  const session = services.languageSessions[0]!;
  session.push({ jsonrpc: "2.0", method: "window/showMessage", params: { message: "hi" } });
  stop();
  session.push({ jsonrpc: "2.0", method: "window/showMessage", params: { message: "ignored" } });
  deepEqual(seen, [{ message: "hi" }]);
  session.push({ jsonrpc: "2.0", id: 77, method: "client/registerCapability", params: {} });
  deepEqual(session.sent.at(-1), { jsonrpc: "2.0", id: 77, error: { code: -32601, message: "Method not found: client/registerCapability" } });
});

test("when the connection ends, pending requests reject, listeners are told once and later requests reject at once", async () => {
  const services = host();
  const client = await startLanguageClient(services.language!, { project: null });
  const told: string[] = [];
  client.onClose((message) => told.push(message));
  const pending = client.request("never", {});
  services.languageSessions[0]!.stop("The server crashed.");
  await rejects(pending, /The server crashed\./);
  deepEqual(told, ["The server crashed."]);
  await rejects(client.request("again", {}), /The server crashed\./);
  const late: string[] = [];
  client.onClose((message) => late.push(message));
  deepEqual(late, ["The server crashed."]);
});

test("leases share one session per project, the last release ends it, and a failed start is not remembered", async () => {
  const services = host();
  const first = await leaseLanguageClient(services.language!, { main: "Main/a.gam" }, 0);
  const second = await leaseLanguageClient(services.language!, { main: "Main/a.gam" }, 0);
  ok(first.ok && second.ok);
  equal(services.languageSessions.length, 1);
  const other = await leaseLanguageClient(services.language!, null, 0);
  ok(other.ok);
  equal(services.languageSessions.length, 2);
  first.lease.release();
  first.lease.release();
  equal(services.languageSessions[0]!.disposed(), false);
  second.lease.release();
  equal(services.languageSessions[0]!.disposed(), true);
  const again = await leaseLanguageClient(services.language!, { main: "Main/a.gam" }, 0);
  ok(again.ok);
  equal(services.languageSessions.length, 3, "a new session starts after the last one ended");
  services.failLanguage("no worker");
  const failed = await leaseLanguageClient(services.language!, { main: "Main/b.gam" }, 0);
  ok(!failed.ok && failed.message === "no worker");
  services.failLanguage(null);
  const retried = await leaseLanguageClient(services.language!, { main: "Main/b.gam" }, 0);
  ok(retried.ok);
});
