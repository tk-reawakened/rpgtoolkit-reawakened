// The extension-host test that runs inside VS Code for the Web (#950; TOOL-8, AD-21).
//
// `@vscode/test-web` loads this module into the web extension host of a real VS Code build,
// with `extensions/rpgcode` installed and the fixture folder open. Everything here drives the
// *real client*: `vscode.debug.startDebugging` launches the extension's inline adapter,
// `vscode.debug.addBreakpoints` is the breakpoint the client sends, and
// `session.customRequest` is the channel an editor uses for a debug request.
//
// Sequencing is event-driven, never timed: the adapter sends the custom DAP event
// `rpgcode.stopped` beside every standard `stopped`, and VS Code forwards custom events to
// extensions, so `awaitStop()` is the deterministic signal that the run has reached a stop.
// The client consumes the standard event, which is why it cannot be waited on from here.
// Every wait has a failure bound (`withTimeout`) so a missing event fails the lane instead of
// hanging it; no wait is a sleep.
//
// The module is bundled for the browser by `tools/vscode-web/build.mjs`, into the served
// extension folder and as CommonJS (the web worker host refuses ES modules).

import * as vscode from "vscode";
import { newProjectMainFile, writeMainFile } from "@tk-reawakened/core";

const EXTENSION_ID = "tk-reawakened.rpgcode-language";
const STOP_EVENT = "rpgcode.stopped";

type Body = Record<string, unknown>;
type Stop = { readonly reason: string; readonly threadId: number; readonly line: number };

console.log("[rpgcode web] test module loaded");

const FAILURE_BOUND_MS = 30_000;

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

/** A failure bound around a wait for an event, never a sleep: it rejects when the event never comes. */
function withTimeout<T>(promise: Promise<T>, what: string, ms = FAILURE_BOUND_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${what} within ${ms} ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Every `rpgcode.stopped` the adapter sends, in order, as an awaitable queue. */
function stopQueue(): { next(): Promise<Stop>; dispose(): void } {
  const pending: Stop[] = [];
  const waiters: { resolve: (stop: Stop) => void }[] = [];
  const listener = vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
    if (event.event !== STOP_EVENT) return;
    const body = recordOf(event.body);
    const stop: Stop = {
      reason: String(body.reason ?? ""),
      threadId: Number(body.threadId ?? 0),
      line: Number(body.line ?? 0),
    };
    const waiter = waiters.shift();
    if (waiter === undefined) pending.push(stop);
    else waiter.resolve(stop);
  });
  return {
    next: () => {
      const ready = pending.shift();
      if (ready !== undefined) return Promise.resolve(ready);
      const resume = Promise.withResolvers<Stop>();
      waiters.push({ resolve: resume.resolve });
      return resume.promise;
    },
    dispose: () => listener.dispose(),
  };
}

async function stackFrames(session: vscode.DebugSession, threadId: number): Promise<Body[]> {
  const body = recordOf(await session.customRequest("stackTrace", { threadId }));
  return Array.isArray(body.stackFrames) ? body.stackFrames as Body[] : [];
}

async function variablesOf(session: vscode.DebugSession, frameId: unknown, scope: number): Promise<Record<string, string>> {
  const scopes = recordOf(await session.customRequest("scopes", { frameId: Number(frameId) }));
  const list = Array.isArray(scopes.scopes) ? scopes.scopes as Body[] : [];
  const body = recordOf(await session.customRequest("variables", { variablesReference: list[scope]?.variablesReference }));
  const entries = Array.isArray(body.variables) ? body.variables as Body[] : [];
  const values: Record<string, string> = {};
  for (const entry of entries) values[String(entry.name)] = String(entry.value);
  return values;
}

/** Resolve when `uri`'s diagnostics satisfy `ready`, failing within the bound otherwise. */
async function diagnosticsOf(uri: vscode.Uri, ready: (diagnostics: readonly vscode.Diagnostic[]) => boolean, what: string): Promise<readonly vscode.Diagnostic[]> {
  const done = Promise.withResolvers<readonly vscode.Diagnostic[]>();
  const check = (): void => {
    const current = vscode.languages.getDiagnostics(uri);
    if (ready(current)) done.resolve(current);
  };
  const listener = vscode.languages.onDidChangeDiagnostics((event) => {
    if (event.uris.some((item) => item.toString() === uri.toString())) check();
  });
  check();
  try {
    return await withTimeout(done.promise, what);
  } finally {
    listener.dispose();
  }
}

function codeOf(diagnostic: vscode.Diagnostic): string {
  const code = diagnostic.code;
  return typeof code === "object" && code !== null ? String(code.value) : String(code);
}

/** A Toolkit 2.2 main file in the line-oriented text form (docs/spec/formats/legacy/text-formats.md). */
function tk2MainFile(): Uint8Array {
  const lines = ["RPGTLKIT MAIN", "2", "2", "0", "start.prg", "", "1", "0", "0", "0", "start.brd", "hero.tem", "0", "0", "0"];
  for (let k = 0; k < 501; k += 1) lines.push("", "0");
  lines.push("0", "0", "0", "", "", "Web", "2", "", "", "", "", "", "");
  for (let k = 0; k < 51; k += 1) lines.push("0", "");
  lines.push("");
  return new TextEncoder().encode(lines.join("\r\n") + "\r\n");
}

/**
 * The running project through the real web client and worker server
 * (docs/spec/engine/rpgcode-tooling.md#tool-1-project): an unselected project leaves a
 * program unassessed, and selecting a Toolkit 2 `.gam` makes its dialogue parse.
 */
async function runningProjectScenario(folder: vscode.WorkspaceFolder): Promise<void> {
  const write = (path: string, bytes: Uint8Array): Thenable<void> => vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder.uri, ...path.split("/")), bytes);
  const modern = writeMainFile({
    ...newProjectMainFile(), startupPrg: "uses.prg", initBoard: "", menuPlugin: "", fightPlugin: "", packagePlugins: [],
  });
  if (!modern.ok) fail(modern.error.message);
  await write("legacy/Main/legacy.gam", tk2MainFile());
  await write("legacy/Prg/talk.prg", new TextEncoder().encode("Hello there\n"));
  await write("modern/Main/modern.gam", modern.value);
  await write("modern/Prg/talk.prg", new TextEncoder().encode("Hello there\n"));
  await write("modern/Prg/lint.prg", new TextEncoder().encode('nope()\nmwin("hi")\n'));
  await write("modern/tkr-lint.json", new TextEncoder().encode(JSON.stringify({ severity: { "lint/unknown-command": "warning" } })));
  await write("modern/Prg/fmt.prg", new TextEncoder().encode("if (x) {\nMWIN(hello)\n}\n"));
  await write("modern/Prg/uses.prg", new TextEncoder().encode('#include "tools/my lib.prg"\ny = helper(1)\n'));
  await write("modern/Prg/Tools/My Lib.PRG", new TextEncoder().encode("// helpers\nfunction helper(a) { return a }\nfunction spare() { return 1 }\n"));
  const settings = vscode.workspace.getConfiguration("rpgcode");
  await settings.update("project", undefined, vscode.ConfigurationTarget.Workspace);

  const talk = vscode.Uri.joinPath(folder.uri, "legacy", "Prg", "talk.prg");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(talk));
  const unassessed = await diagnosticsOf(talk, (items) => items.some((item) => codeOf(item) === "project.unassessed"), "the unassessed marker");
  equal(unassessed.some((item) => codeOf(item) === "syntax.error"), true, "without a project the .prg is read provisionally as 3.1");

  await settings.update("project", "legacy/Main/legacy.gam", vscode.ConfigurationTarget.Workspace);
  const onlyLintAssessment = (items: readonly vscode.Diagnostic[]): boolean =>
    items.length === 1 && codeOf(items[0]!) === "lint.unassessed";
  await diagnosticsOf(talk, onlyLintAssessment, "the Toolkit 2 dialogue to parse and show the lint assessment");

  await settings.update("project", "modern/Main/modern.gam", vscode.ConfigurationTarget.Workspace);
  const modernTalk = vscode.Uri.joinPath(folder.uri, "modern", "Prg", "talk.prg");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(modernTalk));
  await diagnosticsOf(modernTalk, (items) => items.length === 1 && codeOf(items[0]!) === "syntax.error", "the 3.1 project's genuine error");
  await diagnosticsOf(talk, (items) => items.some((item) => codeOf(item) === "project.unassessed"), "the old project's file to be unassessed");

  // #2081: go to definition across an include lands on the file's own URI, spelled as it is.
  const uses = vscode.Uri.joinPath(folder.uri, "modern", "Prg", "uses.prg");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uses));
  await diagnosticsOf(uses, onlyLintAssessment, "the include program to have no lint findings");
  const targets = await withTimeout(
    vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>("vscode.executeDefinitionProvider", uses, new vscode.Position(1, 5)),
    "web language-server definition",
  );
  const target = targets[0];
  const targetUri = target === undefined ? undefined : "targetUri" in target ? target.targetUri : target.uri;
  equal(targetUri?.toString(), vscode.Uri.joinPath(folder.uri, "modern", "Prg", "Tools", "My Lib.PRG").toString(), "definition opens the included file");
  const targetText = new TextDecoder().decode(await vscode.workspace.fs.readFile(targetUri!));
  equal(targetText.includes("function helper"), true, "the definition URI is readable through the workspace");

  // #2105: the syntax error in another program initially prevents closure.
  // Fix that open buffer and verify that the selected .gam makes the unused rule run.
  const library = await vscode.workspace.openTextDocument(targetUri!);
  await vscode.window.showTextDocument(library);
  await diagnosticsOf(library.uri, onlyLintAssessment, "the unused-function rule to remain unassessed while the project is invalid");
  const talkDocument = await vscode.workspace.openTextDocument(modernTalk);
  const fixTalk = new vscode.WorkspaceEdit();
  fixTalk.replace(modernTalk, new vscode.Range(0, 0, talkDocument.lineCount, 0), 'mwin("Hello there")\n');
  equal(await vscode.workspace.applyEdit(fixTalk), true, "fix the other open project buffer");
  const unused = await diagnosticsOf(library.uri, (items) => items.some((item) => codeOf(item) === "lint/unused-function"), "the project-wide unused function");
  equal(JSON.stringify(unused.map((item) => [codeOf(item), item.range.start.line])), JSON.stringify([["lint/unused-function", 2]]), "only spare is unused in the selected project");

  // #2074: the project's lint findings, at the severity its tkr-lint.json sets.
  const linted = vscode.Uri.joinPath(folder.uri, "modern", "Prg", "lint.prg");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(linted));
  const findings = await diagnosticsOf(linted, (items) => items.length > 0, "the project lint findings");
  equal(JSON.stringify(findings.map((item) => [codeOf(item), item.severity, item.range.start.line])), JSON.stringify([["lint/unknown-command", vscode.DiagnosticSeverity.Warning, 0]]), "nope() is reported at the configured severity and mwin is not");

  // #2091: a 3.1 project's file is formatted by TOOL-4; a Toolkit 2 project's file is refused unchanged.
  const formatOptions = { tabSize: 4, insertSpaces: true };
  const fmt = vscode.Uri.joinPath(folder.uri, "modern", "Prg", "fmt.prg");
  const fmtDocument = await vscode.workspace.openTextDocument(fmt);
  await vscode.window.showTextDocument(fmtDocument);
  await diagnosticsOf(fmt, (items) => items.some((item) => codeOf(item) === "style/format"), "the style finding on the format program");
  const formatEdits = await withTimeout(
    vscode.commands.executeCommand<vscode.TextEdit[]>("vscode.executeFormatDocumentProvider", fmt, formatOptions),
    "web language-server formatting",
  );
  const formatEdit = new vscode.WorkspaceEdit();
  formatEdit.set(fmt, formatEdits ?? []);
  equal(await vscode.workspace.applyEdit(formatEdit), true, "the formatting edit applies");
  equal(fmtDocument.getText(), "if (x) {\n    mwin(hello)\n}\n", "the 3.1 file is formatted");
  await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");

  await settings.update("project", "legacy/Main/legacy.gam", vscode.ConfigurationTarget.Workspace);
  await diagnosticsOf(talk, onlyLintAssessment, "the Toolkit 2 project to be selected again");
  const refused = await withTimeout(
    vscode.commands.executeCommand<vscode.TextEdit[] | undefined>("vscode.executeFormatDocumentProvider", talk, formatOptions),
    "web language-server formatting refusal",
  );
  equal((refused ?? []).length, 0, "a Toolkit 2 project's file is not rewritten");

  await settings.update("project", undefined, vscode.ConfigurationTarget.Workspace);
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  log("the running-project scenario passed in VS Code for the Web");
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
  const calleeLine = text.split("\n").findIndex((line) => !line.trimStart().startsWith("//") && line.includes("local(doubled)")) + 1;

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  if (extension === undefined) fail(`the extension ${EXTENSION_ID} is installed (installed: ${vscode.extensions.all.map((entry) => entry.id).join(", ")})`);
  log(`manifest main=${String(extension.packageJSON.main)} browser=${String(extension.packageJSON.browser)}`);

  // A dialect preview is a new unsaved document, never an in-place project edit.
  await extension.activate();
  await runningProjectScenario(folder);
  const previewText = 'Mwin("Hello there")\n';
  await vscode.commands.executeCommand("rpgcode.previewTk2Conversion", previewText);
  const preview = vscode.window.activeTextEditor?.document;
  if (preview === undefined) fail("the conversion preview opened an editor");
  equal(preview.isUntitled, true, "conversion preview is unsaved");
  equal(preview.languageId, "rpgcode", "preview uses the 3.1 language mode");
  equal(preview.getText(), previewText, "preview contains the converted text");
  equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(program)), text, "preview leaves the original file untouched");
  // Debug's save-before-start must not wait on the deliberately unsaved preview.
  await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");

  // Exercise the real web client and language-server worker, not a transport mock.
  const callText = "threadSleep(1, ";
  const callDocument = await vscode.workspace.openTextDocument({ language: "rpgcode", content: callText });
  const diagnosticsReady = Promise.withResolvers<void>();
  const diagnosticsListener = vscode.languages.onDidChangeDiagnostics((event) => {
    if (event.uris.some((uri) => uri.toString() === callDocument.uri.toString()) &&
        vscode.languages.getDiagnostics(callDocument.uri).length > 0) {
      diagnosticsListener.dispose();
      diagnosticsReady.resolve();
    }
  });
  if (vscode.languages.getDiagnostics(callDocument.uri).length > 0) {
    diagnosticsListener.dispose();
    diagnosticsReady.resolve();
  }
  await vscode.window.showTextDocument(callDocument);
  await withTimeout(diagnosticsReady.promise, "signature-help document diagnostics");
  const tip = await withTimeout(
    vscode.commands.executeCommand<vscode.SignatureHelp>("vscode.executeSignatureHelpProvider", callDocument.uri, new vscode.Position(0, callText.length)),
    "web language-server signature help",
  );
  if (tip === undefined) fail("the web language server returns signature help");
  equal(tip.activeParameter, 1, "signature help selects the second argument");
  equal(tip.signatures[0]?.label.startsWith("threadsleep("), true, "signature help uses the registered command");
  await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");

  const stops = stopQueue();
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

  try {
    equal(await withTimeout(
      vscode.debug.startDebugging(folder, {
        type: "rpgcode",
        request: "launch",
        name: "RPGCode web probe",
        program: program.toString(),
        board: board.toString(),
        seed: 7,
      }),
      "startDebugging",
    ), true, "startDebugging returned true");
    const session = await withTimeout(started, "the rpgcode session");

    const entry = await withTimeout(stops.next(), "the entry stop");
    equal(entry.reason, "entry", "the session stops at entry once the client is configured");
    log(`entry stop on thread ${entry.threadId}`);

    // Continue to the breakpoint the *client* installed.
    await session.customRequest("continue", { threadId: 1 });
    const hit = await withTimeout(stops.next(), "the breakpoint stop");
    equal(hit.reason, "breakpoint", "the breakpoint the client set is hit");
    equal(hit.threadId, 1, "the blocking thread stopped");
    equal(hit.line, callLine, "the stop is on the call line");

    const threads = recordOf(await session.customRequest("threads"));
    equal(JSON.stringify((threads.threads as Body[]).map((thread) => thread.id)), JSON.stringify([1, 2]), "two threads with their frames");
    const stopped = await stackFrames(session, 1);
    equal(stopped[0]?.name, "compute", "the stop is inside compute()");
    equal(stopped[0]?.line, callLine, "the top frame reports the call line");
    equal(stopped.length, 2, "the top-level frame and compute()");
    equal((await stackFrames(session, 2)).length, 1, "the started thread has a frame of its own");

    // A local of the innermost frame and the globals.
    deepEqualish(await variablesOf(session, stopped[0]?.id, 0), { seed: "3" }, "compute()'s local");
    const globals = await variablesOf(session, stopped[0]?.id, 1);
    equal(globals.total, "1", "the global table");
    equal(globals.spare, "2", "the started thread's id is a global");

    // Step into the call: a third frame, on the callee's first line.
    await session.customRequest("stepIn", { threadId: 1 });
    const steppedIn = await withTimeout(stops.next(), "the stepIn stop");
    equal(steppedIn.reason, "step", "stepping reports a step stop");
    const inside = await stackFrames(session, 1);
    equal(inside.length, 3, "stepping in pushed a frame");
    equal(inside[0]?.name, "twice", "the new frame is the callee");
    equal(inside[0]?.line, calleeLine, "the callee's first line");
    // A local of the frame below the innermost, which is the frame we came from.
    deepEqualish(await variablesOf(session, inside[1]?.id, 0), { seed: "3" }, "compute()'s local, read from below the innermost frame");
    const watch = recordOf(await session.customRequest("evaluate", { expression: "seed + 1", frameId: inside[1]?.id }));
    equal(watch.result, "4", "a watch expression evaluates in the caller's frame");

    // Step out: back to the caller, the frame popped.
    await session.customRequest("stepOut", { threadId: 1 });
    const steppedOut = await withTimeout(stops.next(), "the stepOut stop");
    equal(steppedOut.reason, "step");
    const back = await stackFrames(session, 1);
    equal(back.length, 2, "stepping out popped the frame");
    equal(back[0]?.name, "compute");

    // Step over the call: the frame count is unchanged and the line moves on.
    await session.customRequest("next", { threadId: 1 });
    const steppedOver = await withTimeout(stops.next(), "the next stop");
    equal(steppedOver.reason, "step");
    const over = await stackFrames(session, 1);
    equal(over.length, 2, "stepping over does not push a frame");
    equal(over[0]?.line, callLine + 1, "stepping over lands on the following statement");

    // A watch that must be refused, with the adapter's own code in the message.
    let refusal: string | undefined;
    try {
      await session.customRequest("evaluate", { expression: "counter = 1", frameId: over[0]?.id });
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    if (refusal === undefined || !refusal.includes("evaluate.assignment")) fail(`an assignment is refused with evaluate.assignment, got ${String(refusal)}`);

    // Run to the end.
    await session.customRequest("continue", { threadId: 1 });
    await withTimeout(terminated, "the session to terminate", 60_000);
    log("the debugger scenario passed in VS Code for the Web");
  } finally {
    stops.dispose();
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  }
}

function deepEqualish(actual: Record<string, string>, expected: Record<string, string>, message: string): void {
  for (const [key, value] of Object.entries(expected)) equal(actual[key], value, `${message} (${key})`);
}
