# Authoring family consolidation — owner decision, 2026-11-16

## Decision and reason

Keep Epic 29 and expand it to character, NPC, item and enemy authoring. Original-editor screenshots and the owner's explanation establish that `.itm` serves NPCs/board objects as well as inventory uses. Shared appearance and navigation must be designed against all those tasks, while the format's independent equipment/menu/board/battle capabilities remain combinable.

The owner approved moving the existing unstarted item and enemy stories into this epic, then clarified: finish Epics 12 and 13 before getting into 29 and 30. This is planning and ownership work; implementation has not started.

| Previous ownership | Current ownership | Stable GitHub issue |
| --- | --- | --- |
| 12.6 item uses/equipment/pricing/placement | 29.7 item and NPC capabilities | #1722 |
| 13.9 enemy definition editor | 29.8 enemy combat behavior and rewards | #1734 |
| 29.1–29.6 character experience | Same IDs; 29.1/29.3/29.6 broaden to the family | #2962–#2967 |
| 12.4 / 12.5 delivered foundations | Remain in Epic 12 | #1715 / #1716 |
| 12.12 broad visits/run; 13.10 moves/status | Remain with their existing owners | #1723 / #1735 |

Retire slots 12.6 and 13.9 permanently. Old plan paths are navigation notes with no ticket frontmatter. There is exactly one active ticket and plan per issue; no replacement or duplicate issue is created. Keep the Epic 29 folder slug stable.

## Sequencing and acceptance transfer

Epic 29 has whole-epic gates on 12 and 13. Its children also retain precise provider dependencies for traceability. Neither earlier epic depends back on 29.

- 12.12 proves the broad visit/save/run path with the delivered item sprite definition and board-owned placement program, plus retained character/artwork providers. Full item behavior editing is accepted by 29.7 and the five-journey 29.6 proof.
- 12.14 proves every retained Epic 12 tool and the exact playable packaged output. Item behavior needed by that fixture is authored from normative docs and explicitly identified as fixture data, not UI-authored behavior. CAP-15's T-55 completion remains pending until 29.7/29.6.
- 13.10 depends on registration 13.1, battle formats 2.7 and settings/navigation support 11.6. Its former dependency on enemy UI 13.9 is replaced with authored enemy fixtures and the existing battle provider. It still proves actual move/status behavior, save/reopen and preservation.
- 13.18/13.19 sweep and accept retained Epic 13 tools. T-56 enemy-authoring coverage transfers to 29.8/29.6; battle use of moves, effects and backgrounds remains mandatory in 13.19 using authored enemies.
- 29.3 supplies shared appearance controls; 29.8 integrates the actual enemy document. The final 29.6 proof waits for 29.2–29.5, 29.7 and 29.8 and visits real move/status editors from 13.10.
- Epic 30 #2985 owns the connected board experience and consumes these definition editors. The owner's 12/13-first ordering applies to both 29 and 30; it does not require all of 29 before all of 30. Individual cross-epic consumers must name their actual providers.

No feature requirement disappears when an earlier epic closes. The capability spine and each affected acceptance plan record the transfer. Existing reader/writer preservation, actual-host proof, G7 documentation-first work and registered-command requirements remain binding.

## Evidence and limits

The scope audit checked live issues and merged PRs: 12.4 closed by #2319 and 12.5 by #2608; #1722 and #1734 were open draft work with no matching implementation PR found. The user's screenshots show the four item capability dialogs, shared directional sprites/bases and enemy combat-specific dialogs. They do not prove current Reawakened behavior or authorize copying legacy GPL source.

Normative behavior remains docs/editor-features.md T-50–T-56 and docs/spec/formats/{character,item,enemy}.md. This decision does not approve new formats, exclusive NPC/item categories, speculative combat rules, a universal Database or native-kind migrations.
