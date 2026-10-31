---
title: 'Rule the load-time contract for listeners whose package is missing'
type: 'chore'
ticket: 12
created: '2026-10-30'
status: blocked
blocked_reason: 'awaiting the owner review of the wording proposal recorded here'
baseline_revision: 'f58ef11a'
risk: 'low'
context: ['_bmad-output/initiative-rpgtoolkit-reawakened/epic-media-objects/discovery/epic-21-closure-audit.md']
---

## Question

Epic 21 Done-when 6 says a save whose listeners came from a package that is absent on load “loses its listeners
with a diagnostic, never a refused load”. Does that rule exist, should it exist, or is the criterion stale?

## Proposed ruling (pending owner review)

**Recommended wording** for Epic 21 Done-when 6, replacing the clause:

> Listeners live in script state, so a save loaded without the package that registered one still restores it: the
> listener keeps firing into its saved callable, whose method bodies are hydrated by the packages that are
> installed. A package whose methods a saved callable needs and that is absent on load contributes the core default
> plus one located diagnostic per hydrated name (OOP-12); the load itself is never refused for a missing package.

**Evidence.** `docs/spec/engine/rpgcode-modules-and-objects.md` EMIT-15 defines the saved `events.listeners` rows as
`{ id, emitter, type, once, callable }`, i.e. script-state callable records, not package references. OOP-12
(`rpgcode-modules-and-objects.md:376`) already rules the missing-package case for *method hydration* as “the core
default plus a diagnostic, never a refused load”. `packages/core/src/events/emitter.ts:128,151` filters listeners
by emitter key only (`off`, `forgetEmitter`), so nothing in the runtime drops a listener for a missing package, and
no diagnostic code for that case exists in `packages/core/src`. No test saves a state with a package-provided
listener and loads it without the package.

**Rejected alternative.** Keep the criterion as written and implement a listener-drop rule with a new diagnostic.
Reasons: it deletes working script state on load (a saved listener is data the game can still run), it contradicts
EMIT-15's saved shape and the owner's “saves hold data only, never callables from packages” position, and it opens a
`nextListener` migration question for no behavioural gain.

## Consequences

- If the wording option is accepted: `epic-media-objects.md` Done-when 6 is reworded, the audit record A-01 is
  updated, and one test is added to prove the behaviour (a save with a listener whose package is absent loads, the
  listener is still registered, and the load is not refused). No `docs/spec` change is needed: EMIT-15 already
  states it.
- If the implementation option is chosen: a follow-up ticket carries the save-migration question and the new
  diagnostic's code, location and test.

## Verification

Not applicable yet: this spike's deliverable is the ruling above. The evidence search is recorded in
`discovery/epic-21-closure-audit.md` (finding A-01) with the file:line anchors, and the epic's own tests for the
playback-data half of the criterion are named there.

## Blockers

Owner review of the proposed wording. No code, spec or test is changed until it is ruled.
