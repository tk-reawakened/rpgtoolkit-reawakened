/**
 * The debug adapter over a stream pair (TOOL-8; entry 10.10 acceptance).
 *
 * A client writes framed DAP bytes into one end of a stream pair and reads the
 * session's framed responses and events from the other — the same path the
 * stdio host uses. The fixture is `test/fixtures/probe`: an empty authored
 * board and a program with two threads and a call inside a function.
 */

import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSceneDebugTarget, type SceneDebugTarget } from "@tk-reawakened/runner-harness";
import {
  createFramer,
  frameMessage,
  serveDebugSession,
  type DapEvent,
  type DapIncoming,
  type DapRequest,
  type DapResponse,
  type DebugSessionOptions,
} from "../src/index.ts";

const FIXTURE = new URL("./fixtures/probe/", import.meta.url);
const PROGRAM_PATH = decodeURIComponent(new URL("Prg/probe.prg", FIXTURE).pathname);
const BOARD_PATH = decodeURIComponent(new URL("Boards/probe.brd", FIXTURE).pathname);
const PROGRAM = readFileSync(PROGRAM_PATH, "utf8");
const BOARD = new Uint8Array(readFileSync(BOARD_PATH));
const LINES = PROGRAM.split("\n");

/** The 1-based line of the first statement (never a comment) that contains `text`. */
function lineOf(text: string): number {
  const at = LINES.findIndex((line) => !line.trimStart().startsWith("//") && line.includes(text));
  if (at < 0) throw new Error(`the fixture has no line with "${text}"`);
  return at + 1;
}

const CALL_LINE = lineOf("result = twice(seed)");
const AFTER_CALL_LINE = lineOf("return seed * 10");
const CALLEE_LINE = lineOf("local(doubled)");

type Body = Record<string, unknown>;

function recordOf(value: unknown): Body {
  return typeof value === "object" && value !== null ? value as Body : {};
}

function scene(): SceneDebugTarget {
  return createSceneDebugTarget({
    board: "probe.brd",
    boardBytes: BOARD,
    program: PROGRAM,
    programPath: PROGRAM_PATH,
    seed: 7,
    width: 320,
    height: 240,
  });
}

type Client = {
  request(command: string, args?: unknown): Promise<DapResponse>;
  nextEvent(): Promise<DapEvent>;
  /** The custom `rpgcode.stopped` companion event: the deterministic stop signal a host has. */
  nextCustomStop(): Promise<DapEvent>;
  send(text: string): void;
  sendBytes(bytes: Uint8Array): void;
};

/** A client on one end of a stream pair, with the session served on the other. */
function connect(onTarget?: (target: SceneDebugTarget) => void): Client {
  const inbox: DapIncoming[] = [];
  const waiters: { match: (message: DapIncoming) => boolean; resolve: (message: DapIncoming) => void }[] = [];
  const toServer: ((chunk: Uint8Array) => void)[] = [];
  const clientFramer = createFramer();
  let seq = 1;

  const receive = (message: DapIncoming): void => {
    const at = waiters.findIndex((waiter) => waiter.match(message));
    if (at < 0) {
      inbox.push(message);
      return;
    }
    waiters.splice(at, 1)[0]!.resolve(message);
  };
  // The project's lib floor is ES2022, so `Promise.withResolvers` is not available here.
  // The session answers synchronously, so every wait is satisfied by the very next message; a test
  // that expected the wrong message gets it and fails its assertion instead of waiting.
  const take = (match: (message: DapIncoming) => boolean): Promise<DapIncoming> => {
    const at = inbox.findIndex(match);
    if (at >= 0) return Promise.resolve(inbox.splice(at, 1)[0]!);
    return new Promise((resolve) => waiters.push({ match, resolve }));
  };
  const takeAny = (): Promise<DapIncoming> => take(() => true);
  const sendBytes = (bytes: Uint8Array): void => {
    for (const listener of toServer) listener(bytes);
  };
  const send = (text: string): void => {
    sendBytes(new Uint8Array(Buffer.from(text, "utf8")));
  };

  const options: DebugSessionOptions = {
    launch: () => {
      const target = scene();
      onTarget?.(target);
      return target;
    },
  };
  serveDebugSession(
    {
      input: { onData: (listener) => void toServer.push(listener) },
      output: {
        write: (text) => {
          for (const message of clientFramer.feed(new Uint8Array(Buffer.from(text, "utf8")))) receive(message);
        },
      },
    },
    options,
  );

  const request = (command: string, args?: unknown): Promise<DapResponse> => {
    const requestSeq = seq++;
    const message: DapRequest = args === undefined
      ? { seq: requestSeq, type: "request", command }
      : { seq: requestSeq, type: "request", command, arguments: args };
    send(frameMessage(message));
    return take((incoming) => incoming.type === "response" && incoming.request_seq === requestSeq) as Promise<DapResponse>;
  };
  const client: Client = {
    request,
    send,
    sendBytes,
    // The session also sends `rpgcode.stopped` beside each standard `stopped`; the assertions
    // here are about the standard events, so the custom companion is dropped.
    nextEvent: async () => {
      for (;;) {
        const message = await takeAny();
        if (message.type === "event" && message.event !== "rpgcode.stopped") return message;
      }
    },
    nextCustomStop: () => take((incoming) => incoming.type === "event" && incoming.event === "rpgcode.stopped") as Promise<DapEvent>,
  };
  return client;
}

/** Launch the fixture, stop at the call line, and hand the client back. */
async function stoppedAtTheCall(client: Client): Promise<void> {
  ok((await client.request("initialize", { adapterID: "rpgcode" })).success);
  ok((await client.request("launch", { program: PROGRAM_PATH })).success);
  equal((await client.nextEvent()).event, "initialized");
  ok((await client.request("setBreakpoints", { source: { path: PROGRAM_PATH }, breakpoints: [{ line: CALL_LINE }] })).success);
  ok((await client.request("configurationDone")).success);
  const entry = await client.nextEvent();
  equal(entry.event, "stopped");
  equal(recordOf(entry.body).reason, "entry");
  ok((await client.request("continue", { threadId: 1 })).success);
  const stoppedEvent = await client.nextEvent();
  equal(stoppedEvent.event, "stopped");
  const stopped = recordOf(stoppedEvent.body);
  equal(stopped.reason, "breakpoint");
  equal(stopped.threadId, 1);
}

async function stackOf(client: Client, threadId: number): Promise<Body[]> {
  const body = recordOf((await client.request("stackTrace", { threadId })).body);
  return Array.isArray(body.stackFrames) ? body.stackFrames as Body[] : [];
}

async function localsOf(client: Client, frameId: unknown): Promise<Record<string, string>> {
  const scopes = recordOf((await client.request("scopes", { frameId: Number(frameId) })).body);
  const list = Array.isArray(scopes.scopes) ? scopes.scopes as Body[] : [];
  const seen: Record<string, string> = {};
  for (const [position, name] of [[0, "locals"], [1, "globals"]] as const) {
    const variables = recordOf((await client.request("variables", { variablesReference: list[position]?.variablesReference })).body);
    const entries = Array.isArray(variables.variables) ? variables.variables as Body[] : [];
    for (const entry of entries) seen[`${name}.${String(entry.name)}`] = String(entry.value);
  }
  return seen;
}

test("a session stops at a breakpoint and lists two threads with their frames", async () => {
  const client = connect();
  await stoppedAtTheCall(client);

  const threads = recordOf((await client.request("threads")).body);
  deepEqual((threads.threads as Body[]).map((thread) => thread.id), [1, 2]);

  const top = await stackOf(client, 1);
  equal(top.length, 2, "the top-level frame and compute()");
  equal(top[0]?.name, "compute");
  equal(top[0]?.line, CALL_LINE);
  deepEqual(top[0]?.source, { name: "probe.prg", path: PROGRAM_PATH });

  const spare = await stackOf(client, 2);
  equal(spare.length, 1, "the started thread has a frame of its own");
  equal(typeof recordOf(spare[0]?.source).sourceReference, "number", "a thread snippet is sent by reference");
});

test("step over skips the call, step in enters it, step out returns", async () => {
  const over = connect();
  await stoppedAtTheCall(over);
  ok((await over.request("next", { threadId: 1 })).success);
  const overStop = await over.nextEvent();
  equal(overStop.event, "stopped");
  equal(recordOf(overStop.body).reason, "step");
  const afterNext = await stackOf(over, 1);
  equal(afterNext.length, 2, "the call did not become a frame");
  equal(afterNext[0]?.line, AFTER_CALL_LINE);

  const into = connect();
  await stoppedAtTheCall(into);
  ok((await into.request("stepIn", { threadId: 1 })).success);
  equal((await into.nextEvent()).event, "stopped");
  const inside = await stackOf(into, 1);
  equal(inside.length, 3, "stepping in pushed a frame");
  equal(inside[0]?.name, "twice");
  equal(inside[0]?.line, CALLEE_LINE);

  ok((await into.request("stepOut", { threadId: 1 })).success);
  equal((await into.nextEvent()).event, "stopped");
  const back = await stackOf(into, 1);
  equal(back.length, 2, "stepping out popped the frame");
  equal(back[0]?.name, "compute");
  equal(back[0]?.line, CALL_LINE);
});

test("variables read a local, a local of a frame that is not the innermost, and a global", async () => {
  const client = connect();
  await stoppedAtTheCall(client);
  const atCall = await stackOf(client, 1);
  // `counter` already exists as 0: the assignment's target is read (and created) before the call.
  deepEqual(await localsOf(client, atCall[0]?.id), { "locals.seed": "3", "globals.total": "1", "globals.spare": "2", "globals.counter": "0" });

  const inside = connect();
  await stoppedAtTheCall(inside);
  await inside.request("stepIn", { threadId: 1 });
  equal((await inside.nextEvent()).event, "stopped");
  const deep = await stackOf(inside, 1);
  deepEqual(await localsOf(inside, deep[0]?.id), { "locals.n": "3", "globals.total": "1", "globals.spare": "2", "globals.counter": "0", "globals.result": "0" });
  const caller = await localsOf(inside, deep[1]?.id);
  equal(caller["locals.seed"], "3", "a frame below the innermost keeps its own locals");
});

test("evaluate reads a watch expression and refuses what a watch may not do", async () => {
  const client = connect();
  await stoppedAtTheCall(client);
  const top = await stackOf(client, 1);
  const frameId = top[0]?.id;

  const watch = await client.request("evaluate", { expression: "seed + 1", frameId, context: "watch" });
  ok(watch.success);
  equal(String(recordOf(watch.body).result), "4");
  const call = await client.request("evaluate", { expression: 'len("abc")', frameId });
  equal(String(recordOf(call.body).result), "3");
  const global = await client.request("evaluate", { expression: "total * 10", frameId });
  equal(String(recordOf(global.body).result), "10");

  const assignment = await client.request("evaluate", { expression: "counter = 1", frameId });
  equal(assignment.success, false);
  ok(assignment.message?.startsWith("evaluate.assignment"), assignment.message);
  const notWhitelisted = await client.request("evaluate", { expression: "random(6)", frameId });
  equal(notWhitelisted.success, false);
  ok(notWhitelisted.message?.startsWith("evaluate.call"), notWhitelisted.message);
  const long = Array.from({ length: 600 }, () => "1").join(" + ");
  const budget = await client.request("evaluate", { expression: long, frameId });
  equal(budget.success, false);
  ok(budget.message?.startsWith("evaluate.budget"), budget.message);
});

test("a run to the end lands on the uninterrupted hash, watches and views included", async () => {
  let debugged: SceneDebugTarget | null = null;
  const client = connect((target) => { debugged = target; });
  await stoppedAtTheCall(client);
  const top = await stackOf(client, 1);
  await localsOf(client, top[0]?.id);
  await client.request("evaluate", { expression: "total * 10", frameId: top[0]?.id });

  ok((await client.request("continue", { threadId: 1 })).success);
  let outcome = await client.nextEvent();
  for (let guard = 0; guard < 20 && outcome.event === "stopped"; guard += 1) {
    ok((await client.request("continue", { threadId: 1 })).success);
    outcome = await client.nextEvent();
  }
  equal(outcome.event, "terminated", "the program runs to its end");

  const target = debugged as SceneDebugTarget | null;
  ok(target !== null, "the session launched the scene");
  const settled = target.engine.advance(0, []);
  deepEqual(settled.diagnostics, []);
  const uninterrupted = scene().engine.advance(settled.tickAfter, []);
  equal(settled.stateHash, uninterrupted.stateHash, "the debug run ends on the uninterrupted hash");
});

test("each stop also sends the custom rpgcode.stopped event a host can wait on", async () => {
  const client = connect();
  ok((await client.request("initialize", { adapterID: "rpgcode" })).success);
  ok((await client.request("launch", { program: PROGRAM_PATH })).success);
  ok((await client.request("setBreakpoints", { source: { path: PROGRAM_PATH }, breakpoints: [{ line: CALL_LINE }] })).success);
  ok((await client.request("configurationDone")).success);
  const entry = recordOf((await client.nextCustomStop()).body);
  equal(entry.reason, "entry");
  equal(entry.threadId, 1);
  ok((await client.request("continue", { threadId: 1 })).success);
  const hit = recordOf((await client.nextCustomStop()).body);
  equal(hit.reason, "breakpoint");
  equal(hit.line, CALL_LINE);
});

test("a request split across chunks still parses", async () => {
  const client = connect();
  const text = frameMessage({ seq: 1, type: "request", command: "initialize", arguments: { adapterID: "rpgcode" } });
  const bytes = new Uint8Array(Buffer.from(text, "utf8"));
  client.sendBytes(bytes.subarray(0, 9));
  client.sendBytes(bytes.subarray(9));
  const initialized = await client.request("initialize", { adapterID: "rpgcode" });
  ok(initialized.success);
  equal(recordOf(initialized.body).supportsConfigurationDoneRequest, true);
});

test("an unsupported request is a failed response, not a crash", async () => {
  const client = connect();
  const answer = await client.request("unknownRequest");
  equal(answer.success, false);
  equal(answer.message, 'unsupported request "unknownRequest"');
});
