---
id: 10
type: bug
title: "Resolve font() substitution to an asset the project ships"
tracker_id: "#848"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/848"
parent: epic-deferred-work
created: '2026-10-31'
status: 'done'
baseline_revision: 'c8b7772f4d0c9d15fcd14f066dcaf16d1ca89d70'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
context: []
---

## Intent

`font(name)` stored `media/fonts/liberation-sans.ttf`, which no project ships, so the documented Liberation substitution silently fell back to the bitmap font. The engine now resolves the name against the asset index (exact path, then family, then substitution) and the built-in fallback keys name the bundled faces.

## Verification

- `node --test packages/core/test/render.test.ts`: 6 passed, including the new resolver cases (exact path, family match, Arial substitution, unknown family, empty name).
- `node --test packages/core/test/engine-bundled.test.ts`: 5 passed; the new engine case proves `font("Arial")` draws with the shipped Liberation face rather than the bitmap fallback.
- `pnpm typecheck`, `pnpm lint` passed. `pnpm golden` moved exactly one value, the `sample-start-basic` script hash, because the script state records `ui.font.asset` and it now names the bundled Liberation face instead of a path no project ships; it was re-recorded deliberately (G5) with that reason in the changelog. No pixel golden changed: that corpus host ships no Liberation file, so text still falls back to the bitmap font there.
