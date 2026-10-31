---
id: 1
type: story
title: "Reject unrepresentable actor and battle writer values"
tracker_id: "#640"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/640"
parent: epic-deferred-work
created: '2026-10-31'
status: 'built'
baseline_revision: 'e630c083ae0a5680d2931a9653a4854f60cd6d02'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
context: ["spec - docs/spec/formats/character.md, item.md, enemy.md and battle-data.md", "ledger - deferred-work.md lines 144-163"]
---

<frozen-after-approval>

## Intent

**Problem:** The actor and battle writers silently encode values their own readers refuse: a base or point list over the `i16` upper bound wraps, `i16` scalars wrap (a 40000-point base or `experienceIncrease: 40000` re-reads as a negative number), a stored `idleTime`/`speed` missing from the model is written as `0` instead of failing, and the battle writers check neither their `i16` fields nor their magic/minor.

**Approach:** Give the writer path one small validation module and use it to refuse what the reader would refuse, before any byte is produced: list bounds, `i16`/`i32` ranges, magic, and the documented minor ranges.

## Boundaries & Constraints

**Always:** Refuse with a located `FormatError` naming the field, the value and the documented range or magic; write nothing on refusal. Accept every model the reader accepts at the documented boundaries. Keep valid output byte-identical.

**Never:** Change reader behaviour, add a format extension, refactor the board or main-file writers, or infer a rule the docs do not state (AC5: if a range is undocumented, update the spec doc-first instead).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Base count at the bound | 32768 bases / 32768 points | Writes successfully | No error |
| Base count over the bound | 32769 bases or points | Refused | Located error naming the count and 32768 |
| Boundary scalars | `experienceIncrease: 32767`, `-32768` | Writes successfully | No error |
| Wrapped scalar | `experienceIncrease: 40000` | Refused | Located error naming the field and `-32768..32767` |
| Stored field absent | character minor 7 without `idleTime` or `speed` | Refused | Located error naming the field |
| Wrong magic | `enemy.magic = "RPGTLKIT CHAR"` | Refused | Located error naming expected magic |
| Unlisted minor | battle `.ste` minor 7, item minor 8 | Refused | Located error naming the accepted range |

</frozen-after-approval>

## Code Map

- `packages/core/src/formats/validate.ts` (new) — shared `checkI16`, `checkI32`, `checkMagic`, `checkMinor`, `checkListBound` and the `I16_MIN/I32_MAX/MAX_LIST_ENTRIES` constants, each returning `Result<never> | undefined` like `main-file/writer.ts:52-75`.
- `packages/core/src/formats/actor/model.ts:653-677` — `writeBound`/`writeBases` take a section and refuse an over-bound list; `writeBoundedStrings` (616-631) already shows the message shape.
- `packages/core/src/formats/actor/character.ts:693-706,795-810,930-935` — header magic/minor checks, `experienceIncrease` and `levelIncreases` `i16` checks, and `idleTime`/`speed` required at minor ≥ 7 (docs/spec/formats/character.md#layout rows 32-33).
- `packages/core/src/formats/actor/item.ts:576-590,710-720` — header checks, `writeWide` `i16` branch check, and `speed`/`idleTime` required at minor ≥ 5 (docs/spec/formats/item.md#layout).
- `packages/core/src/formats/actor/enemy.ts:196-212` — header magic and `ENEMY_BINARY_MINOR` check, `criticalOn`/`criticalBy` `i16` checks.
- `packages/core/src/formats/battle/{battle-background,special-move,status-effect}.ts` — header magic and `BATTLE_MIN_MINOR..BATTLE_MAX_MINOR` checks; `i16`/`i8` field checks on every stored scalar.
- `packages/core/test/format-actor.test.ts`, `packages/core/test/format-battle.test.ts` — the adversarial cases below, alongside the existing round-trip tests.
- Do not change `packages/core/src/formats/binary/writer.ts` (shared with every writer) or any reader.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/core/src/formats/validate.ts` — add the shared checks — every writer reports the same located shape.
- [ ] `packages/core/src/formats/actor/model.ts` — bound-check `writeBases` — closes the wrapping upper bound.
- [ ] `packages/core/src/formats/actor/character.ts` — header, scalar and required-field checks — closes three ledger cases.
- [ ] `packages/core/src/formats/actor/item.ts` — header, `writeWide` and required-field checks — same class as character.
- [ ] `packages/core/src/formats/actor/enemy.ts` — header and `criticalOn`/`criticalBy` checks.
- [ ] `packages/core/src/formats/battle/*.ts` — header and scalar checks — the ledger's battle case.
- [ ] `packages/core/test/format-actor.test.ts`, `format-battle.test.ts` — adversarial and boundary cases from the matrix.

**Acceptance Criteria:**
- Given 40000-point bases, when `writeCharacter` runs, then it returns `ok: false` and the message names the point count and 32768.
- Given `experienceIncrease: 40000`, when `writeCharacter` runs, then it returns `ok: false` naming the field and range.
- Given a minor-7 character model without `idleTime`, when `writeCharacter` runs, then it returns `ok: false` naming `idleTime`.
- Given `rounds: 40000` or `minor: 7`, when `writeStatusEffect` runs, then it returns `ok: false` rather than bytes the reader refuses.
- Given any boundary-valid model (32768 bases, `32767`/`-32768` scalars, documented magic and minor), when written and re-read, then the model round-trips and the bytes match the pre-change output.

## Verification

## Implementation Notes

Every refusal the ledger names is implemented and the whole scalar surface of the five writers is now checked, not just the fields the ledger happened to sample: header `major`, `i8`/`i16`/`i32` scalars, fixed one-byte lists and both `i16` list bounds. No spec page changed: every range and accepted minor is already stated (primitive widths, `UB+1` counts, character rows 32-33, item rows 26-27, each page's accepted minor set) and `docs/spec/formats/board.md` already rules that a writer refuses what the reader would refuse, so AC5's doc-first clause did not trigger. Readers are untouched and no production caller of these writers exists in the tree.

Two independent reviews found: (1) scalar coverage was incomplete in `writeEnemy`, `writeCharacter` and `writeItem` — fixed by checking every remaining scalar and fixed byte list, with tests naming each field; (2) the story's `32768`-base at-bound case was unasserted — added. The `idleTime` comment's stated reason was corrected (a stored `0` round-trips as `0`; the refusal exists because the field is stored at that minor).

## Review Triage Log

| Finding | Verdict | Action |
|---|---|---|
| `writeEnemy` guarded 3 of 11 scalars (`hp`/`smp`/`fp`/`dp`, `aiLevel`, `customAi`, rewards) | medium, real | Patched: `checkI32`/`checkI8` on each, with a test naming them |
| `writeCharacter`/`writeItem` left `maxLevel`, stats, `minExp`/`minLevel`, `hasSpecialMoves`, `levelUpType`/`sizeType`, item `sizeType` and fixed byte lists unchecked | medium, real | Patched: each checked; `writeFixedBytes` now checks every entry; test added |
| `32768`-base at-bound case unasserted | low, real | Patched: base-bound success and byte-identical round-trip asserted |
| `idleTime` refusal comment gave a wrong reason | low, real | Reworded |

**Commands:**
- `pnpm exec tsc -b` — expected: success.
- `node --test packages/core/test/format-actor.test.ts packages/core/test/format-actor-text.test.ts packages/core/test/format-battle.test.ts` — expected: all pass.
- `pnpm lint` — expected: success.
- `pnpm golden` — expected: unchanged goldens.
