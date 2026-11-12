// The probe extension's source: it logs when it activates and answers `probe` launches with
// an inline adapter that replies `initialize` and then terminates. Bundled twice by
// `tools/vscode-web/build-minimal.mjs`, once CommonJS and once IIFE, so the harness can show
// which module shape the web extension host actually executes.

const vscode = require("vscode");

class ProbeAdapter {
  constructor() {
    this.emitter = new vscode.EventEmitter();
    this.onDidSendMessage = this.emitter.event;
  }

  handleMessage(message) {
    console.log(`[probe] adapter received ${message.command}`);
    if (message.type !== "request") return;
    this.emitter.fire({ seq: 1, type: "response", request_seq: message.seq, success: true, command: message.command, body: { supportsConfigurationDoneRequest: true } });
    if (message.command === "disconnect") this.emitter.fire({ seq: 2, type: "event", event: "terminated" });
  }

  dispose() {
    this.emitter.dispose();
  }
}

exports.activate = function activate(context) {
  console.log("[probe] activate ran");
  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory("probe", {
    createDebugAdapterDescriptor: () => new vscode.DebugAdapterInlineImplementation(new ProbeAdapter()),
  }));
  console.log("[probe] debug adapter factory registered");
};

exports.deactivate = function deactivate() {
  console.log("[probe] deactivate ran");
};
