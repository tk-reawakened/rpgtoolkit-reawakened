---
title: "playergetpath and itemgetpath do not report the queue the original commands expose"
type: bugfix
ticket: '23'
created: '2026-11-21'
status: 'in-progress'
baseline_revision: 'd8cacf1c68cafd8ac0fbd8844a6916f0f0c71168'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'none'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/docs/guardrails.md'
  - '{project-root}/docs/spec/engine/rpgcode-functions.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `playergetpath` and `itemgetpath` require four arguments, return 1 or 0 for "the index exists", write zeroes when it does not, and treat index 0 as the first queued move instead of the step in progress. A script cannot read the queue that R-69 specifies, and the movement plugin is absent from the command-documentation gate, so its summaries drifted from the specification unnoticed.

**Approach:** Implement R-69 in the movement pack: accept exactly one or exactly four arguments, return the entry count including the active step from both forms, write `floor(value + 0.5)` whole pixels for the indexed entry, leave both variables untouched for a missing index, raise `arity.mismatch` for any other count, and report an unresolved handle as `player not found`. Count a copied waypoint once per cycle and ignore a linked one. Add the movement plugin to `tools/command-docs/check.mjs` and align every movement summary and group with its specification row.

## Boundaries & Constraints

**Always:** Keep the queue order of E-22/R-65; keep direction entries relative intent computed at call time; keep point entries absolute; preserve the existing movement phase and save shapes.

**Never:** Add a wait or a movement mutation to either form; introduce a new error class; change unrelated command behavior; touch the GPL source.

</frozen-after-approval>

## Verification

**Commands:**
- `node --test packages/core/test/movement-rulings.test.ts` — the new R-69 tests fail on the pre-change pack and pass after it; each added test runs under one second.
- `pnpm typecheck` and `pnpm lint` — no errors.
- `node tools/command-docs/check.mjs` after `pnpm build` — no diagnostics with the movement plugin registered.
- `pnpm command-docs:check`, `pnpm editor-ui-toolchain:check`, `pnpm bmad:tickets:test`, and the affected core suites.
- Perturbation: revert each guard (active-step index, half-up rounding, missing-index write, arity count, linked-waypoint exclusion, missing-handle report) and confirm the matching test fails.

## Implementation Notes

The movement pack now builds both commands from one factory. Exactly one or exactly four arguments are accepted; the shared arity check admits one to four because `ParamSpec` cannot express a discontinuous set, and the handler raises `arity.mismatch` for two or three with the message `"playergetpath" takes 1 or 4 argument(s), got N` (the count is also named for the item command). `queuedTargets` reports the active step's target, each FIFO entry's computed point, then a copied waypoint's remaining points for its current cycle; a linked waypoint contributes nothing, including when its own step is in progress (its active source is `waypoint-link`). Points are written as `Math.floor(value + 0.5)`. A missing index returns the count with no `out` entries, so `applyOut` leaves both variables untouched. A handle that names no live actor raises `builtin.bad-arg` with 3.1's `player not found` text.

`tools/command-docs/check.mjs` now registers the movement plugin beside the other documented plugins. Its command summaries were aligned with the native Purpose rows (32 rows), and item/input command groups were pointed at their native sections through a documented `docs(..., groups)` override. The script-cli `docs.json` dogfood baseline was re-recorded with its own command (`node packages/script-cli/dist/cli.js script docs --json`); the only moved entries are the 32 corrected movement summaries plus the two getpath rows. The quick-reference entries carry the summary and a Parameters line; the full and per-plugin entries also carry the R-69 behaviour text, the optional-parameter markers for `index`/`&x`/`&y`, and the `arity.mismatch`/`builtin.bad-arg` error entries. `pnpm help-content:generate` refreshed the editor "What's New" from the CHANGELOG.

## Perturbation Check

Each guard was reverted alone, the matching test re-run, and the source restored:

| Guard reverted | Test that failed |
|---|---|
| Active step added to the targets | `R-69 counts the step in progress and reports its target at index 0` |
| `Math.floor(value + 0.5)` for x | `R-69 writes the point rounded half up to whole pixels` |
| Missing index writes zeroes | `R-69 writes nothing for a negative or past-end index and leaves both variables alone` |
| Handler arity throw disabled | `R-69 rejects any argument count other than one or four with arity.mismatch` |
| Linked waypoint counted | `R-69 counts a copied waypoint in full once per cycle but not a linked one` |
| Missing-handle message changed | `R-69 reports 3.1's 'player not found' text for a handle that names no actor` |

## Verification Evidence

- `node --test packages/core/test/movement-rulings.test.ts` — 27 passed, 0 failed; every test under 10 ms. Against the pre-change pack the same file had 11 failing R-69 expectations.
- Affected core suites (movement, click/held movement, catalogue, command docs, errors, VM, environment table, plugin engine, legacy plugins) — 239 passed, 0 failed.
- `pnpm typecheck` and `pnpm lint` — clean.
- `pnpm command-docs:check` — clean with the movement plugin registered.
- `pnpm script:dogfood` — clean after the `docs.json` re-record.
- `pnpm golden`, `pnpm golden:bun`, `pnpm closing` — clean (closing used the sibling checkout's gitignored `fixtures/legacy` through a local symlink; 8/8 games matched).
- `node --test tools/fixtures/test/movement.test.mjs` — 20 passed, 0 failed.
- `pnpm editor-ui-toolchain:check`, `pnpm catalogue:check` — clean.
- `uv run .agents/skills/tkr-issue-preflight/scripts/resolve_issue.py "#3315" --check-stock --project-root .` — `ok: true`, `buildable: true`, plan joined by `ticket: 23`.
- `resolve_issue.py --validate-store` and `pnpm bmad:tickets:test` — clean (88 tests).

## Ambiguities

- The shared arity check rejects 0 and 5+ arguments with `takes 1 to 4 argument(s)` because the parameter schema is a contiguous range; calls with 2 or 3 reach the handler and report `takes 1 or 4`. Both are `arity.mismatch`. Expressing the discontinuous set in the schema would need an engine change.
- The generated reference marks `index`, `&x` and `&y` as optional because the schema cannot express "one argument, or all four". The specification row and the behaviour text state the exact rule.

## Review 1

Independent review found one real defect: the new handle resolver rejected the calling thread's `"source"`/`"target"` context handles (E-94/E-95) that the previous `itemId`/`playerId` resolution accepted. The resolver now shares `threadContextHandle`, which reads the calling thread's `source`/`target` slot (case-insensitive), and both `itemIdForThread` and the new `playerIdForThread` match that actor id against the command's candidates; `pathActor` reuses those paths. A handle that still names nothing keeps `builtin.bad-arg` with `player not found`. `itemIdForThread` now understands `"target"` as well as `"source"` for the other item built-ins.

- Fail-before: `R-69 accepts the calling thread's source and target context handles` failed on the previous commit with `ScriptError: player not found`; it passes after the fix.
- Perturbation for the restored resolution: pointing `threadContextHandle` at no thread (or reverting the resolver) fails the same test.

The recorded `docs.json` description was also corrected: its quick-reference entries hold the summary and Parameters line, while the full and per-plugin entries additionally hold the behaviour text, optional-parameter markers and error entries.
