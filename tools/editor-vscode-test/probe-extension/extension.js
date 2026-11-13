const vscode = require("vscode");

function activate(context) {
  console.info("[vscode-web-proof-probe] activated");
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
    else if (type === vscode.FileType.File && name.toLowerCase().endsWith(".gam")) found.push(child);
  }
  return found;
}

module.exports = { activate };
