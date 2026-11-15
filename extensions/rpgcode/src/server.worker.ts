import { createConnection, BrowserMessageReader, BrowserMessageWriter } from "vscode-languageserver/browser.js";
import { serveConnection } from "@tk-reawakened/lsp/serve";

// Browser worker host for the RPGCode language server (TOOL-1, D-4 web target).
// Bundled into dist/server.worker.js as a self-contained worker.
const connection = createConnection(new BrowserMessageReader(self as unknown as Worker), new BrowserMessageWriter(self as unknown as Worker));
serveConnection(connection);
connection.listen();
