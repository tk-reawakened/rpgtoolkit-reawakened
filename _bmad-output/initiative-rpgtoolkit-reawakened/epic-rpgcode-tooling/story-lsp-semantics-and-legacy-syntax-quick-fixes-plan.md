---
title: "LSP semantics and legacy-syntax quick fixes: hover, call tips, completion, go-to-definition, outline and behaviour-preserving code actions"
ticket: 5
status: in-progress
---

## Intent

Entry 10.5 fills the server with the epic's Done-when 1 and 2: hover and call tips, completion, go-to-definition across includes, an outline, and one code action per legacy form. Every one is a lookup into an artefact earlier entries built - `analyse()` for diagnostics, `commandDocumentation()` for help, the 10.4 index for includes/calls/definitions - never a second walk of the source.

## Slices

| Slice | What it adds |
|---|---|
| 1. Diagnose | `packages/lsp` with `createServer(connection)`, `didOpen`/`didChange` compiled through `analyse()` and published as TOOL-3 diagnostics in LSP ranges; an in-memory connection-pair test; the `script-tools -> lsp` edge, the `r5-lsp-no-node` rule, the CI shard and the `THIRD_PARTY_NOTICES` entries for the three MIT server libraries (with their transitive `vscode-jsonrpc` and `vscode-languageserver-types`) |
| 2. Semantics | hover/call tips from `commandDocumentation()`, completion of catalogue names and program symbols, go-to-definition across `#include` and `file.func`, outline from functions/classes/labels - all lookups into `buildIndex()` |
| 3. Quick fixes | one action per row of `docs/spec/engine/rpgcode-dialects.md:57-69` and the `BuiltinDoc.replacedBy` deprecations, each a span edit re-parsed after the fix, proven against the corpus gate that the state hash is unchanged |

## Decisions (slice 1)

- **The connection is structural.** `ServerConnection` names the four methods the server uses (`onInitialize`, `onDidOpenTextDocument`, `onDidChangeTextDocument`, `sendDiagnostics`) with the protocol's own parameter types, so a host's `Connection` satisfies it and the package never imports the Node entry point that builds one. `createServer` is the only export.
- **Range conversion lives in one place.** TOOL-3 is 1-based with an inclusive end; LSP is 0-based with an exclusive end, so the start column loses one and the end column stands. `source` is `rpgcode` and the TOOL-3 code is the LSP `code`.
- **Document sync is ours, not a helper's.** A `Map<uri, TextDocument>` applies full and incremental changes with `TextDocument.update`, which keeps the runtime import surface at `vscode-languageserver-textdocument` plus protocol types - the invariant slice 1's no-Node rule pins.

## Verify, mapped

| Ticket verify | Slice |
|---|---|
| hover text matches `commandDocumentation()` byte for byte | 2 |
| go-to-definition resolves includes across the fetched sample corpus | 2 |
| the outline lists every function, class and label | 2 |
| each quick fix leaves a program whose run reproduces the pre-fix state hash | 3 |
