---
title: "RPGCode index: symbols, includes, call sites and event listeners as one versioned JSON schema"
ticket: 4
status: in-progress
---

## Intent

Entry 10.4 is the one symbol, reference and include index the language server (10.5), the linter (10.6) and `tkr script index` (10.9) read instead of each walking the compiler. It writes one versioned JSON document (`tkr-index/1.0`) whose contract is TOOL-6, and it reads the compiler rather than a second pass: definitions from the parsed units and the compiled function/class/label tables, sites from the lowered ops at their `SourcePos`, includes from the requests the compiler applied, and listeners from the parsed AST.

## Slices

| Slice | What it changes |
|---|---|
| A. Docs-first (G7) | TOOL-6 gains the symbol-identity scheme, the site shape, the per-program field table, the broken-program rule ("the absence is the fact"), and the schema path; the schema is `docs/spec/schemas/tkr-script-index.schema.json` |
| B. Compiler seam | `Program.units`: each parsed file's key, name, AST, include requests and decoded text, so the index (and the LSP's go-to-definition) reads the compiler's own view instead of re-parsing |
| C. `buildIndex` | `packages/script-tools/src/index-document.ts`: the document types, `buildIndex(programs, { loader, startups })`, and the empty-facts entry for a program that does not compile |
| D. Tests | schema conformance (a dependency-free checker over the schema's own keyword subset), byte stability across two runs, definitions/includes/calls/references/listeners/start-up, a broken program, and `stock/stock_rpg/startup.prg` |

## Decisions

- **Identity.** `<file>#<kind>:<name>` with the **folded** spelling, because RPGCode folds identifiers at lex time (LEX-10) and the compiler's tables hold no other spelling; `qualifiedName` is the dotted name a reader recognises and is explicitly not an identity.
- **`written`.** A site records the exact source spelling whenever the compiler's position is the identifier token (every call, member and variable site), by slicing the unit's text. A declaration anchors on its keyword by TOOL-3, so it has no `written`; the spec says so rather than inventing one.
- **`storeRef`.** The IR keeps a store target on the stack, so a store site has `name: null` and `kind: "store"`. The document states it; the schema allows it.
- **No validator dependency.** G6 requires an ADR for a new dev-only tool, and 10.9 owns the schema-validation machinery. The test therefore implements the exact keyword subset the committed schema uses and **fails on a keyword it does not implement**, so the schema cannot silently outgrow its check.
- **`game.on(...)`.** The compiler reads it as a `file.func` call to `on` in file `game`, so the index reports that call, the `game.prg` implicit include (unresolved), and the listener `dialogue.completed`. That is the compiler's fact, not a special case in the index.

## Verify, mapped

| Ticket verify | Where |
|---|---|
| every function, class, label and include with file and line; every call site with callee and arity | `packages/script-tools/test/index.test.ts` |
| a `file.func` call through an include appears under the including program with the edge | `lib.helper(1)` + `#include "lib.prg"` in the same test |
| a class's methods and members appear under the class | the `counter` fixture |
| an `on("error", …)` site names its event | the listener fixture and the stock program |
| a syntax error yields a located diagnostic and no fabricated facts | the broken-program test |
| the document validates against the schema and is byte-stable | the conformance and two-run tests |

## Out of scope

No LSP transport (10.1/10.5), no lint rules (10.6), no formatter (10.7), no CLI wiring (10.9). The index builder takes compiled inputs and returns a value; it reads no file itself.
