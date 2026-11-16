import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { DocumentSymbol } from "vscode-languageserver-protocol";
import { SEMANTIC_LEGEND } from "../src/index.ts";
import { startStdio } from "./stdio-client.ts";

/** TOOL-10 over the real stdio binary: the legend is advertised, colouring and bookmarks are served as requests. */
test("stdio LSP advertises semantic tokens, colours a buffer that does not compile and lists comment bookmarks", { timeout: 15_000 }, async () => {
  const client = await startStdio();
  try {
    assert.deepEqual(client.initialized.capabilities.semanticTokensProvider, { legend: SEMANTIC_LEGEND, full: true });
    const uri = "file:///typing.prg";
    await client.open(uri, '// Intro\nmwin("unfinished');
    const tokens = await client.connection.sendRequest<{ data: number[] }>("textDocument/semanticTokens/full", { textDocument: { uri } });
    assert.deepEqual(tokens.data.slice(0, 5), [0, 0, 8, SEMANTIC_LEGEND.tokenTypes.indexOf("comment"), 0]);
    assert.equal(tokens.data.length, 15);
    const symbols = await client.connection.sendRequest<DocumentSymbol[]>("textDocument/documentSymbol", { textDocument: { uri } });
    assert.deepEqual(symbols.map((symbol) => symbol.name), ["Intro"]);
  } finally {
    await client.close();
  }
});
