---
title: "Prove the scanner, Wasm and CodeGraph integration routes"
ticket: 2
status: done
---
## Intent

Entry 22.2 answers one question before any grammar work starts: can an independently authored tree-sitter grammar
with a bounded C external scanner be built reproducibly, loaded as Wasm by a browser consumer, and consumed by
CodeGraph — and if not, exactly what blocks it? The deliverable is the evidence record
[`discovery/scanner-wasm-codegraph-routes.md`](discovery/scanner-wasm-codegraph-routes.md), written for review
before 22.3 onward spends anything.

## Implementation Notes

- The proof is deliberately outside the repository: a toy newline/continuation grammar with a one-byte-serialized
  C scanner, built natively (Apple clang 21.0.0) and to Wasm (tree-sitter CLI 0.25.10 + Emscripten 6.0.13), then
  loaded in Node and in headless Chromium with web-tree-sitter. Nothing from it is committed, and no workspace
  manifest, lockfile, allowlist or CI job changes.
- Recorded versions and licences (all permissive) are in F-01; the ABI contract is `LANGUAGE_VERSION 15` **only**
  when a `tree-sitter.json` exists (the CLI silently emits 14 without it) — a manifest is therefore mandatory for
  the real package.
- CodeGraph 1.6.2 loads its grammars from a fixed filename map through web-tree-sitter 0.25.10, and its
  `codegraph.json` can only map a custom extension onto an already supported language. The ABI-15 smoke artifact
  does load under CodeGraph's own runtime, so the blocker is registration and extraction (F-05), not the artifact
  (F-04). F-06 records blocker B-01 with three options, owners (entry 22.10 with the epic reviewer) and exit
  criteria; F-07 records the proposed package location, artifact ownership and consumer handoffs.
- G7: the smoke grammar derives from nothing — not `docs/spec`, not the runtime parser, not legacy source. The
  runtime parser was not opened.

## Verification

Executed on the baseline revision, macOS arm64:

- `tree-sitter generate` (ABI 15), `tree-sitter build` and `tree-sitter parse` on a 3-line sample: the tree contains
  the scanner-only `continuation` nodes, so the external scanner runs natively.
- `tree-sitter build --wasm`: 1,935-byte artifact; loaded with web-tree-sitter 0.27.1 in Node 26.13.0 (byte ranges
  0-7, 7-14, 14-21) and in a headless Chromium tab served over `http://127.0.0.1:8817/` — identical tree, `abi: 15`.
- The same artifact loaded under web-tree-sitter **0.25.10**, the runtime bundled in CodeGraph 1.6.2 — identical
  tree, so ABI compatibility with the target consumer is proven.
- CodeGraph probe in a throwaway project with `.prg`/`.rnc` fixtures: `.rnc` → `rpgcode` is rejected (“not a
  supported language”, located warning); `.prg` → `typescript` indexes one file with no symbols. Both outputs are
  quoted verbatim in F-05.
- Repository checks on this branch (docs-only change, observed): `pnpm provenance` scanned 712 files with 0
  violations; `pnpm lint` green (`check-core-deps`: 2 core runtime dependencies match the allowlist);
  `pnpm graph` reported no dependency violations (513 modules, 2608 dependencies); `pnpm catalogue:check` matched;
  `pnpm command-docs:check` exited 0. No workspace manifest, lockfile, allowlist, test, golden or CI file changed.

## Blockers

- **B-01** — CodeGraph 1.6.2 has no supported seam for a third-party grammar or extractor. No integration is
  claimed; the three recorded options and their exit criteria are for the reviewer, and none of them holds 22.3
  onward.

## Proposed rulings

None. This entry records evidence and a proposal for review; it changes no `docs/spec` text, asserts no owner
approval and does not mark ADR 0011 accepted.

## Merged

PR #841 merged by squash as `5f076e708bdf833dcba4d684305eb8665c210134` (in `origin/main`); the evidence record is at
`discovery/scanner-wasm-codegraph-routes.md`. The issue is closed by this metadata change because its deliverable is
that record; blocker B-01 and its three options remain open for entry 22.10 and do not hold 22.3 onward.
