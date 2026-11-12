// The control test for the VS Code web host (#950).
//
// It runs inside the same `@vscode/test-web` extension host as the RPGCode scenario and does
// only what that scenario could not: bring up a two-file probe extension whose `activate`
// logs, registers a debug adapter factory for the `probe` type, and then start that session.
// If `startDebugging` answers "Couldn't find a debug adapter descriptor", the probe's
// `activate` did not run either — the host, not the RPGCode extension, is where to look.

import * as vscode from "vscode";

const PROBE_ID = "tk-reawakened.probe-extension";

console.log("[probe test] module loaded");

function log(message: string): void {
  console.log(`[probe test] ${message}`);
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

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension(PROBE_ID);
  if (extension === undefined) {
    throw new Error(`the probe extension ${PROBE_ID} is not installed (installed: ${vscode.extensions.all.map((entry) => entry.id).join(", ")})`);
  }
  log(`manifest browser=${String(extension.packageJSON.browser)} main=${String(extension.packageJSON.main)}`);
  await extension.activate();
  log(`after activate(): isActive=${extension.isActive}`);

  const started = new Promise<vscode.DebugSession>((resolve) => {
    const listener = vscode.debug.onDidStartDebugSession((session) => {
      if (session.type === "probe") {
        listener.dispose();
        resolve(session);
      }
    });
  });
  const terminated = new Promise<void>((resolve) => {
    const listener = vscode.debug.onDidTerminateDebugSession((session) => {
      if (session.type === "probe") {
        listener.dispose();
        resolve();
      }
    });
  });

  const folder = vscode.workspace.workspaceFolders?.[0];
  const launched = await withTimeout(
    vscode.debug.startDebugging(folder, { type: "probe", request: "launch", name: "probe" }),
    20_000,
    "the probe session to start",
  );
  if (!launched) throw new Error("startDebugging(probe) returned false");
  const session = await withTimeout(started, 20_000, "the probe session");
  log(`probe session started: ${session.id}`);
  await withTimeout(session.customRequest("disconnect"), 20_000, "the probe disconnect response");
  await withTimeout(terminated, 20_000, "the probe session to terminate");
  log("probe extension activated, registered its adapter and ran a session");
}
