# ADR 0011 — Independent tree-sitter grammar for RPGCode

* **Status:** Proposed; design only, implementation requires a later reviewed ticket
* **Date:** 2026-10-24
* **Issue:** #620; follows the Phase A execution census (#614)

## Context and goal

Game authors need incremental highlighting and outlines while editing RPGCode.
Code navigation also needs a structural view of RPGCode declarations and calls.
Plan one independently specified tree-sitter grammar, with a versioned `.wasm`
artifact usable by the browser `editor-ui` and a future CodeGraph extractor
adapter. Neither consumer becomes part of game execution.

The existing CodeGraph installation indexes TypeScript under `packages/` only.
It does not understand `.rnc` or `.prg`; mapping either extension to TypeScript
would produce misleading results. The normative source format is currently
[`.prg`](../spec/formats/rpgcode-program.md#text-form). `.rnc` is an intended
editor association in this proposal, not an approved new engine file format.

## Independence is the acceptance criterion

**Write the grammar and its test corpus from `docs/spec/`, never from
`packages/core/src/script/parse.ts`.** Do not translate the existing parser,
copy its rules, mine its AST fixtures, or use parser outputs as expected trees.
Agreement between two implementations derived from one parser proves nothing.
Legacy GPL source is also excluded by G7.

Every planned grammar rule and independently authored corpus case must cite a
normative spec anchor and rule id. Expected concrete syntax trees are reviewed
against the source case and spec before implementation output is considered.
A disagreement or spec gap is recorded and resolved in a doc-first change;
expected trees are not weakened to match either implementation. Later
comparison with the runtime parser can find disagreements, but cannot supply
this grammar's specification or oracle. No such comparison is implemented here.

## Grammar boundary and hazards

- **Case and token boundaries:** ASCII-only keyword/name folding (LEX-10),
  preserving string text; digit-leading identifiers versus numeric exponents
  (LEX-2); `!`/`$` sigils and adjacent `!=` (LEX-3). Do not lowercase the input.
- **Physical versus logical lines:** CR/LF source, newline/semicolon statement
  endings, standalone trailing `_` with optional `//` comment, and continued-line
  leading `*` versus a real comment (LEX-1/LEX-5). A block header can reach its
  brace on a following line (STX-1/STX-4). Incremental edits must restore the
  scanner's logical-line context correctly.
- **Comments and strings:** all documented line/block comment forms; single-line
  quoted strings without escapes (LEX-8). The source-loading boundary decodes
  Windows-1252 to UTF-8 for tree-sitter and preserves offset mappings for the
  editor; the grammar does not perform file I/O or decode compiled programs.
- **References:** `&` in parameter declarations and `return &lvalue` differs from
  bitwise AND in expressions (FUN-1/FUN-3, EXP-3). A leading `&` at a call site
  does not itself request by-reference binding. Do not invent syntax to resolve
  the spec's distinct parameter-position descriptions; record any remaining
  disagreement before the statements milestone is accepted.
- **Operators:** `~=` and the ruled adjacent `!=`; destructor `~Name` versus
  unary `~`; backtick versus power `^`; the spec's precedence and associativity,
  including left-associative power below unary minus (EXP-2/R-30).
  **Resolved wording discrepancy:** the initial request called backtick concatenation.
  The owner confirmed following the normative spec: backtick is XOR, and `+`
  provides string concatenation. No concatenation meaning is assigned to backtick.
- **Commands:** roughly 283 catalogue names are ordinary callable names, not
  hundreds of reserved grammar keywords. Parse a generic argument list; optional
  and variadic built-in parameters and dynamic plugin names belong to command
  metadata/semantic consumers. Do not confuse variadic built-ins with user
  function declarations, for which FUN-5 forbids variadics/default arguments.
- **Modules and objects:** literal/computed includes, qualified names, redirects,
  function/class declarations, lambdas, dictionaries and member access follow
  the documented syntax. Parsing records their structure; it does not load
  includes, apply redirects, resolve packages, or execute commands.

Assume an **external C scanner** is required, especially for logical-line state,
comment disambiguation and contextual lexical boundaries. Keep that scanner
small; use ordinary grammar rules/precedence wherever they suffice. All scanner
state must be bounded and completely serialized/deserialized for edits and
ambiguity recovery. Require forward progress, EOF handling and recovery tests;
zero-width-token loops are a release blocker. Scanner code remains outside core.

## Artifact and consumers

A future grammar package will contain authored grammar/scanner sources,
independently reviewed corpus cases, named CST nodes/fields, and highlight/outline
queries, with MIT or Apache-2.0 licensing. Pin the tree-sitter ABI/runtime versions
and produce a reproducible `.wasm` build including the scanner. Test the same
source corpus with the native test harness and the browser Wasm loader; pin UTF-8
byte ranges and the editor's UTF-16 position mapping, including non-ASCII text.

The editor consumes the tree for highlighting and declaration outlines, including
useful partial trees with `ERROR`/missing nodes during typing. The CodeGraph
consumer is a **contributed language**, not a Wasm file loaded at run time:
CodeGraph 1.6.2 has no third-party registration seam — `codegraph.json` maps an
extension onto a language it already ships — and accepts a language by adding it
to its repository, a vendored grammar `.wasm` plus a per-language extractor
(`src/extraction/languages/<lang>.ts`, the `grammars.ts` maps and the scan
allowlist in `src/types.ts`), attributed by a `docs/grammars/<lang>.md`
provenance record. The route and its cost are recorded in the
[registration prerequisite](../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-grammar/discovery/codegraph-registration-prerequisite.md).
Neither grammar nor extractor may import the runtime parser.

Two CST decisions this contract makes load-bearing, so they are reviewed here
rather than discovered later:

- **Base clauses.** Supertype extraction lives in CodeGraph's core walk, which
  recognises the child types `extends_clause`, `superclass`, `base_clause` and
  `extends_interfaces` and carries per-language branches where a language's
  clause packs several bases (Scala's `extends A[X] with B with C` needed one).
  A base-clause node that matches a recognised type is wired by the extractor
  alone; any other shape needs a CodeGraph-side branch. Pick one deliberately
  when the OOP milestone fixes the CST.
- **Includes.** An `#include` directive is an import node plus a resolve step,
  and the file→file resolve is language-gated in CodeGraph's resolver, so the
  grammar's directive node needs a matching extractor entry *and* a resolver
  branch. Naming the node after an existing import type is not enough on its
  own.

Silent thinness is the failure to avoid: a language whose nodes are wired but
whose relationships resolve to nothing produces a graph, not an error, and
nothing downstream reports the missing edges.

## Milestones and independent evidence

| Milestone | Scope | Spec-authored acceptance corpus |
|---|---|---|
| Lexical layer | Tokens, comments, strings, case, newlines and scanner state | LEX-1 to LEX-11: mixed-case names, exponent/identifier boundaries, sigils, continued comment/operator lines, unterminated strings; full parse versus edit/reparse equivalence |
| Statements | Required braces, control flow, labels, functions, references and recovery | STX-1 to STX-6, FUN-1/FUN-3/FUN-5: newline before brace, empty `for` parts, case-label variants, by-ref forms, invalid brace-less bodies and incomplete edits |
| Expressions | Explicit precedence, associativity, postfix/member/index/call and lambdas | EXP-2 to EXP-7, FUN-8: unary/power grouping, XOR versus concatenation, `~=`, adjacent `!=`, conditional/assignment grouping, nested postfix chains and lambda forms |
| Commands | Generic calls, arguments, legacy prefix within the documented dialect boundary | Built-in-command specification: omitted optional arguments, output lvalues, variadic built-ins, unknown plugin names, bare zero-argument call; syntax versus semantic arity is tested separately |
| Modules | Includes, qualified references, classes/structs, declarations and outlines | MOD-1 to MOD-4 and OOP syntax: include/directive variants, class bases/access labels, methods/destructors, namespaces and redirects represented without evaluation |

These are small newly authored cases derived from the cited rules, **not real
sample-game source** or the existing parser's fixtures. Each milestone requires
reviewed valid/invalid trees, recovery/edit tests and native/Wasm parity before
advancing. Semantic uncertainty blocks only the relevant grammar milestone.

## Non-goals and consequences

This is **not on the player's critical path and must never block it**. No VM,
compiler, scheduler, saved state, runner, hash, golden, or runtime public API is
changed. No grammar code, scanner, `.wasm`, extractor or dependency is added by
this ADR. A complete Toolkit 1/2 dialect grammar, semantic type/arity checking,
execution, package loading, refactoring and editor-host selection are deferred.
The TypeScript index remains useful independently of this proposal.

The extra implementation creates maintenance and versioning costs. Spec-cited
cases, independent review, versioned CST/query contracts and browser edit tests
limit drift; copying the runtime parser would defeat the purpose. Handwritten
regex highlighting remains a possible temporary editor fallback while the
independent grammar develops.

## Sources

- [Language lexical rules](../spec/engine/rpgcode-language.md#lexical-rules),
  [structure](../spec/engine/rpgcode-language.md#keywords-and-structure) and
  [expressions](../spec/engine/rpgcode-language.md#expressions)
- [Built-in commands](../spec/engine/rpgcode-functions.md#rpgcode-built-in-commands),
  [modules](../spec/engine/rpgcode-modules-and-objects.md#modules),
  [object syntax](../spec/engine/rpgcode-modules-and-objects.md#syntax-oop-1-oop-2-oop-3)
  and [dialects](../spec/engine/rpgcode-dialects.md#toolkit-2x)
- Tree-sitter: [external scanners](https://tree-sitter.github.io/tree-sitter/creating-parsers/4-external-scanners.html)
  and [native/Wasm builds](https://tree-sitter.github.io/tree-sitter/cli/build.html)
- CodeGraph: [configuration and language mappings](https://github.com/colbymchenry/codegraph#configuration)
