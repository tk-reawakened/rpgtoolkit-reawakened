---
title: "LSP semantics and legacy-syntax quick fixes: hover, call tips, completion, go-to-definition, outline and behaviour-preserving code actions"
ticket: 5
status: done
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

## Landing

Merged as **`1b5562b8b008d64710e5feb367a16d76e5fc2307`** — "feat(10.5): LSP semantics and legacy-syntax quick fixes (#943)" (PR [#980](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/980), squash). Issue #943 closed as completed.

Three commits (diagnostics; semantics; quick fixes) plus a merge of `main` that took its new `runner-web` test group beside this entry's `lsp` group (11 groups, 198 files).

Gates at the final head: `typecheck`, `lint`, `graph`, `licence`, `provenance`, `catalogue:check`, `command-docs:check`, `fixtures:author:check`, `golden`, `golden:bun` and `closing` (8/8) all pass; `test:strict` 2519/2519, 0 skipped. CI run 41248883192 green on all 16 checks, including the new `unit (lsp)` shard.

Two verify lines are met by equivalent evidence, recorded in the PR:

- go-to-definition is proved through the loader seam on multi-file fixtures (explicit `#include` and `file.func`); the corpus-wide assertion belongs to 10.9's tool job, which has the fetched tree on disk.
- the quick fixes are proved by lowering the TK2 original and the fixed 3.1 text to the same instruction array (positions ignored), which is stronger than one run's state hash: identical ops mean identical behaviour for every input (G3). The run-level check rides on 10.9's corpus gate; building an `lsp -> runner-harness` edge for a test would break the architecture.

Rows with no rewrite are `DIAGNOSTIC_ONLY_ROWS`: `if (x = 5)` (an assignment to the 3.1 reader), `m[key]` (a variable index in 3.1) and loose text lines (indistinguishable from a typo or a label).
