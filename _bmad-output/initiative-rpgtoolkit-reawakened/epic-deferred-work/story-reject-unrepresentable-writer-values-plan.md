---
id: 1
type: story
title: "Reject unrepresentable actor and battle writer values"
tracker_id: "#640"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/640"
parent: epic-deferred-work
status: draft
context: ["spec - docs/spec/formats/character.md, item.md, enemy.md and battle-data.md", "ledger - deferred-work.md lines 144-163"]
---

# Reject unrepresentable actor and battle writer values

## Goal
Make actor and battle writers refuse invalid models rather than silently truncating encoded values or writing files their readers reject.

## Acceptance
1. Actor base bounds and point counts that cannot fit the encoded `i16` bound are rejected with a located writer error.
2. Actor writer fields with documented minor-specific storage requirements are rejected when absent rather than silently written as zero.
3. Actor and battle scalar writers reject out-of-range values and invalid magic/minor combinations according to the normative format docs.
4. Valid boundary models retain byte-identical output; regression assertions use authored values and do not merely round-trip the same mistaken field order.
5. No format rule is inferred: if the docs do not state required values or accepted ranges, update the spec in a separate doc-first change and leave the code ticket blocked until then.

## Verification
Add adversarial writer tests for the specific cases from the ledger and boundary values; run the focused actor and battle format test suites, then the project gates.

## Exclusions
No reader behavior change, no generic writer abstraction, no unrequested format extensions.
