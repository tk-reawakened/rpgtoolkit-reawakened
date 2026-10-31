---
title: "Track the CodeGraph third-party grammar registration prerequisite"
ticket: 12
status: built
---

## Intent

The epic requires the CodeGraph prerequisite to be tracked, not just described. This entry turns 22.2's blocker B-01
into a record with a written upstream request and an adapter fallback, each with pinned versions, the licence position
and exit criteria, so 22.10 is refined against a real prerequisite.

## Implementation Notes

- Deliverable: `discovery/codegraph-registration-prerequisite.md` — pinned facts (CodeGraph 1.6.2, web-tree-sitter
  0.25.10, tree-sitter-wasms 0.1.13, the fixed grammar map and the extension-only project config), option 1 (upstream
  `codegraph.json` `languages` entry plus a generic query-driven extractor) with a minimal first-reply surface, option
  2 (separately maintained adapter on the editor side of the seam) with its constraints, and exit criteria for both.
- The upstream request text is committed here and **not sent**: no upstream issue or PR is opened by this entry, so the
  wording is reviewed before it leaves the repository.
- Store change: 22.12 registered in `epic-rpgcode-grammar/tickets.toml` with `tracker_id = "#870"`, and 22.10's
  `after` becomes `[2, 8, 12]` so its refinement starts from an accepted route.

## Verification

- Docs and metadata only: no grammar, scanner, `.wasm`, dependency, config or CI file changes; nothing is shipped.
- `pnpm provenance` and `pnpm lint` were run on this branch; results are in the pull request.
- Read against the installed CodeGraph 1.6.2 and the 22.2 record: every pinned fact names its file:line source.

## Notes

- Neither option is chosen here; that is 22.10's refinement decision with the owner, and option 1 is recommended.
- 22.3–22.8 are unaffected: the grammar library does not depend on CodeGraph.
