# Epic 23 inception proposal

## Scope
Promote only deferred entries with actionable, current evidence. Keep the ledger as intake. Do not reopen completed epics or convert unresolved behavior questions into implementation requirements.

## Initial entries

| Entry | Ledger source | Current disposition | Prerequisite / blocker |
|---|---|---|---|
| 23.1 | `deferred-work.md` lines 144–163 | Actor and battle writer boundary/range validation remains actionable; byte writers still expose unchecked numeric writes and `writeBases` stores bounds as `i16`. | Refine exact fields against `docs/spec/formats/character.md`, `item.md`, `enemy.md`, and `battle-data.md` before implementation. |
| 23.2 | `deferred-work.md` lines 170–175 | Negative-LUT refusal already has a regression test; run-overrun warning behavior still needs independent hard-coded byte coverage. | Keep scope to the missing overrun fixture and consumer-observable behavior. |
| 23.3 | `deferred-work.md` lines 196–203 | Board-entry clearing and no-board background are still owner decisions, not implementation bugs. | Human ruling and normative-spec edit precede implementation. |

## Not promoted in this seed

- The font-key concern (ledger line 206) was not accepted as current without a direct runtime recheck; revisit only if the consumer path still misses the bundled fonts.
- The hash-performance proposal (line 209) changes the save/hash contract and needs a separate state-owner decision.
- The inline-code board-thread concern (line 214) is explicitly an unrun inference with no sample; it remains intake-only.
- The §4.8 conversion rulings and converter work already have tickets in Epic 2; do not duplicate them.
- Old entries remain in the ledger until revalidated and resolved or promoted individually.

## Sequencing
The HITL rendering ruling is independent. The writer-hardening and pre-vector test entries are scoped as library work. Epic 23 is ordered after Epics 2, 3, and 4 for their normative format, VM, and rendering contracts; because Epic 23 is high-numbered, operators should intentionally run it before unrelated future epics when ready.
