---
type: discovery
title: "CodeGraph registration prerequisite (blocker B-01): upstream language contribution"
date: 2026-10-31
baseline_revision: de43ad735ee4e1014aa9ea67165fa76f61edf492
issue: "#870"
---

# CodeGraph registration prerequisite

Entry 22.2 proved that the Wasm artifact route works and that **registration** is the gap (blocker B-01 in
[`scanner-wasm-codegraph-routes.md`](scanner-wasm-codegraph-routes.md) F-05/F-06). The epic requires that
prerequisite to be tracked, not merely described. This record is that tracking artefact: the upstream contribution
route, the adapter rejected on the record, pinned versions, the licence position and exit criteria. **Nothing is
shipped by this entry**; no grammar, scanner, `.wasm`, dependency, config or CI file changes.

Correction (2026-10-31, entry 22.12). The runtime facts below were and remain accurate: CodeGraph 1.6.2 accepts no
third-party language at run time. What this record previously got wrong was the *option framing* — it presented the
only route as an unbounded "upstream capability request". CodeGraph's maintainers accept new languages by ordinary
contribution, on a path they have merged ten times in the last year, so the route is a bounded language PR rather
than a feature request. Option 1 is rewritten accordingly and Option 2 is recorded as not recommended.

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

Paths in this record are the repository's source paths (`src/…` on `main`); the installed 1.6.2 package ships the same
modules compiled under `lib/dist/…`, which is why the pinned rows above cite the built layout.

## Option 1 — upstream language contribution (preferred)

**What "registration" means upstream.** CodeGraph has no run-time seam for a language it does not ship: there is no
config key and no plugin hook (pinned facts, row *Registration surface*). It accepts new languages by **contribution**:
the language is added to the repository and the next package release contains it. `colbymchenry/codegraph` issue
[#648](https://github.com/colbymchenry/codegraph/issues/648) — "Tracking: language support requests, post-1.0
roadmap", **OPEN**, label `language-request`, **updated 2026-10-30** — says, verbatim:

> codegraph parses code with **tree-sitter**, so adding a language is mostly: wire a grammar `.wasm` + a small
> per-language extractor, then validate retrieval on real repos. There's an `/add-lang` workflow and a contributor
> cookbook (see #97 / `docs/ADDING-A-LANGUAGE.md`).

and closes with: "Contributions welcome — this is one of the easiest areas to land a PR." The issue also lists the
languages that already arrived this way (CFML, COBOL, VB.NET, Erlang, Solidity, CUDA, Terraform/OpenTofu, Nix, ArkTS,
…) and the requested ones, RPGCode's nearest neighbours (Shell, SQL, BrightScript, Fortran) among them.

**The cookbook is real, but not at the path #648 names.** `docs/ADDING-A-LANGUAGE.md` returns **404** on `main`
(checked 2026-10-31). The live checklist is `.claude/skills/add-lang/SKILL.md`, backed by `scripts/add-lang/`
(`check-grammar.mjs`, `dump-ast.mjs`, `verify-extraction.mjs`, `bench.sh`). Every path below is from that repository
at that date.

**What a language contribution touches.**

| File | Change |
|---|---|
| `src/types.ts` | `'rpgcode'` in the `LANGUAGES` const; `'**/*.prg'` in `DEFAULT_CONFIG.include` — the file-scan allowlist, without which `codegraph init` finds zero files |
| `src/extraction/grammars.ts` | `WASM_GRAMMAR_FILES`, `EXTENSION_MAP` (`.prg`, `.rnc`), `getLanguageDisplayName`, and `rpgcode` in `VENDORED_WASM_LANGS` |
| `src/extraction/languages/rpgcode.ts`, `…/index.ts` | the extractor: `functionTypes`, `classTypes`, `methodTypes`, `structTypes`, `importTypes`, `callTypes`, `variableTypes`, `nameField`, `bodyField`, `paramsField`, plus `extractImport`/`visitNode` hooks |
| `src/extraction/wasm/tree-sitter-rpgcode.wasm` | 22.8's artefact, vendored as-is (below) |
| `docs/grammars/tree-sitter-rpgcode.md` | provenance: upstream commit, patch (if any), build command, ABI, licence — the format of `docs/grammars/tree-sitter-cobol.md` |
| `__tests__/extraction.test.ts` | a detection assertion and an extraction block |
| `README.md`, `CHANGELOG.md` | one supported-language row and one `Unreleased` bullet |
| `src/resolution/import-resolver.ts` | **core**: the file→file branch that turns an `imports` reference into an edge is gated `language === 'c' \|\| 'cpp'`; RPGCode needs that branch or its own |
| `src/extraction/tree-sitter.ts` | **core, only if the CST does not match**: supertype extraction recognises only `extends_clause`, `superclass`, `base_clause` and `extends_interfaces` child types |

**The artefact fits the vendored pattern.** Our 22.8 build is ABI 15 with a C external scanner. CodeGraph's accepted
builds are ABI 14/15 (`check-grammar.mjs` rejects ABI 13, whose grammar corrupts the shared Wasm heap), and it already
vendors self-built and patched grammars: COBOL's scanner is the point of its patch, and Nix is "built from
nix-community/tree-sitter-nix … with tree-sitter-cli 0.25.10 (`generate` + `build --wasm`, ABI 15)". A grammar built
outside the repository is therefore the normal case, not an exception. The native kernel is optional: only
`dart`, `kotlin`, `lua`, `scala` and `swift` have one.

**The two relationships, honestly.** `#include` maps onto a shipped pattern: C's `preproc_include` is an
`importTypes` entry, and COBOL `COPY`, Erlang `-include` and Solidity imports all reach a file edge. What RPGCode
adds is the resolver branch above — an extractor alone produces the `import` node and the unresolved reference, and
then resolves to nothing. Implicit includes from `file.func(args)` add two more facts: the file edge (syntax gives
the qualifier, so an extractor `visitNode` hook can raise it) **and** the call binding, which MOD-2 defines as
"the object's member first, else that file's own definitions, else the ordinary order". CodeGraph resolves a call
against one symbol table by name; it has no per-file definition tables, so it can show the edge and cannot honour
the precedence. Class bases are not extractor-only either: the supertype walk is core code with per-language
branches (Scala's `extends A[X] with B with C` needed one).

**Two stages, not one.**

- **Stage 1 (the first PR).** Definitions, calls, explicit `#include` edges and class bases. Cost: one extractor module,
  one resolver branch, 22.8's wasm, a provenance doc, tests and the three-repo validation the cookbook requires
  (a PASS from `verify-extraction.mjs`, then a with/without agent A/B). For RPGCode the "real repos" are authored
  fixture games — say so in the PR body rather than letting a reviewer discover it.
- **Stage 2 (out of the first PR).** Implicit `file.func` includes and `file.func` binding, and any event-listener
  literal arguments. Both need language-specific resolution semantics CodeGraph does not have today, and a PR that
  promises them together is how a contribution stalls.

**Scala is the cautionary case.** Its node types were wired and it emitted classes, objects, methods and CALLS with
**no inheritance edges at all**, because `extends A with B` is a grammar production nothing had been taught to read,
and its imports resolved to nothing. The upstream guide's own words: "The failure is silent… nothing tells you the
graph is thinner than the code." That is why the two relationships above are costed separately from the node-type
mapping.

**Exit criteria (for 22.10).** A released CodeGraph version, pinned in `docs/codegraph.md`, indexes a spec-authored
fixture built from 22.8's artefact; `codegraph explore` returns named function, class, include and call nodes; editing
the fixture and re-indexing updates the affected nodes without a full-rescan regression; the load-failure path is a
located diagnostic, not a skip. Stage 2's absence is stated in the PR body and in `docs/codegraph.md`, not implied.

**If upstream declines.** Carry the same stage-1 patch in a fork pinned by commit in `docs/codegraph.md` and re-base
on each release. That is the same code, reviewable, and becomes the PR unchanged when upstream reconsiders — which is
why it is preferable to Option 2 even in the failure case.

**Not done here.** No upstream issue, comment or PR is opened by this entry, and none by the amendment that rewrote
it. Whether to send the contribution is the owner's decision.

## Option 2 — separately maintained adapter (not recommended)

**Shape.** A package on the editor side of the seam (G2) that loads 22.8's artefact through `web-tree-sitter`,
runs our own highlight/outline/import/call queries, and writes a CodeGraph-compatible graph increment into the
project's `.codegraph/` database — or exposes the same facts through a separate query surface if writing the database
is not supported.

**Constraints.** It may not import `core` or the runtime parser (G2/G7), it may not map RPGCode to TypeScript, and it
must not be on the player's critical path.

**Exit criteria (if it is ever chosen).** The adapter answers the three navigation questions `docs/codegraph.md`
benchmarked (audio commands' owners, a script's calls, a booted board's composition), from the artefact alone, with
named nodes; provenance scan and `pnpm graph` stay clean; a failing grammar load degrades to "no RPGCode symbols" with
a located diagnostic.

**Why not recommended.** The graph it would write is CodeGraph's own SQLite schema — private, undocumented and
versioned with every release (`packages/.codegraph/codegraph.db` is rebuilt by CodeGraph's binary, not ours). We would
own a reverse-engineering of that schema forever, for one consumer, with no upstream to fix it, while still writing
the same include/bases logic Option 1 needs in a place no reviewer of CodeGraph ever sees. Option 1 costs one patch
that upstream maintains with us; Option 2 costs a patch that only we maintain.

## Licence position

CodeGraph, web-tree-sitter and tree-sitter-wasms are development tools: they never enter a shipped dependency tree,
`core`'s allowlist or a runner bundle. Nothing is added by this record. If Option 2 ever ships, its own dependencies
are re-audited under G6 at that point.

A contributed language adds nothing to any tree we ship either. The vendored `.wasm` is **our own** build from our own
grammar repository, under MIT or Apache-2.0 per [ADR 0011](../../../../docs/adr/0011-tree-sitter-rpgcode.md) ("Artifact
and consumers"), and it lands upstream with a provenance document naming the upstream commit, the build command and
the ABI — the pattern `docs/grammars/tree-sitter-cobol.md` records. CodeGraph stays a development tool pinned in
`docs/codegraph.md`; no production dependency, lockfile entry or bundle changes.

## How 22.10 uses this

22.10's entry now depends on 22.12 (`after = [2, 8, 12]`), so its refinement starts from an accepted route rather than
from prose. If option 1 is accepted, 22.10 delivers stage 1 as a contribution to CodeGraph (or carries the identical
patch in a fork pinned by commit while the contribution is pending); if the owner prefers option 2, 22.10 delivers the
adapter and this record's rejection is overruled on the record, not silently. Either way 22.3–22.8 are unaffected: the
grammar library does not depend on CodeGraph.
