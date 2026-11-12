// The extension-host test that runs inside VS Code for the Web (#950; TOOL-8, AD-21).
//
// `@vscode/test-web` loads this module into the web extension host of a real VS Code build,
// with `extensions/rpgcode` installed and the fixture folder open. Everything here drives the
// *real client*: `vscode.debug.startDebugging` launches the extension's inline adapter,
// `vscode.debug.addBreakpoints` is the breakpoint the client sends, and
// `session.customRequest` is the channel an editor uses for a debug request.
//
// The module is bundled for the browser by `tools/vscode-web/build.mjs`, into the served
// extension folder and as CommonJS (the web worker host refuses ES modules); it may import
// `vscode` and nothing else.

import * as vscode from "vscode";

const EXTENSION_ID = "tk-reawakened.rpgcode-language";

type Body = Record<string, unknown>;

console.log("[rpgcode web] test module loaded");

function fail(message: string): never {
  throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function recordOf(value: unknown): Body {
  return typeof value === "object" && value !== null ? value as Body : {};
}

function log(message: string): void {
  console.log(`[rpgcode web] ${message}`);
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms waiting for ${what}`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function stackFrames(session: vscode.DebugSession, threadId: number): Promise<Body[]> {
  const body = recordOf(await session.customRequest("stackTrace", { threadId }));
  return Array.isArray(body.stackFrames) ? body.stackFrames as Body[] : [];
}

export async function run(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) fail("the test workspace has no folder");
  log(`workspace ${folder.uri.toString()}`);

  const program = vscode.Uri.joinPath(folder.uri, "Prg", "probe.prg");
  const board = vscode.Uri.joinPath(folder.uri, "Boards", "probe.brd");
  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(program));
  const callLine = text.split("\n").findIndex((line) => !line.trimStart().startsWith("//") && line.includes("result = twice(seed)")) + 1;
  equal(callLine > 0, true, "the fixture has the call line");

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  if (extension === undefined) fail(`the extension ${EXTENSION_ID} is installed (installed: ${vscode.extensions.all.map((entry) => entry.id).join(", ")})`);
  log(`manifest main=${String(extension.packageJSON.main)} browser=${String(extension.packageJSON.browser)}`);

  const started = new Promise<vscode.DebugSession>((resolve) => {
    const listener = vscode.debug.onDidStartDebugSession((session) => {
      if (session.type === "rpgcode") {
        listener.dispose();
        resolve(session);
      }
    });
  });
  const terminated = new Promise<void>((resolve) => {
    const listener = vscode.debug.onDidTerminateDebugSession((session) => {
      if (session.type === "rpgcode") {
        listener.dispose();
        resolve();
      }
    });
  });

  vscode.debug.addBreakpoints([
    new vscode.SourceBreakpoint(new vscode.Location(program, new vscode.Position(callLine - 1, 0))),
  ]);
  log(`breakpoint at ${program.path}:${callLine}`);

  const launched = await withTimeout(
    vscode.debug.startDebugging(folder, {
      type: "rpgcode",
      request: "launch",
      name: "RPGCode web probe",
      program: program.toString(),
      board: board.toString(),
      seed: 7,
    }),
    30_000,
    "the debug session to start",
  );
  equal(launched, true, "startDebugging returned true");
  const session = await withTimeout(started, 30_000, "the rpgcode session");
  log("session started");

  // The adapter pauses at entry; a continue reaches the breakpoint the client installed.
  await withTimeout(session.customRequest("continue", { threadId: 1 }), 30_000, "the continue response");
  // Only now has the program run `spare = thread(...)`, so both threads exist.
  const threads = recordOf(await session.customRequest("threads"));
  equal(JSON.stringify((threads.threads as Body[]).map((thread) => thread.id)), JSON.stringify([1, 2]), "two threads, the blocking one and the started one");
  const stopped = await stackFrames(session, 1);
  equal(stopped[0]?.name, "compute", "the breakpoint stop is inside compute()");
  equal(stopped[0]?.line, callLine, "the breakpoint stop is on the call line");
  equal(stopped.length, 2, "the top-level frame and compute()");
  equal((await stackFrames(session, 2)).length, 1, "the started thread has a frame");

  await withTimeout(session.customRequest("next", { threadId: 1 }), 30_000, "the next response");
  const over = await stackFrames(session, 1);
  equal(over.length, 2, "stepping over does not push a frame");
  equal(over[0]?.line, callLine + 1, "stepping over lands on the following statement");

  const scopes = recordOf(await session.customRequest("scopes", { frameId: over[1]?.id }));
  const callerLocals = recordOf(await session.customRequest("variables", { variablesReference: (scopes.scopes as Body[])[0]?.variablesReference }));
  const seed = (callerLocals.variables as Body[]).find((variable) => variable.name === "seed");
  equal(seed?.value, "3", "compute()'s local reads through the client");
  const watch = recordOf(await session.customRequest("evaluate", { expression: "seed + 1", frameId: over[1]?.id }));
  equal(watch.result, "4", "a watch expression evaluates in the caller's frame");

  await withTimeout(session.customRequest("stepOut", { threadId: 1 }), 30_000, "the stepOut response");
  equal((await stackFrames(session, 1)).length <= 2, true, "stepping out does not deepen the stack");

  await withTimeout(session.customRequest("continue", { threadId: 1 }), 30_000, "the final continue");
  await withTimeout(terminated, 60_000, "the session to terminate");
  vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  log("the debugger scenario passed in VS Code for the Web");
}
