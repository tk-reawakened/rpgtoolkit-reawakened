import { createConnection, BrowserMessageReader, BrowserMessageWriter } from "vscode-languageserver/browser.js";
import { serveConnection } from "@tk-reawakened/lsp/serve";

// The standalone editor's language server: a same-origin classic worker, bundled by the host's build into
// `language-worker.js` (docs/spec/engine/rpgcode-tooling.md#tool-10-connect). It speaks the Language Server Protocol over
// `postMessage` and knows nothing of the page.
const connection = createConnection(new BrowserMessageReader(self as unknown as Worker), new BrowserMessageWriter(self as unknown as Worker));
serveConnection(connection);
connection.listen();
