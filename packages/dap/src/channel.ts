/**
 * The stream side of a debug session (TOOL-8 server note).
 *
 * `serveDebugSession` joins a session to a pair of streams: framed requests
 * arrive on `input`, and responses and events leave as framed text on
 * `output`. That is exactly the shape of a process's stdin and stdout, and of an
 * in-memory pair in a test, so the same code serves both and nothing here knows
 * which it has (AD-21: `dap` never imports Node).
 *
 * docs/spec/engine/rpgcode-tooling.md#tool-8-server
 */

import { createFramer, frameMessage } from "./protocol.ts";
import { createDebugSession, type DebugSession, type DebugSessionOptions } from "./session.ts";

/** The two directions of one stream: what arrives, and where to write. */
export type DebugStreams = {
  /** Register the listener that receives the stream's bytes; it is called for every chunk. */
  readonly input: { onData(listener: (chunk: Uint8Array) => void): void };
  readonly output: { write(text: string): void };
};

/** Answer the requests that arrive on `streams` until the client disconnects. */
export function serveDebugSession(streams: DebugStreams, options: DebugSessionOptions): DebugSession {
  const session = createDebugSession(options, (message) => streams.output.write(frameMessage(message)));
  const framer = createFramer();
  streams.input.onData((chunk) => {
    for (const message of framer.feed(chunk)) {
      if (message.type === "request") session.handle(message);
    }
  });
  return session;
}
