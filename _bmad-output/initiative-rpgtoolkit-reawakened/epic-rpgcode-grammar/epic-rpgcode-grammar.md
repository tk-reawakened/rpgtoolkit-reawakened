---
type: epic
id: 22
title: "Independent RPGCode syntax for editor navigation and CodeGraph"
tracker_id: "#624"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/624"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-14", "CAP-15", "CAP-18"]
assignee: ""
risk: high
stepsCompleted: ["input-selection", "scope", "requirements", "story-backlog", "github-mirroring"]
inputDocuments: ["docs/adr/0011-tree-sitter-rpgcode.md", "docs/guardrails.md", "docs/editor-features.md", "docs/spec/engine/rpgcode-language.md", "docs/spec/engine/rpgcode-modules-and-objects.md", "docs/spec/engine/rpgcode-functions.md", "docs/spec/engine/rpgcode-dialects.md", "docs/spec/formats/rpgcode-program.md", "_bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md", "_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md"]
status: in-progress
---

# Epic 22: Independent RPGCode syntax for editor navigation and CodeGraph

## Outcome

Authors get incremental syntax colouring and declaration navigation while editing
RPGCode in the shared browser-capable editor. Developers can navigate symbols,
includes and call sites through CodeGraph. One independently authored grammar,
bounded C scanner and versioned Wasm/native artifact serve both consumers.

GitHub parent: [#624](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/624). Planning delivery:
[#636](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/636). ADR 0011 was proposed and merged in #623;
this backlog scopes its implementation without marking the ADR accepted or any
implementation complete.

## Inputs and interpretation

The owner requested this implementation epic on 2026-10-24 after the Phase C
design. ADR 0011 and the original grammar requirements define scope; docs/spec is
the normative syntax source. Existing initiative capability IDs are preserved:
CAP-14 tooling and CAP-15/CAP-18 shared editor features are contributions, not
claims that this epic delivers the entire LSP/DAP or editor capability. No new
global FR numbers or UX requirements are invented.

The project stores epic envelopes and `tickets.toml`, rather than a monolithic
`epics.md` or sprint-status file; this envelope contains the requirement coverage
and input selection. No customization file exists for create-epics-and-stories,
so the installed skill's default planning workflow is used with that convention.

## Boundaries and ownership

- This epic owns independent syntax, the spec-authored corpus, incremental C
  scanner, CST/query contract, Wasm/native release and two narrow integrations.
- Epic 10 retains semantic LSP diagnostics, hover/call tips, cross-file semantic
  resolution, formatting, quick fixes and DAP debugging. The grammar is not a
  replacement for the runtime parser or the LSP semantic authority.
- Epic 11 retains editor-model, editor-ui/program-editor foundations,
  platform-services, host-web and host-vscode. Task 22.9 integrates into those
  seams after they exist; it does not recreate them. Features land in editor-ui.
- Neither the runtime nor any player-facing epic depends on Epic 22. The existing
  TypeScript index remains usable independently. A missing grammar must leave
  text editing and test-run usable.
- No VM/compiler/scheduler/public core API, game format, saved state, state hash,
  generated command stub, PNG or golden/ledger change belongs here. No full
  Toolkit 1/2 grammar, type/arity engine, runtime execution or refactoring tool.

## Requirement coverage

These epic-local requirement labels preserve the global CAP IDs and assign each
deliverable a primary owner. Cross-cutting obligations apply to every task.

| Local requirement | Deliverable | Primary task |
|---|---|---|
| GR-1 | Spec gaps, independent rule/corpus ledger, file/dialect/range contracts | 22.1 |
| GR-2 | Licensed/pinned C/native/Wasm toolchain and evidenced CodeGraph route | 22.2 |
| GR-3 | Case, tokens, logical lines, comments, strings and incremental scanner | 22.3 |
| GR-4 | Statements, references, functions and error-handler forms | 22.4 |
| GR-5 | Spec precedence/associativity and postfix/object expressions | 22.5 |
| GR-6 | Generic command/optional/variadic syntax, separate from semantic arity | 22.6 |
| GR-7 | Includes, qualified names, redirects and class/struct declarations | 22.7 |
| GR-8 | Versioned reproducible native/Wasm and highlight/outline query contract | 22.8 |
| GR-9 | Shared editor highlighting and outlines in both browser-capable hosts | 22.9 |
| GR-10 | Actual CodeGraph registration/extraction and refresh | 22.10 |
| GR-11 | Integrated acceptance, provenance, docs and runtime isolation | 22.11 |

## Cross-cutting acceptance (all tasks)

1. **Independence:** derive grammar, scanner, queries and newly authored corpus
   from docs/spec, never `packages/core/src/script/parse.ts`, its outputs/AST
   fixtures, real games or legacy GPL source. Cite anchors/rule IDs. Review
   expected trees before implementation output; never weaken the oracle to agree.
2. **Incremental correctness:** complete bounded scanner serialization,
   deserialization, ambiguity/EOF/error recovery and forward progress. Compare
   full parses with edit/reparse, native with browser Wasm, and UTF-8 byte ranges
   with editor UTF-16 positions, including decoded Windows-1252 text.
3. **Grammar hazards:** ASCII folding without lowercasing strings; logical-line
   continuations/comments; by-ref declaration/return versus AND; ~= and !=;
   destructor versus unary ~; backtick XOR, + concatenation and left-associative
   power below unary minus. Commands are generic calls, not 283 reserved keywords.
4. **G1-G7:** tools outside core; permissive licences and pinned ABI/toolchains;
   no runtime dependency or golden/hash movement. A drift is a G5 stop, not a
   reason to re-record. No dependency/code change occurs in this planning PR.
5. **Useful partial trees:** malformed/incomplete input keeps surrounding
   declarations usable through ERROR/missing nodes. Consumers do not invent
   semantic resolution from syntax, especially computed includes/dynamic calls.

## Ordered implementation backlog

| Task | GitHub | Scope | Prerequisites |
|---|---|---|---|
| 22.1 | [#625](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/625) | Settle syntax gaps and define the independent corpus contract | None |
| 22.2 | [#626](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/626) | Prove the scanner, Wasm and CodeGraph integration routes | None |
| 22.3 | [#627](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/627) | Build the lexical layer and incremental external scanner | 22.1, 22.2 |
| 22.4 | [#628](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/628) | Parse statements, control flow and reference declarations | 22.3 |
| 22.5 | [#629](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/629) | Implement expression precedence, calls and object expressions | 22.4 |
| 22.6 | [#630](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/630) | Parse generic commands and their argument forms | 22.5 |
| 22.7 | [#631](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/631) | Parse modules, classes and declaration outlines | 22.6 |
| 22.8 | [#632](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/632) | Release the versioned grammar, Wasm artifact and query contract | 22.7 |
| 22.9 | [#633](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/633) | Integrate incremental highlighting and outlines in editor-ui | 22.8, Epic 11 |
| 22.10 | [#634](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/634) | Integrate RPGCode symbols, imports and calls with CodeGraph | 22.2, 22.8 |
| 22.11 | [#635](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/635) | Verify both consumers, provenance and runtime isolation | 22.9, 22.10 |

Each entry's `description`, `verify`, sources, risk and checkpoints are recorded
in `tickets.toml`; GitHub mirrors the full acceptance checklist as native
sub-issues and sibling dependencies. Every implementation task requires
refinement before starting. The implementation order is lexical → statements →
expressions → commands → modules; release and integrations follow.

## Scheduling and gates

All eleven implementation tasks and the epic are **Backlog: Todo, no Sprint**.
Only the planning delivery is assigned to the current sprint. No build start,
delivery date or estimated duration is promised. Task 22.1 and the independent
feasibility spike 22.2 are the first refinement candidates, regardless of numeric
epic order in an automated recommendation.

Task 22.1 may finish with separately tracked later-milestone blockers. An
unsettled lexical rule blocks 22.3; a statement/module gap blocks the relevant
milestone. No unrelated gap globally gates the grammar. Record these blockers as
real tracked dependencies before the affected task starts.

Task 22.2 must demonstrate the actual CodeGraph integration route; a Wasm artifact
alone is not registration. If the pinned tool lacks the required capability,
track the concrete upstream/adapter prerequisite and leave 22.10 blocked until
resolved. Do not call a feasibility report a completed extractor. That blocker
does not hold the editor or grammar library.

Task 22.9 depends on Epic 11 via `epic-editor-foundation`; the initiative declares
this dependency and no epic-wide frontmatter gate is added. The older Epic 11
envelope currently has no tracker ID; resolve its actual tracked seam ticket(s)
at 22.9 refinement rather than inventing their identity. No reverse dependency
is added to Epic 11, avoiding a cycle and allowing its existing program editor
to ship before this enhancement.

## Done when

All five grammar milestones have independently reviewed evidence; the versioned
release is consumed by both integrations; 22.11 records native/browser/edit,
editor-host and extraction acceptance and G1-G7 verification. Every child issue
is done, every concrete blocker is resolved, and runtime golden/closing checks
remain unchanged. A partial grammar or feasibility-only extractor is not done.

## References

- `docs/adr/0011-tree-sitter-rpgcode.md` (independence, hazards, milestones, consumers)
- `docs/spec/engine/rpgcode-language.md#lexical-rules`, `#keywords-and-structure`, `#expressions`
- `docs/spec/engine/rpgcode-errors-and-threads.md` (error-handling statement forms)
- `docs/spec/engine/rpgcode-functions.md#rpgcode-built-in-commands`
- `docs/spec/engine/rpgcode-modules-and-objects.md#modules`, `#syntax-oop-1-oop-2-oop-3`
- `docs/spec/formats/rpgcode-program.md#text-form`; `docs/editor-features.md` T-40
- Initiative spec CAP-14/CAP-15/CAP-18; architecture AD-19/AD-20/AD-21/AD-22
- Tree-sitter [scanner contract](https://tree-sitter.github.io/tree-sitter/creating-parsers/4-external-scanners.html)
  and [native/Wasm builds](https://tree-sitter.github.io/tree-sitter/cli/build.html),
  [CodeGraph](https://github.com/colbymchenry/codegraph), checked 2026-10-24;
  actual implementation versions/routes are deliberately a 22.2 evidence gate.
