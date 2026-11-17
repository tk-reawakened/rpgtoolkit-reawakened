import * as vscode from "vscode";
import { platformError, type PlatformResult, type RunHandle, type RunService } from "@tk-reawakened/platform-services";
import { createLaunchPrompts, pickWorkspace, workspaceRoots } from "./launch-prompts.ts";
import { configurationOfSetup, launchConfiguration, mergeAnswers, resolveLaunch, setupConfigurations, TKR_DEBUG_TYPE, type LaunchPrompts } from "./run-configuration.ts";
import { readLaunchSetups } from "@tk-reawakened/editor-model";
import { createVscodeFileSystem } from "./filesystem.ts";
import { RunDebugSession, type DapRequest } from "./run-debug-adapter.ts";

/**
 * The `tkr` debug type (ADR 0037): the game, a board test and a program test as Run and Debug launches. The provider
 * asks for missing values with the palette's prompts; the inline adapter starts the run through the same run service.
 */

/** Where the provider records the workspace folder it resolved, for a configuration VS Code gave no folder. */
const WORKSPACE_KEY = "__tkrWorkspace";

/** The configurations a new `launch.json` starts with. */
export const INITIAL_CONFIGURATIONS: vscode.DebugConfiguration[] = [
  { type: TKR_DEBUG_TYPE, request: "launch", name: "Run game", kind: "game" },
  { type: TKR_DEBUG_TYPE, request: "launch", name: "Test board", kind: "board" },
  { type: TKR_DEBUG_TYPE, request: "launch", name: "Test program", kind: "program" },
];

/** Prompts that never ask: the adapter turns an already resolved configuration back into a `Launch`. */
const NO_PROMPTS: LaunchPrompts = {
  kind: async () => undefined, main: async () => undefined, projectFolder: async () => undefined, program: async () => undefined,
  board: async () => undefined, coordinate: async () => undefined, party: async () => undefined, font: async () => undefined,
  fontSize: async () => undefined, windowGraphic: async () => undefined,
};

class InlineRunAdapter implements vscode.DebugAdapter {
  readonly #messages = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  readonly #session: RunDebugSession;
  readonly onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage> = this.#messages.event;

  constructor(start: (configuration: Readonly<Record<string, unknown>>) => Promise<PlatformResult<RunHandle>>) {
    this.#session = new RunDebugSession(start, (message) => this.#messages.fire(message as vscode.DebugProtocolMessage));
  }

  handleMessage(message: vscode.DebugProtocolMessage): void {
    this.#session.handle(message as DapRequest);
  }

  dispose(): void {
    this.#session.dispose();
    this.#messages.dispose();
  }
}

/** Register the `tkr` configuration provider and inline adapter; both extension hosts call this once. */
export function registerRunDebugger(context: vscode.ExtensionContext, runForProject: (root: vscode.Uri) => RunService): void {
  /** Live `tkr` sessions, so a restart (VS Code re-resolves the configuration) reuses the answers given at the start. */
  const live = new Set<vscode.DebugSession>();
  context.subscriptions.push(vscode.debug.onDidStartDebugSession((session) => { if (session.type === TKR_DEBUG_TYPE) live.add(session); }));
  context.subscriptions.push(vscode.debug.onDidTerminateDebugSession((session) => { live.delete(session); }));

  const provider: vscode.DebugConfigurationProvider = {
    // A new launch.json starts with the project's saved setups (ADR 0022 D8.7), or with the three launches when it has none.
    provideDebugConfigurations: async (folder) => {
      const saved = folder === undefined ? [] : await savedSetups(folder);
      return saved.length > 0 ? saved : INITIAL_CONFIGURATIONS;
    },
    resolveDebugConfiguration: (_folder, configuration) => {
      // F5 with no launch.json gives an empty configuration: make it a launch and ask which one when it is resolved.
      if (configuration.type === undefined && configuration.request === undefined && configuration.name === undefined) {
        return { ...configuration, type: TKR_DEBUG_TYPE, request: "launch", name: "TK Reawakened" };
      }
      return configuration;
    },
    resolveDebugConfigurationWithSubstitutedVariables: async (folder, configuration) => {
      if (configuration.request !== "launch") {
        void vscode.window.showErrorMessage(`A ${TKR_DEBUG_TYPE} configuration must use "request": "launch".`);
        return undefined;
      }
      const workspace = folder ?? await pickWorkspace("Choose the game's project");
      if (workspace === undefined) return undefined;
      const previous = [...live].find((session) => session.name === configuration.name
        && session.configuration[WORKSPACE_KEY] === workspace.uri.toString());
      let given = withoutUndefined(configuration);
      if (configuration.configuration !== undefined) {
        // A named setup is read again on every start and restart, so a changed setup affects the next run (D8.7).
        const fromSetup = configurationOfSetup(given, await readLaunchSetups(createVscodeFileSystem(workspace.uri)));
        if (!fromSetup.ok) {
          void vscode.window.showErrorMessage(`${configuration.name}: ${fromSetup.message}`);
          return undefined;
        }
        given = { ...fromSetup.configuration, name: configuration.name };
      }
      const merged = mergeAnswers(previous?.configuration ?? {}, given);
      const resolved = await resolveLaunch(merged, workspaceRoots(workspace.uri), createLaunchPrompts(workspace.uri));
      if (!resolved.ok) {
        if (!resolved.cancelled) void vscode.window.showErrorMessage(`${configuration.name}: ${resolved.message}`);
        return undefined;
      }
      return {
        type: TKR_DEBUG_TYPE, request: "launch", name: configuration.name,
        ...launchConfiguration(resolved.launch),
        [WORKSPACE_KEY]: workspace.uri.toString(),
      };
    },
  };
  context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider(TKR_DEBUG_TYPE, provider));
  // Run and Debug's list offers every saved setup of each workspace folder, then the three launches.
  context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider(TKR_DEBUG_TYPE, {
    provideDebugConfigurations: async (folder) => [...(folder === undefined ? [] : await savedSetups(folder)), ...INITIAL_CONFIGURATIONS],
  }, vscode.DebugConfigurationProviderTriggerKind.Dynamic));

  async function savedSetups(folder: vscode.WorkspaceFolder): Promise<vscode.DebugConfiguration[]> {
    return setupConfigurations(await readLaunchSetups(createVscodeFileSystem(folder.uri)), TKR_DEBUG_TYPE);
  }

  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory(TKR_DEBUG_TYPE, {
    createDebugAdapterDescriptor: () => new vscode.DebugAdapterInlineImplementation(new InlineRunAdapter(start)),
  }));

  async function start(configuration: Readonly<Record<string, unknown>>): Promise<PlatformResult<RunHandle>> {
    const key = configuration[WORKSPACE_KEY];
    const workspace = typeof key === "string" ? vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(key, true)) : undefined;
    if (workspace === undefined || workspace.uri.toString() !== key) {
      return platformError("invalid-request", "The launch's workspace folder is no longer open.");
    }
    const resolved = await resolveLaunch(configuration, workspaceRoots(workspace.uri), NO_PROMPTS);
    if (!resolved.ok) return platformError("invalid-request", resolved.cancelled ? "The launch configuration is incomplete." : resolved.message);
    const run = runForProject(workspace.uri);
    const launch = resolved.launch;
    return launch.kind === "program" ? await run.startProgram(launch) : await run.startGame(launch);
  }
}

function withoutUndefined(configuration: vscode.DebugConfiguration): Record<string, unknown> {
  return Object.fromEntries(Object.entries(configuration).filter(([, value]) => value !== undefined));
}

