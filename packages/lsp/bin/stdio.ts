import { createConnection, ProposedFeatures } from "vscode-languageserver/node.js";
import { serveConnection } from "../dist/serve.js";

// The stdio host for the RPGCode language server (TOOL-1). This file lives
// outside `packages/lsp/src/` and the package's public export so importing the
// library never opens a pipe and the library stays free of Node APIs (G2).
const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
serveConnection(connection);
connection.listen();
