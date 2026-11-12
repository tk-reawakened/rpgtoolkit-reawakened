/**
 * The RPGCode debug adapter (TOOL-1, TOOL-8; AD-21).
 *
 * `createDebugSession` answers the Debug Adapter Protocol over the `Engine`
 * port alone, and `serveDebugSession` joins it to a pair of streams. The stdio
 * entry point is a program binary outside this export, so importing the package
 * never opens a pipe.
 *
 * The scene a session drives is built by `createSceneDebugTarget` in
 * `@tk-reawakened/runner-harness` (the platform-neutral half of the headless
 * runner); this package adds no third-party dependency and imports no Node API.
 *
 * docs/spec/engine/rpgcode-tooling.md#tool-8
 */

export { createDebugSession } from "./session.ts";
export type { DebugSession, DebugSessionOptions } from "./session.ts";
export { serveDebugSession } from "./channel.ts";
export type { DebugStreams } from "./channel.ts";
export { createFramer, frameMessage } from "./protocol.ts";
export type { DapEvent, DapIncoming, DapMessage, DapRequest, DapResponse } from "./protocol.ts";
