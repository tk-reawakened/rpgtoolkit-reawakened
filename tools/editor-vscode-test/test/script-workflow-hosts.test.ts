// Story 13.16, both hosts against the real language server: the reviewed workflow in the browser workbench (its own
// dialog over the shared view) and in VS Code (its multi-select list and status reports), with one in-process
// `lsp` server answering the one `rpgcode/scriptTransform` request. A case is the same in both hosts: the same plan, the
// same per-file opt-out, the same bytes written, and a cancel that changes nothing.
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { asProgramDocument, createWizardHistory, scriptProviderOver, type ScriptTransformId } from "@tk-reawakened/editor-model";
import { createServer, PROJECT_NOTIFICATION, SCRIPT_TRANSFORM_REQUEST, type ServerConnection } from "@tk-reawakened/lsp";
import { encodeBase64, projectRootUri, type ProjectSnapshot, type ProjectSnapshotFile } from "@tk-reawakened/lsp/protocol";
import { projectFileUri } from "@tk-reawakened/host-web";
import type { DialogQuestion, DialogService, LanguageConnection, LanguageService, PlatformResult } from "@tk-reawakened/platform-services";
import { settle as settleWork, type Act } from "../conformance/view.ts";
import { MemoryDirectory, type WriteControl } from "../conformance/memory-directory.ts";

let act: Act;
let createFolderProject: typeof import("@tk-reawakened/host-web/testing").createFolderProject;
let createWorkbench: typeof import("@tk-reawakened/host-web/testing").createWorkbench;
let leaseLanguageClient: typeof import("@tk-reawakened/editor-ui").leaseLanguageClient;
let runScriptWorkflow: typeof import("@tk-reawakened/host-vscode/testing").runScriptWorkflow;

before(async () => {
  GlobalRegistrator.register();
  const { act: preactAct } = await import("preact/test-utils");
  let queue: Promise<void> = Promise.resolve();
  act = (callback) => {
    const run = queue.then(() => preactAct(callback));
    queue = run.catch(() => undefined);
    return run;
  };
  ({ createFolderProject, createWorkbench } = await import("@tk-reawakened/host-web/testing"));
  ({ leaseLanguageClient } = await import("@tk-reawakened/editor-ui"));
  ({ runScriptWorkflow } = await import("@tk-reawakened/host-vscode/testing"));
});

after(() => GlobalRegistrator.unregister());

const gam = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const bytes = (text: string): Uint8Array => Uint8Array.from(text, (ch) => ch.charCodeAt(0));
const text = (value: Uint8Array | null | undefined): string | null => (value === undefined || value === null ? null : String.fromCharCode(...value));

const MESSY = 'x! = 1\nIF (x == 1) {\nMWIN("Hello")\n}\n';
const OTHER = 'MWIN("second")\n';
const CLEAN = 'mwin("clean")\n';

/** One in-process language server behind a JSON-RPC connection, with the project snapshot of a folder. */
function inProcessServer(root: MemoryDirectory, main: string): LanguageService {
  const handlers = new Map<string, (params: never) => unknown>();
  const notifications = new Map<string, (params: unknown) => void>();
  const absent = { dispose: () => {} };
  const connection: ServerConnection = {
    onInitialize: (handler) => {
      handlers.set("initialize", handler as never);
      return absent;
    },
    onDidOpenTextDocument: () => absent,
    onDidChangeTextDocument: () => absent,
    onHover: () => absent,
    onCompletion: () => absent,
    onDefinition: () => absent,
    onDocumentSymbol: () => absent,
    onSignatureHelp: () => absent,
    onDocumentFormatting: () => absent,
    onCodeAction: () => absent,
    showMessage: () => {},
    onRequest: (method, handler) => {
      handlers.set(method, handler);
      return absent;
    },
    onNotification: (method, handler) => {
      notifications.set(method, handler);
      return absent;
    },
    sendDiagnostics: () => {},
  };
  createServer(connection);
  const snapshot = (revision: number): ProjectSnapshot => {
    const files: ProjectSnapshotFile[] = [];
    const walk = (folder: MemoryDirectory, prefix: string): void => {
      for (const [name, entry] of folder.children) {
        const path = prefix === "" ? name : `${prefix}/${name}`;
        if (entry instanceof MemoryDirectory) walk(entry, path);
        else if (/\.(prg|rnc)$/i.test(name)) files.push({ path, uri: projectFileUri(path), bytes: encodeBase64(entry.bytes) });
      }
    };
    walk(root, "");
    return { revision, main: { uri: projectFileUri(main), bytes: encodeBase64(root.read(main) ?? new Uint8Array()) }, rootUri: projectRootUri(projectFileUri(main)), files, hookInventoryComplete: true, lintConfig: null };
  };
  let revision = 0;
  return {
    async connect(): Promise<PlatformResult<LanguageConnection>> {
      const listeners = new Set<(message: unknown) => void>();
      const deliver = (message: unknown): void => { for (const listener of [...listeners]) listener(message); };
      const answer = (message: { readonly id: number; readonly method: string; readonly params: unknown }): void => {
        const handler = handlers.get(message.method);
        if (handler === undefined) {
          deliver({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
          return;
        }
        try {
          deliver({ jsonrpc: "2.0", id: message.id, result: handler(message.params as never) });
        } catch (error) {
          deliver({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
        }
      };
      return {
        ok: true,
        value: {
          send(message) {
            const { id, method, params } = message as { id?: number; method?: string; params?: unknown };
            if (typeof method === "string" && typeof id === "number") {
              queueMicrotask(() => {
                const bound = params as { readonly project?: { readonly main: string } } | undefined;
                const request = method === SCRIPT_TRANSFORM_REQUEST && bound?.project !== undefined
                  ? { ...bound, project: { ...bound.project, revision } } : params;
                answer({ id, method, params: request });
              });
            } else if (typeof method === "string") {
              queueMicrotask(() => {
                notifications.get(method)?.(params);
                // The server takes the running project once the client has finished the handshake (TOOL-1).
                if (method === "initialized") notifications.get(PROJECT_NOTIFICATION)?.(snapshot(++revision));
              });
            }
          },
          onMessage(listener) {
            listeners.add(listener as (message: unknown) => void);
            return () => void listeners.delete(listener as (message: unknown) => void);
          },
          onClose() {
            return () => {};
          },
          uriOf: (path) => projectFileUri(path),
          dispose() {},
        } as LanguageConnection,
      };
    },
  };
}

/** A user who answers every question: the checkpoint's "Replace these files?" with Replace, anything else with its first choice. */
const dialogs: DialogService = {
  async ask<Id extends string>(question: DialogQuestion<Id>): Promise<Id> {
    return (question.choices.some((choice) => choice.id === "replace") ? "replace" : question.choices[0]?.id ?? question.cancel) as Id;
  },
  async pickSavePath() { return null; },
};

function project() {
  const control: WriteControl = { refuse: false, refuseNames: undefined, hold: null, tick: 0 };
  const root = new MemoryDirectory("project", control);
  root.put("Main/example.gam", gam);
  root.put("Prg/messy.prg", bytes(MESSY));
  root.put("Prg/second.prg", bytes(OTHER));
  root.put("Prg/clean.prg", bytes(CLEAN));
  const language = inProcessServer(root, "Main/example.gam");
  const web = createFolderProject(root as unknown as FileSystemDirectoryHandle, { id: "web:script-workflow", name: "Scripts" }, { language, dialogs });
  document.body.replaceChildren();
  const element = document.createElement("div");
  document.body.append(element);
  return { root, web, element };
}

/** Microtasks and macrotasks, the way the other host tests wait: promise chains, host I/O and view renders all run. */
const settle = async (rounds = 8): Promise<void> => await settleWork(act, rounds);

/** The browser workbench's dialog: choose the project scope, check, untick what is named, apply. */
async function reviewInBrowser(transform: ScriptTransformId, options: { readonly untick?: readonly string[]; readonly cancel?: boolean } = {}) {
  const { root, web, element } = project();
  let bench!: ReturnType<typeof createWorkbench>;
  await act(() => { bench = createWorkbench(web, element, { main: "Main/example.gam" }); });
  await settle();
  const running = bench.reviewScripts(transform);
  await settle();
  const scopeRadios = [...document.querySelectorAll<HTMLInputElement>(".tkr-script-workflow input[type=radio]")];
  await act(() => { scopeRadios[1]!.click(); });
  await act(() => { [...document.querySelectorAll<HTMLButtonElement>(".tkr-script-workflow button")].find((button) => button.textContent === "Check programs")!.click(); });
  await settle();
  if (options.cancel === true) {
    await act(() => { [...document.querySelectorAll<HTMLButtonElement>(".tkr-script-workflow button")].find((button) => button.textContent === "Cancel")!.click(); });
    await running;
    return { root, element, running, bench, dialogText: null as string | null };
  }
  for (const path of options.untick ?? []) {
    await act(() => { document.querySelector<HTMLInputElement>(`.tkr-script-workflow input[aria-label="Apply to ${path}"]`)!.click(); });
  }
  const detail = document.querySelector(".tkr-script-detail")?.textContent ?? "";
  await act(() => { [...document.querySelectorAll<HTMLButtonElement>(".tkr-script-workflow button")].find((button) => button.textContent?.startsWith("Apply"))!.click(); });
  // The apply writes files and records a checkpoint: wait for its outcome, not a guessed number of turns.
  for (let round = 0; round < 40 && document.querySelector(".tkr-script-outcome") === null; round += 1) await settle(1);
  // The review stays open after an apply so its outcome can be read; its last button (Close, or Cancel after a failure) ends it.
  const outcome = document.querySelector(".tkr-script-outcome")?.textContent ?? "";
  const failures = document.querySelector(".tkr-script-failures")?.textContent ?? "";
  const footer = [...document.querySelectorAll<HTMLButtonElement>(".tkr-script-workflow .tkr-script-footer button")];
  await act(() => { footer.at(-1)!.click(); });
  await settle();
  await running;
  return { root, element, running, bench, dialogText: `${detail}\n${outcome}\n${failures}` };
}

/** VS Code's questions, answered by the test: the project scope, then the programs to apply. */
function vscodeUi(options: { readonly untick?: readonly string[]; readonly cancel?: boolean; readonly details?: string[]; readonly retry?: () => boolean }) {
  const seen = { scopes: [] as (string | null)[], items: [] as readonly { path: string; description: string; detail: string; original: string | null; result: string | null }[], reports: [] as string[], leftAsWritten: [] as readonly string[] };
  const ui = {
    async scope(_transform: ScriptTransformId, activeProgram: string | null) {
      seen.scopes.push(activeProgram);
      return "project" as const;
    },
    progress: () => () => {},
    async review(_transform: ScriptTransformId, items: typeof seen.items, leftAsWritten: readonly string[]) {
      seen.items = items;
      seen.leftAsWritten = leftAsWritten;
      for (const item of items) options.details?.push(item.detail);
      if (options.cancel === true) return undefined;
      return items.map((item) => item.path).filter((path) => !(options.untick ?? []).includes(path));
    },
    async report(summary: string, problems: readonly string[]) {
      seen.reports.push([summary, ...problems].join("\n"));
    },
    async tellUnavailable(message: string) {
      seen.reports.push(message);
    },
    async retry() {
      return options.retry?.() ?? false;
    },
  };
  return { ui, seen };
}

test("both host presenters apply the same reviewed bytes through their ordinary project filesystem", async () => {
  const browser = await reviewInBrowser("format", { untick: ["Prg/second.prg"] });
  // Format is TOOL-4 only: it re-indents and lower-cases names, and leaves the ignored `!` for the update workflow.
  equal(text(browser.root.read("Prg/messy.prg")), 'x! = 1\nif (x == 1) {\n    mwin("Hello")\n}\n');
  equal(text(browser.root.read("Prg/second.prg")), OTHER, "the unticked program is untouched");
  equal(text(browser.root.read("Prg/clean.prg")), CLEAN, "a program with nothing to change is not written");
  match(browser.dialogText ?? "", /MWIN\("Hello"\)/);

  const { root, web } = project();
  const { ui, seen } = vscodeUi({ untick: ["Prg/second.prg"] });
  const language = inProcessServer(root, "Main/example.gam");
  const leased = await leaseLanguageClient(language, { main: "Main/example.gam" });
  ok(leased.ok);
  const client = leased.lease.client;
  try {
    const summary = await runScriptWorkflow("format", {
      fs: web.services.fs,
      provider: scriptProviderOver((params) => client.request(SCRIPT_TRANSFORM_REQUEST, params), (path) => client.uriOf(path)),
      history: createWizardHistory(web.workspace.checkpoints),
      openPrograms: () => [],
      root: "",
      activeProgram: null,
    }, ui as never);
    equal(summary.kind, "applied");
  } finally {
    leased.lease.release();
  }
  match(seen.reports.join("\n"), /Format: 1 program updated; 1 left out/);
  equal(text(root.read("Prg/messy.prg")), text(browser.root.read("Prg/messy.prg")), "both hosts write the same bytes for the same choice");
  equal(text(root.read("Prg/second.prg")), OTHER, "the same program is left out in the second host too");
});

test("the VS Code review lists only programs that change, with the comparison in each item's detail", async () => {
  const { root, web } = project();
  const language = inProcessServer(root, "Main/example.gam");
  const leased = await leaseLanguageClient(language, { main: "Main/example.gam" });
  ok(leased.ok);
  const details: string[] = [];
  const { ui, seen } = vscodeUi({ cancel: true, details });
  const provider = scriptProviderOver((params) => leased.lease.client.request(SCRIPT_TRANSFORM_REQUEST, params), (path) => leased.lease.client.uriOf(path));
  const result = await runScriptWorkflow("cleanup", {
    fs: web.services.fs,
    provider,
    history: null,
    openPrograms: () => [],
    root: "",
    activeProgram: null,
  }, ui as never);
  leased.lease.release();
  equal(result.kind, "cancelled");
  deepEqual(seen.items.map((item) => item.path), ["Prg/messy.prg", "Prg/second.prg"]);
  const messy = seen.items.find((item) => item.path === "Prg/messy.prg")!;
  match(messy.detail, /Original and result:/);
  match(messy.detail, /^-MWIN\("Hello"\)$/m);
  match(messy.detail, /^\+ {4}mwin\("Hello"\)$/m);
  match(messy.detail, /Drop ignored `!` and `\$` sigils: done/);
  deepEqual(details.length, 2);
});

test("in the browser, a program open in a tab is edited unsaved, and saving is the author's step", async () => {
  const { root, web, element } = project();
  let bench!: ReturnType<typeof createWorkbench>;
  await act(() => { bench = createWorkbench(web, element, { main: "Main/example.gam" }); });
  await settle();
  await act(async () => { await bench.openPath("Prg/messy.prg"); });
  await settle();
  const found = web.workspace.documents().find((document) => document.identity.path === "Prg/messy.prg");
  ok(found !== undefined, "the program is open in a tab");
  const open = asProgramDocument(found);
  const running = bench.reviewScripts("format");
  await settle();
  await act(() => { [...document.querySelectorAll<HTMLInputElement>(".tkr-script-workflow input[type=radio]")][0]!.click(); });
  await act(() => { [...document.querySelectorAll<HTMLButtonElement>(".tkr-script-workflow button")].find((button) => button.textContent === "Check programs")!.click(); });
  for (let round = 0; round < 40 && document.querySelector(".tkr-script-file") === null; round += 1) await settle(1);
  await act(() => { [...document.querySelectorAll<HTMLButtonElement>(".tkr-script-workflow button")].find((button) => button.textContent?.startsWith("Apply"))!.click(); });
  for (let round = 0; round < 40 && document.querySelector(".tkr-script-outcome") === null; round += 1) await settle(1);
  equal(document.querySelector(".tkr-script-outcome")?.textContent, "1 program updated.");
  equal(open.getSnapshot().text, 'x! = 1\nif (x == 1) {\n    mwin("Hello")\n}\n', "the open program holds the reviewed edit");
  equal(open.getSnapshot().dirty, true, "and it is not saved for the author");
  equal(text(root.read("Prg/messy.prg")), MESSY, "the file on disk is untouched until the author saves");
  const footer = [...document.querySelectorAll<HTMLButtonElement>(".tkr-script-workflow .tkr-script-footer button")];
  await act(() => { footer.at(-1)!.click(); });
  await settle();
  await running;
  // The author's own save, through the workspace, writes the reviewed text and keeps the file's endings.
  await act(async () => { await web.workspace.saveAll(); });
  await settle();
  equal(text(root.read("Prg/messy.prg")), 'x! = 1\nif (x == 1) {\n    mwin("Hello")\n}\n');
  equal(open.getSnapshot().dirty, false);
});

test("cancelling in either host writes nothing and records nothing", async () => {
  const browser = await reviewInBrowser("format", { cancel: true });
  equal(text(browser.root.read("Prg/messy.prg")), MESSY);
  equal(text(browser.root.read("Prg/second.prg")), OTHER);
  ok(browser.root.read(".tkr-history/groups") === null, "no checkpoint group was recorded");

  const { root, web } = project();
  const language = inProcessServer(root, "Main/example.gam");
  const leased = await leaseLanguageClient(language, { main: "Main/example.gam" });
  ok(leased.ok);
  const { ui } = vscodeUi({ cancel: true });
  try {
    const result = await runScriptWorkflow("format", {
      fs: web.services.fs,
      provider: scriptProviderOver((params) => leased.lease.client.request(SCRIPT_TRANSFORM_REQUEST, params), (path) => leased.lease.client.uriOf(path)),
      history: null,
      openPrograms: () => [],
      root: "",
      activeProgram: null,
    }, ui as never);
    equal(result.kind, "cancelled");
  } finally {
    leased.lease.release();
  }
  equal(text(root.read("Prg/messy.prg")), MESSY);
  equal(text(root.read("Prg/second.prg")), OTHER);
});

test("in VS Code, an open program receives one edit and no direct write", async () => {
  const { root, web } = project();
  const language = inProcessServer(root, "Main/example.gam");
  const leased = await leaseLanguageClient(language, { main: "Main/example.gam" });
  ok(leased.ok);
  const edits: { label: string; text: string }[] = [];
  let documentText = MESSY;
  const { ui } = vscodeUi({ untick: ["Prg/second.prg"] });
  try {
    const result = await runScriptWorkflow("format", {
      fs: web.services.fs,
      provider: scriptProviderOver((params) => leased.lease.client.request(SCRIPT_TRANSFORM_REQUEST, params), (path) => leased.lease.client.uriOf(path)),
      history: null,
      openPrograms: () => [{ path: "Prg/messy.prg", text: () => documentText, replace: async (label, next) => { edits.push({ label, text: next }); documentText = next; return { ok: true }; } }],
      root: "",
      activeProgram: "Prg/messy.prg",
    }, ui as never);
    equal(result.kind, "applied");
  } finally {
    leased.lease.release();
  }
  deepEqual(edits, [{ label: "Format (reviewed)", text: 'x! = 1\nif (x == 1) {\n    mwin("Hello")\n}\n' }]);
  equal(text(root.read("Prg/messy.prg")), MESSY, "an open document is edited, never written behind the editor");
});

test("native review surfaces the refusal and fragment before apply, then reports a successful retry", async () => {
  const { root, web } = project();
  const language = inProcessServer(root, "Main/example.gam");
  const leased = await leaseLanguageClient(language, { main: "Main/example.gam" });
  ok(leased.ok);
  const client = leased.lease.client;
  const original = scriptProviderOver((params) => client.request(SCRIPT_TRANSFORM_REQUEST, params), (path) => client.uriOf(path));
  let attempts = 0;
  const { ui, seen } = vscodeUi({ retry: () => attempts === 1 });
  try {
    const finished = await runScriptWorkflow("cleanup", {
      fs: { ...web.services.fs, async write(path, bytes) {
        if (path === "Prg/second.prg" && ++attempts === 1) return { ok: false, error: { code: "io-error", message: "write refused once" } };
        return await web.services.fs.write(path, bytes);
      } },
      provider: { async transform(question) {
        const answer = await original.transform(question);
        return question.path === "Prg/clean.prg" ? {
          ...answer, status: "refused", reason: { code: "unsupported-fragments", message: "Cannot move this fragment" },
          unsupported: [{ line: 3, code: "dialogue-quote", message: "contains a quote" }],
        } : answer;
      } },
      history: createWizardHistory(web.workspace.checkpoints),
      openPrograms: () => [],
      root: "",
      activeProgram: null,
    }, ui);
    equal(finished.kind, "applied");
    deepEqual(seen.leftAsWritten, ["Prg/clean.prg: Cannot move this fragment; line 3: contains a quote"]);
    match(seen.reports[0]!, /write refused once/);
    match(seen.reports[1]!, /2 programs updated/);
    equal(attempts, 2);
    equal(text(root.read("Prg/clean.prg")), CLEAN);
  } finally {
    leased.lease.release();
  }
});
