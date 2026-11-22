import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../cdp-client.mjs";

/** A WebSocket stand-in: records requests, lets the test emit open/message/close. */
function fakeSocket() {
  const listeners = new Map();
  return {
    sent: [],
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    send(payload) {
      this.sent.push(JSON.parse(payload));
    },
    close() {
      this.emit("close");
    },
    emit(type, event = {}) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
  };
}

function harness(requestTimeoutMs = 50) {
  const socket = fakeSocket();
  const timers = [];
  const client = connect("ws://example.invalid", {
    requestTimeoutMs,
    createSocket: () => socket,
    // No real time: each scheduled callback is recorded and fired by the test.
    schedule: (callback) => {
      timers.push(callback);
      return () => {};
    },
  });
  return { socket, timers, client };
}

test("a handshake that never opens fails within the request bound", { timeout: 1000 }, async () => {
  const { timers, client } = harness();
  const pending = client.send("Runtime.evaluate");
  timers[0]();
  await assert.rejects(pending, /did not open within 50 ms/);
});

test("a request that never answers fails within the request bound", { timeout: 1000 }, async () => {
  const { socket, timers, client } = harness();
  const pending = client.send("Input.dispatchKeyEvent");
  socket.emit("open");
  await Promise.resolve(); // let send leave the bounded handshake and register its request timer
  timers.at(-1)();
  await assert.rejects(pending, /did not answer within 50 ms/);
});

test("a close rejects every pending request", { timeout: 1000 }, async () => {
  const { socket, client } = harness();
  const pending = client.send("Runtime.evaluate");
  socket.emit("open");
  await Promise.resolve();
  socket.emit("close");
  await assert.rejects(pending, /closed before the Runtime\.evaluate reply/);
});

test("a reply resolves the matching request", async () => {
  const { socket, client } = harness();
  const pending = client.send("Runtime.evaluate", { expression: "1+1" });
  socket.emit("open");
  await Promise.resolve();
  const [{ id, method, params }] = socket.sent;
  assert.equal(method, "Runtime.evaluate");
  assert.deepEqual(params, { expression: "1+1" });
  socket.emit("message", { data: JSON.stringify({ id, result: { value: 2 } }) });
  assert.deepEqual(await pending, { value: 2 });
});

test("a closed client refuses new requests", async () => {
  const { socket, client } = harness();
  socket.emit("open");
  client.close();
  await assert.rejects(client.send("Runtime.evaluate"), /closed before Runtime\.evaluate/);
});
