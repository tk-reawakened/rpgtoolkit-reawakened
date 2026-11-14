const vscode = require("vscode");
const proofSecret = "__TKR_PROOF_SECRET__";

function activate(context) {
  console.info("[vscode-web-proof-probe] activated");
  const filesystem = new PersistentFileSystem();
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider("tkr-testfs", filesystem, { isCaseSensitive: true }));
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  context.subscriptions.push(status);
  const report = (text) => { status.text = text; status.show(); };
  context.subscriptions.push(vscode.commands.registerCommand("tkr.editorWebProof.failSaves", () => { filesystem.failSaves = true; }));
  context.subscriptions.push(vscode.commands.registerCommand("tkr.editorWebProof.allowSaves", () => { filesystem.failSaves = false; }));
  context.subscriptions.push(vscode.commands.registerCommand("tkr.editorWebProof.pauseProgramRead", () => {
    filesystem.pauseProgramRead = () => report("Fixture read paused");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("tkr.editorWebProof.resumeProgramRead", () => filesystem.resumeProgramRead?.()));
  context.subscriptions.push(vscode.commands.registerCommand("tkr.editorWebProof.runExampleGame", async () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (workspace === undefined) throw new Error("The proof workspace is not open");
    await vscode.commands.executeCommand("tkr.runGame",
      vscode.Uri.joinPath(workspace.uri, "Main", "example.gam"),
      vscode.Uri.joinPath(workspace.uri, "Game", "Example"));
  }));
  context.subscriptions.push(vscode.commands.registerCommand("tkr.editorWebProof.runExampleProgram", async () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (workspace === undefined) throw new Error("The proof workspace is not open");
    report("Program launch pending");
    const result = await vscode.commands.executeCommand("tkr.testProgram", workspace.uri, {
      kind: "program", main: "Main/example.gam", projectFolder: "Game/Example",
      program: "Game/Example/Prg/start.prg",
      fixture: { id: "VS Code proof", font: "Liberation Sans", fontSize: 18, windowGraphic: "Game/Example/Bitmap/window.png",
        party: ["Game/Example/Chrs/ada.tem"],
        start: { board: "Game/Example/Boards/village.brd", x: 2, y: 2, layer: 1 } },
    });
    report(result?.ok ? "Program launch accepted" : `Program launch refused: ${result?.error?.message ?? "unknown error"}`);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("tkr.editorWebProof.runExampleBoard", async () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (workspace === undefined) throw new Error("The proof workspace is not open");
    report("Board launch pending");
    const result = await vscode.commands.executeCommand("tkr.startBoard", workspace.uri, {
      kind: "board", main: "Main/example.gam", projectFolder: "Game/Example", seed: 23,
      party: ["Game/Example/Chrs/ada.tem"],
      start: { board: "Game/Example/Boards/village.brd", x: 2, y: 2, layer: 1 },
    });
    report(result?.ok ? "Board launch accepted" : `Board launch refused: ${result?.error?.message ?? "unknown error"}`);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("tkr.editorWebProof.copyMainFileBytes", async () => {
    console.info("[vscode-web-proof-probe] copy command invoked");
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (workspace === undefined) throw new Error("The proof workspace is not open");
    const gameFiles = await findGameFiles(workspace.uri);
    console.info(`[vscode-web-proof-probe] discovered ${gameFiles.length} game file(s)`);
    if (gameFiles.length !== 1) throw new Error(`Expected one .gam file in the proof workspace; found ${gameFiles.length}`);
    console.info(`[vscode-web-proof-probe] reading persisted file ${gameFiles[0].toString()}`);
    const bytes = await withTimeout(vscode.workspace.fs.readFile(gameFiles[0]), "workspace.fs.readFile");
    console.info(`[vscode-web-proof-probe] workspace.fs.readFile returned ${bytes.length} bytes`);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    const encoded = btoa(binary);
    const id = crypto.randomUUID();
    console.info(`[vscode-web-proof-probe] displaying ${encoded.length} base64 characters in a temporary read-only webview`);
    const panel = vscode.window.createWebviewPanel(
      "tkr.editorWebProof.persistedBytes",
      `Persisted Main File Bytes #${id}`,
      vscode.ViewColumn.Beside,
      { enableScripts: false },
    );
    context.subscriptions.push(panel);
    panel.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';"></head><body><pre id="tkr-proof-persisted-bytes-${id}">${encoded}</pre></body></html>`;
    console.info(`[vscode-web-proof-probe] persisted bytes published in read-only webview #${id}`);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("tkr.editorWebProof.writeGameBytes", async (encoded) => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (workspace === undefined) throw new Error("The proof workspace is not open");
    const gameFiles = await findGameFiles(workspace.uri);
    if (gameFiles.length !== 1) throw new Error(`Expected one .gam file in the proof workspace; found ${gameFiles.length}`);
    const bytes = Uint8Array.from(atob(String(encoded)), (character) => character.charCodeAt(0));
    await withTimeout(vscode.workspace.fs.writeFile(gameFiles[0], bytes), "workspace.fs.writeFile");
    console.info(`[vscode-web-proof-probe] wrote ${bytes.length} bytes behind the editor's back`);
  }));
  const setAutosave = (value) => async () => {
    const configuration = vscode.workspace.getConfiguration("files");
    await configuration.update("autoSave", value, vscode.ConfigurationTarget.Workspace);
    if (value !== "off") await configuration.update("autoSaveDelay", 1000, vscode.ConfigurationTarget.Workspace);
    console.info(`[vscode-web-proof-probe] files.autoSave=${String(configuration.get("autoSave"))} delay=${String(configuration.get("autoSaveDelay"))}`);
  };
  context.subscriptions.push(vscode.commands.registerCommand("tkr.editorWebProof.enableAutosave", setAutosave("afterDelay")));
  context.subscriptions.push(vscode.commands.registerCommand("tkr.editorWebProof.disableAutosave", setAutosave("off")));
}
function withTimeout(operation, stage) {
  let timer;
  return Promise.race([
    operation,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${stage} did not complete within 15 seconds`)), 15_000); }),
  ]).finally(() => clearTimeout(timer));
}

async function findGameFiles(directory) {
  const found = [];
  for (const [name, type] of await vscode.workspace.fs.readDirectory(directory)) {
    const child = vscode.Uri.joinPath(directory, name);
    if (type === vscode.FileType.Directory) found.push(...await findGameFiles(child));
    else if (type === vscode.FileType.File && name.toLowerCase().endsWith(".gam") && name !== "__tkr_sentinel.gam") found.push(child);
  }
  return found;
}

module.exports = { activate };
class PersistentFileSystem {
  constructor() {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeFile = this.emitter.event;
  }

  watch() { return new vscode.Disposable(() => {}); }
  stat(uri) { return this.request(uri, "stat"); }
  readDirectory(uri) { return this.request(uri, "readDirectory"); }
  async readFile(uri) {
    if (this.pauseProgramRead && uri.path.endsWith("/Game/Example/Prg/start.prg")) {
      const notify = this.pauseProgramRead;
      this.pauseProgramRead = undefined;
      await new Promise((resolve) => { this.resumeProgramRead = resolve; notify(); });
      this.resumeProgramRead = undefined;
    }
    const encoded = await this.request(uri, "readFile");
    return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  }
  async writeFile(uri, content, options) {
    if (this.failSaves && uri.path.endsWith("/Main/example.gam")) throw vscode.FileSystemError.NoPermissions("Proof: injected save failure");
    let binary = "";
    for (let offset = 0; offset < content.length; offset += 0x8000) binary += String.fromCharCode(...content.subarray(offset, offset + 0x8000));
    const { created } = await this.request(uri, "writeFile", { data: btoa(binary), ...options });
    this.emitter.fire([{ type: created ? vscode.FileChangeType.Created : vscode.FileChangeType.Changed, uri }]);
  }
  async createDirectory(uri) {
    await this.request(uri, "createDirectory");
    this.emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
  }
  async delete(uri, options) {
    await this.request(uri, "delete", options);
    this.emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }
  async rename(oldUri, newUri, options) {
    if (oldUri.authority !== newUri.authority) throw vscode.FileSystemError.NoPermissions("Cross-workspace rename is not permitted");
    await this.request(oldUri, "rename", { destination: newUri.path, ...options });
    this.emitter.fire([{ type: vscode.FileChangeType.Deleted, uri: oldUri }, { type: vscode.FileChangeType.Created, uri: newUri }]);
  }
  async request(uri, op, extra = {}) {
    const match = /^[0-9a-f]{32}\.(\d{1,5})$/.exec(uri.authority);
    if (!match || !/^[0-9a-f]{64}$/.test(proofSecret)) throw vscode.FileSystemError.NoPermissions("Invalid test filesystem credentials");
    const response = await fetch(`http://127.0.0.1:${match[1]}/${proofSecret}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, path: uri.path, ...extra }),
    });
    const payload = await response.json();
    if (!response.ok) {
      const error = payload.error;
      if (error === "ENOENT") throw vscode.FileSystemError.FileNotFound(uri);
      if (error === "EEXIST") throw vscode.FileSystemError.FileExists(uri);
      if (error === "ENOTDIR") throw vscode.FileSystemError.FileNotADirectory(uri);
      if (error === "EISDIR") throw vscode.FileSystemError.FileIsADirectory(uri);
      if (error === "EACCES" || error === "EPERM") throw vscode.FileSystemError.NoPermissions(uri);
      throw vscode.FileSystemError.Unavailable(payload.message);
    }
    return payload.result;
  }
}
