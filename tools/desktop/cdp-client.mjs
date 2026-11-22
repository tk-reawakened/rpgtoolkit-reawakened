// A tiny CDP client for the desktop probes (#2169).
//
// Every request is bounded twice: the WebSocket handshake by `requestTimeoutMs`, and each request after it by the same
// bound so a renderer that dies mid-probe fails fast instead of hanging until the CI step cap. Closing the socket
// rejects everything still waiting. `createSocket` and `schedule` are injected so tests can drive time and events.

/**
 * Connect to a CDP endpoint. Returns `{ send(method, params), close() }`.
 * `schedule(callback, ms)` returns a cancel function; it exists so tests never wait on a real timer.
 */
export function connect(url, {
  requestTimeoutMs = 30_000,
  createSocket = (target) => new WebSocket(target),
  schedule = (callback, ms) => {
    const timer = setTimeout(callback, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
} = {}) {
  const socket = createSocket(url);
  let nextId = 1;
  let closed = false;
  const waiting = new Map();
  socket.addEventListener("message", (message) => {
    const payload = JSON.parse(String(message.data));
    const pending = waiting.get(payload.id);
    if (pending === undefined) return;
    waiting.delete(payload.id);
    if (payload.error !== undefined) pending.fail(new Error(payload.error.message));
    else pending.done(payload.result);
  });
  const failAll = (reason) => {
    if (closed) return;
    closed = true;
    for (const [id, pending] of waiting) {
      waiting.delete(id);
      pending.fail(new Error(`${reason} before the ${pending.method} reply`));
    }
  };
  const ready = new Promise((done, fail) => {
    const cancel = requestTimeoutMs > 0
      ? schedule(() => fail(new Error(`the debugging socket did not open within ${requestTimeoutMs} ms`)), requestTimeoutMs)
      : () => {};
    socket.addEventListener("open", () => { cancel(); done(); });
    socket.addEventListener("error", () => { cancel(); fail(new Error("the debugging socket failed")); });
    socket.addEventListener("close", () => { cancel(); fail(new Error("the debugging socket closed before it opened")); });
  });
  // A socket that fails before the first `send` must not become an unhandled rejection; `send` still sees the rejection.
  ready.catch(() => {});
  socket.addEventListener("close", () => failAll("the debugging socket closed"));
  socket.addEventListener("error", () => failAll("the debugging socket failed"));
  return {
    async send(method, params = {}) {
      if (closed) throw new Error(`the debugging socket closed before ${method}`);
      // The handshake is bounded by the `ready` timer, so a stalled WebSocket open cannot hold the probe either.
      await ready;
      if (closed) throw new Error(`the debugging socket closed before ${method}`);
      const id = nextId;
      nextId += 1;
      let cancel = () => {};
      const result = new Promise((done, fail) => {
        waiting.set(id, { done, fail, method });
        if (requestTimeoutMs > 0) {
          cancel = schedule(() => {
            if (waiting.delete(id)) fail(new Error(`${method} did not answer within ${requestTimeoutMs} ms`));
          }, requestTimeoutMs);
        }
      });
      try {
        socket.send(JSON.stringify({ id, method, params }));
        return await result;
      } finally {
        cancel();
      }
    },
    close() {
      try {
        socket.close();
      } catch {
        // Already gone.
      }
      failAll("the debugging client was closed");
    },
  };
}
