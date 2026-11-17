---
type: feature
title: "Show what character progression settings produce"
ticket: 5
status: draft
tracker_id: "#2966"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2966"
---

# Show what character progression settings produce

## User outcome

An author can see how the configured character grows, understand the next experience requirement and resulting stats, and change the policy without guessing what the fields mean.

## Scope and dependencies

CAP-15/CAP-18 and T-54. Depends on 29.1, 29.2 and delivered actor progression provider 20.6 (#471). Existing normative progression rules override arithmetic assumptions in early UX research and original-editor labels.

## Acceptance criteria

1. Group the first-level experience requirement, subsequent threshold increase, growth mode, maximum level, four stat-growth values and level-up program with readable labels and units. Distinguish an additional threshold requirement from total accumulated experience.
2. Show a bounded level-range preview as a chart with an equivalent accessible numeric table, using the character's actual starting values. Document the preview range and provide a useful empty/disabled state. Do not allocate or loop up to an unchecked user maximum.
3. Percentage threshold growth uses `oldRequirement + truncate(oldRequirement * experienceIncrease / 100)`; fixed growth adds the increment directly. Percentage stat growth excludes equipment bonuses and truncates after the full calculation. Current HP/SMP are not automatically refilled. Reuse the appropriate public pure contract; do not maintain an independently drifting runtime formula in the view.
4. Respect maximum level and safe-integer validation, including the documented `maxLevel = 0` meaning: advancement disabled while awarded experience is still recorded. It must not be labeled unlimited. Negative, fractional, unsafe or otherwise invalid policies produce a located message, without partial changes or a misleading chart.
5. The preview is explicitly the configured default growth projection. If a level-up program or behavior can alter the result, explain that limitation beside it. Merely selecting or editing the character never executes project scripts; the preview must not claim those effects were simulated.
6. The level-up program uses the existing reference control and real navigation when its provider is available. #2609/29.6 own the connected-provider proof. Cancelling assignment or an invalid reference does not overwrite the accepted program value.
7. Changing settings updates the projection without mutating runtime state or dirtying the document for selection/range changes. Model edits remain undoable; save/reopen restores the values and the same default projection.

## Implementation boundaries

This is an explanation and authoring UI over existing behavior. Do not change level rules, format fields, hook precedence or zero/max semantics to make a smoother chart. If a reusable evaluation adapter needs extension, specify it under `docs/` before code and keep it within the existing architecture. Do not execute an engine per chart point when a bounded pure calculation suffices.

## Verification

Check percentage/fixed policies, fractional intermediate truncation, maximum level including zero, non-refill of current stats, overflow rejection and custom-program qualification against independently derived documented examples. Test representative boundaries rather than replaying all ticks or unbounded levels. Include an actual keyboard/table walkthrough and a chart capture with the fixture and inputs recorded.

## Sources

- `docs/editor-features.md`, T-54; `docs/spec/formats/character.md#layout`.
- `docs/spec/engine/progression-and-levels.md#threshold-and-level-up-behavior`, `#stat-changes-on-level-up`, `#legacy-precedence-and-level-up-programs`, `#maximum-level`.
- `docs/spec/engine/actors.md#progression`; ADR 0022; 29.1 experience contract.

## Completion record

Not implemented. Record the projection contract, independent examples, actual captures and executed checks when delivered.
