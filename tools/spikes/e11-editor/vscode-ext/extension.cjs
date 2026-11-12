// Throwaway web extension for the Monaco spike: opens one webview whose HTML is host-vscode's own template (read from
// packages/host-vscode/src/extension.ts by the spec and written to media/variant.json with any extra directives), and
// loads a Monaco bundle from the extension's media folder through asWebviewUri, exactly as host-vscode loads its view.
const vscode = require("vscode");

function withDirective(policy, name, value) {
  const parts = policy.split(";").map((part) => part.trim()).filter(Boolean).filter((part) => part.split(/\s+/)[0] !== name);
  return [...parts, `${name} ${value}`].join("; ") + ";";
}

exports.activate = async (context) => {
  const media = vscode.Uri.joinPath(context.extensionUri, "media");
  const variant = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(media, "variant.json"))));
  const panel = vscode.window.createWebviewPanel("tkrSpike", "TKR spike", vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [media] });
  const webview = panel.webview;
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map((value) => value.toString(16).padStart(2, "0")).join("");
  const uri = (name) => webview.asWebviewUri(vscode.Uri.joinPath(media, name)).toString();
  let csp = variant.template.replaceAll("${webview.cspSource}", webview.cspSource).replaceAll("${nonce}", nonce);
  for (const [name, value] of Object.entries(variant.extra)) csp = withDirective(csp, name, value.replaceAll("${webview.cspSource}", webview.cspSource));
  webview.html =
    `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<meta name="tkr-worker" content="${uri("editor.worker.js")}"><meta name="tkr-csp" content="${csp}">` +
    `<link rel="stylesheet" nonce="${nonce}" href="${uri(`${variant.bundle}.css`)}"></head>` +
    `<body><div id="editor"></div><script nonce="${nonce}" src="${uri(`${variant.bundle}.js`)}"></script></body></html>`;
};
