import * as vscode from "vscode";
import { createDebugSession, type DapRequest, type DebugSession } from "@tk-reawakened/dap";
import { createSceneDebugTarget } from "@tk-reawakened/runner-harness";

/**
 * The RPGCode debugger as a VS Code inline adapter (TOOL-1, TOOL-8; AD-21).
 *
 * The session is transport-free, so an inline implementation is the whole
 * adapter: VS Code hands it parsed DAP messages and it hands back parsed
 * responses and events. Both extension hosts — the desktop client over stdio
 * and the `vscode.dev` web client in a worker bundle — register this same
 * factory, so the two cannot disagree.
 *
 * The launch reads the program and the board through `vscode.workspace.fs`,
 * which is the web-safe file API, and builds the scene with the harness's own
 * SceneInit helper; the debug adapter itself reads no file.
 */

const DEBUG_TYPE = "rpgcode";

type LaunchArguments = {
  readonly program?: unknown;
  readonly board?: unknown;
  readonly seed?: unknown;
};

function pathArgument(args: LaunchArguments, name: "program" | "board"): string {
  const value = args[name];
  if (typeof value !== "string" || value === "") {
    throw new Error(`the RPGCode launch needs "${name}" (a path to the ${name === "program" ? "RPGCode program" : "board"})`);
  }
  return value;
}

/**
 * A launch argument names a file, either as a plain path or as a URI string. A web
 * workspace lives on a virtual file system, so a `vscode-test-web:` or `memfs:` URI
 * cannot be turned into a `file:` one; it is parsed and read through `workspace.fs`.
 */
function uriOf(value: string): vscode.Uri {
  const parsed = vscode.Uri.parse(value, true);
  return parsed.scheme === "" || parsed.scheme === "file" ? vscode.Uri.file(value) : parsed;
}

async function readFixtureFile(path: string): Promise<Uint8Array> {
  return vscode.workspace.fs.readFile(uriOf(path));
}

class RpgcodeInlineAdapter implements vscode.DebugAdapter {
  readonly #messages = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  readonly #session: DebugSession;
  readonly onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage> = this.#messages.event;

  constructor() {
    this.#session = createDebugSession(
      {
        launch: async (launchArguments) => {
          const program = pathArgument(launchArguments, "program");
          const board = pathArgument(launchArguments, "board");
          const [programBytes, boardBytes] = await Promise.all([readFixtureFile(program), readFixtureFile(board)]);
          const programUri = uriOf(program);
          const boardUri = uriOf(board);
          return createSceneDebugTarget({
            board: boardUri.scheme === "file" ? (board.split(/[\\/]/).at(-1) ?? board) : (boardUri.path.split("/").at(-1) ?? board),
            boardBytes,
            program: new TextDecoder().decode(programBytes),
            // A virtual document is named by its path, which is what a client reports as
            // `source.path`, so its breakpoints match; a plain path stays exactly as given.
            programPath: programUri.scheme === "file" ? program : programUri.path,
            seed: typeof launchArguments.seed === "number" ? launchArguments.seed : 7,
          });
        },
      },
      (message) => this.#messages.fire(message as unknown as vscode.DebugProtocolMessage),
    );
  }

  handleMessage(message: vscode.DebugProtocolMessage): void {
    this.#session.handle(message as unknown as DapRequest);
  }

  dispose(): void {
    this.#session.dispose();
    this.#messages.dispose();
  }
}

/** Register the debug adapter factory; both hosts call this once from `activate`. */
export function registerDebugAdapter(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory(DEBUG_TYPE, {
      createDebugAdapterDescriptor: () => new vscode.DebugAdapterInlineImplementation(new RpgcodeInlineAdapter()),
    }),
  );
}
