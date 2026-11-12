/**
 * The stdio host of the debug adapter (TOOL-8 server note; entry 10.10).
 *
 * The binary is started as a child process and speaks framed DAP over its own
 * stdin and stdout, which is how an editor launches it. One session runs far
 * enough to prove the pipe, the launch arguments and a stop at a breakpoint.
 */

import { deepEqual, equal, ok } from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createFramer, frameMessage, type DapEvent, type DapIncoming, type DapRequest, type DapResponse } from "../src/index.ts";

const FIXTURE = new URL("./fixtures/probe/", import.meta.url);
const PROGRAM_PATH = decodeURIComponent(new URL("Prg/probe.prg", FIXTURE).pathname);
const BOARD_PATH = decodeURIComponent(new URL("Boards/probe.brd", FIXTURE).pathname);
const BIN = decodeURIComponent(new URL("../bin/stdio.ts", import.meta.url).pathname);
const PROGRAM = readFileSync(PROGRAM_PATH, "utf8");
const CALL_LINE = PROGRAM.split("\n").findIndex((line) => !line.trimStart().startsWith("//") && line.includes("result = twice(seed)")) + 1;

type Body = Record<string, unknown>;

function recordOf(value: unknown): Body {
  return typeof value === "object" && value !== null ? value as Body : {};
}

test("the stdio binary answers a session over its own pipes", async () => {
  const child = spawn(process.execPath, [BIN, "--program", PROGRAM_PATH, "--board", BOARD_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const errors: string[] = [];
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk.toString()));
  const inbox: DapIncoming[] = [];
  const waiters: { match: (message: DapIncoming) => boolean; resolve: (message: DapIncoming) => void }[] = [];
  const framer = createFramer();
  const receive = (message: DapIncoming): void => {
    const at = waiters.findIndex((waiter) => waiter.match(message));
    if (at < 0) inbox.push(message);
    else waiters.splice(at, 1)[0]!.resolve(message);
  };
  child.stdout.on("data", (chunk: Buffer) => {
    for (const message of framer.feed(new Uint8Array(chunk))) receive(message);
  });
  let seq = 1;
  // A message that never arrives must fail the test, not hang it.
  const take = (match: (message: DapIncoming) => boolean, what: string): Promise<DapIncoming> => {
    const at = inbox.findIndex(match);
    if (at >= 0) return Promise.resolve(inbox.splice(at, 1)[0]!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${what} arrived from the binary within 10 s: ${errors.join("")}`)), 10_000);
      waiters.push({ match, resolve: (message) => { clearTimeout(timer); resolve(message); } });
    });
  };
  const request = (command: string, args?: unknown): Promise<DapResponse> => {
    const requestSeq = seq++;
    const message: DapRequest = args === undefined
      ? { seq: requestSeq, type: "request", command }
      : { seq: requestSeq, type: "request", command, arguments: args };
    child.stdin.write(frameMessage(message));
    return take((incoming) => incoming.type === "response" && incoming.request_seq === requestSeq, `response to "${command}"`) as Promise<DapResponse>;
  };
  const event = (name: string): Promise<DapEvent> =>
    take((incoming) => incoming.type === "event" && incoming.event === name, `"${name}" event`) as Promise<DapEvent>;

  try {
    ok((await request("initialize", { adapterID: "rpgcode" })).success);
    ok((await request("launch", { program: PROGRAM_PATH })).success);
    await event("initialized");
    ok((await request("setBreakpoints", { source: { path: PROGRAM_PATH }, breakpoints: [{ line: CALL_LINE }] })).success);
    ok((await request("configurationDone")).success);
    equal(recordOf((await event("stopped")).body).reason, "entry");
    ok((await request("continue", { threadId: 1 })).success);
    const stopped = recordOf((await event("stopped")).body);
    equal(stopped.reason, "breakpoint");
    equal(stopped.threadId, 1);

    const stack = recordOf((await request("stackTrace", { threadId: 1 })).body);
    const top = (stack.stackFrames as Body[])[0];
    equal(top?.name, "compute");
    equal(top?.line, CALL_LINE);
    deepEqual(top?.source, { name: "probe.prg", path: PROGRAM_PATH });

    const watch = await request("evaluate", { expression: "seed + 1", frameId: top?.id });
    ok(watch.success);
    equal(String(recordOf(watch.body).result), "4");

    ok((await request("disconnect")).success);
  } finally {
    child.stdin.end();
    child.kill();
  }
});
