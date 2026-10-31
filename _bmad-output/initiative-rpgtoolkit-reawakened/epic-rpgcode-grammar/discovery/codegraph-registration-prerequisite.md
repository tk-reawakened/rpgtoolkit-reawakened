---
type: discovery
title: "CodeGraph registration prerequisite (blocker B-01): upstream request and adapter fallback"
date: 2026-10-31
baseline_revision: de43ad735ee4e1014aa9ea67165fa76f61edf492
issue: "#870"
---

# CodeGraph registration prerequisite

Entry 22.2 proved that the Wasm artifact route works and that **registration** is the gap (blocker B-01 in
[`scanner-wasm-codegraph-routes.md`](scanner-wasm-codegraph-routes.md) F-05/F-06). The epic requires that
prerequisite to be tracked, not merely described. This record is that tracking artefact: a written upstream request,
an adapter fallback, pinned versions, the licence position and exit criteria for both. **Nothing is shipped by this
entry**; no grammar, scanner, `.wasm`, dependency, config or CI file changes.

## Pinned facts the request rests on

| Fact | Value | Source |
|---|---|---|
| CodeGraph | 1.6.2, MIT, one platform package `@colbymchenry/codegraph-darwin-arm64` 1.6.2 | `docs/codegraph.md`; installed package |
| Grammar runtime | web-tree-sitter **0.25.10** (MIT), bundled in the platform package | `lib/node_modules/web-tree-sitter/package.json` |
| Prebuilt grammars | tree-sitter-wasms **0.1.13** (Unlicense), 36 files | `lib/node_modules/tree-sitter-wasms/out/` |
| Registration surface | fixed `WASM_GRAMMAR_FILES` map; `resolveWasmPath` resolves vendored `wasm/<file>` or `require.resolve('tree-sitter-wasms/out/<file>')`; closed `Language` union; one extractor module per language; `codegraph.json` maps an extension only onto a supported language | `lib/dist/extraction/grammars.js:71-74,111,452-456,522`; `lib/dist/project-config.js:50-56,169` |
| Our artifact | ABI 15, loads under web-tree-sitter 0.25.10 and 0.27.1 | `scanner-wasm-codegraph-routes.md` F-03/F-04 |

Consequence: the blocker is not the file format, the ABI or the runtime; it is the absence of a registration seam and
an extractor contract. Any route must therefore supply *both* a grammar and an extractor, or a generic extractor the
grammar's queries drive.

## Option 1 — upstream capability request (preferred)

**Ask.** A supported way for a project to register a language CodeGraph does not ship:

1. `codegraph.json` gains a `languages` entry keyed by a language id, with `{ grammar: "<path to .wasm>", extensions:
   ["rnc", "prg"], queries?: { symbols: "<path>", imports: "<path>", calls: "<path>" } }` — the grammar path may be
   absolute or project-root-relative.
2. A generic query-driven extractor: given the grammar and the three query files, it walks the captured nodes and
   emits symbol, import and call nodes/edges with the same shape the built-in extractors emit. No TypeScript mapping
   and no per-language code in the CodeGraph package.
3. `codegraph status`/`sync` report the registered language's file count and any grammar load failure as a located
   diagnostic rather than a silent skip.

**Minimal surface for a first reply.** Steps 1 and 2 for one language, reads only; incremental refresh can follow.
The request is small enough for a single upstream change and needs no change to the existing 36 grammars.

**Exit criteria (for 22.10).** A released CodeGraph version, pinned in `docs/codegraph.md`, indexes a spec-authored
`.rnc` fixture built from 22.8's artifact and `codegraph explore` returns named function, class and call nodes;
editing the fixture and re-indexing updates the affected nodes without a full-rescan regression; the load-failure path
is a located diagnostic, not a skip.

**Not done here.** No upstream issue or PR is opened by this entry; the request text above is what 22.10 (or an owner)
sends, so the wording is reviewed before it leaves the repository.

## Option 2 — separately maintained adapter (fallback)

**Shape.** A package on the editor side of the seam (G2) that loads 22.8's artifact through `web-tree-sitter`,
runs our own highlight/outline/import/call queries, and writes a CodeGraph-compatible graph increment into the
project's `.codegraph/` database — or exposes the same facts through a separate query surface if writing the database
is not supported.

**Constraints.** It may not import `core` or the runtime parser (G2/G7), it may not map RPGCode to TypeScript, and it
must not be on the player's critical path.

**Exit criteria (for 22.10).** The adapter answers the three navigation questions `docs/codegraph.md` benchmarked
(audio commands' owners, a script's calls, a booted board's composition), from the artifact alone, with named nodes;
provenance scan and `pnpm graph` stay clean; a failing grammar load degrades to "no RPGCode symbols" with a located
diagnostic.

**Cost.** It duplicates CodeGraph's extraction surface and must be maintained against CodeGraph's database schema,
which is why option 1 is preferred.

## Licence position

CodeGraph, web-tree-sitter and tree-sitter-wasms are development tools: they never enter a shipped dependency tree,
`core`'s allowlist or a runner bundle. If option 2 ever ships, its own dependencies are re-audited under G6 at that
point; nothing is added by this record.

## How 22.10 uses this

22.10's entry now depends on 22.12 (`after = [2, 8, 12]`), so its refinement starts from an accepted route rather than
from prose. If option 1 is accepted, 22.10 waits for the upstream release; if the owner prefers option 2, 22.10
delivers the adapter. Either way 22.3–22.8 are unaffected: the grammar library does not depend on CodeGraph.
