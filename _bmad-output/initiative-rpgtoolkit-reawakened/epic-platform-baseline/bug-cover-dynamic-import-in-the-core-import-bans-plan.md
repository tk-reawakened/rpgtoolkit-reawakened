---
id: 16
type: bug
title: "Cover dynamic import in the core import bans"
tracker_id: "#898"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/898"
parent: epic-platform-baseline
created: '2026-10-31'
status: 'built'
baseline_revision: 'deaba38927e9d2b34946cc71f82e6a357053ecaa'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
context: []
---

## Intent

`no-restricted-imports` does not visit `ImportExpression`, so `await import("fflate")` and `await import("@tk-reawakened/synth")` in core passed lint and the graph check. Two `no-restricted-syntax` selectors now cover the same specifiers, with a fixture per case.

## Verification

- Failing before: with the config change stashed, `node --test packages/core/test/lint-rules.test.ts` fails on `core/fflate-dynamic.ts should trigger exactly no-restricted-syntax`.
- Passing after: the same command passes.
