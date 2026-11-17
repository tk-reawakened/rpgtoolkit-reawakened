---
type: epic
title: "Character, NPC, item and enemy authoring"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-15", "CAP-16", "CAP-18"]
after: ["epic-editor-assets-p0", "epic-editor-p1"]
assignee: ""
risk: high
stepsCompleted: [scope-confirmed, requirements-mapped, stories-drafted]
inputDocuments: ["spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md", "architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md", "research-editor-ux-for-beginners/decisions.md", "research-editor-ux-for-beginners/engagement-area-map.md", "research-editor-ux-for-beginners/flows/04-characters-items-database.md", "ux-connected-editors/DESIGN.md", "ux-connected-editors/EXPERIENCE.md", "ux-connected-editors/connected-authoring-and-tests.md", "../../../docs/editor-features.md", "../../../docs/spec/formats/character.md", "../../../docs/spec/formats/item.md", "../../../docs/spec/formats/enemy.md", "../../../docs/spec/formats/battle-data.md", "../../../docs/spec/engine/progression-and-levels.md"]
tracker_id: "#2968"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2968"
---

# Character, NPC, item and enemy authoring

## Problem and outcome

An author should recognize what they are editing, change its appearance and behavior, follow related assets, save and use the result in a game. Characters, board NPCs, inventory/equipment items and battle enemies need a coherent workspace with controls appropriate to each task.

The character editor already exposes its fields, but presents a large sprite configuration before identity and starting stats; #2959 records that visible defect. Full item behavior and enemy authoring remain unfinished. This epic combines the experience rebuild with those existing implementation stories, retaining the current models, registered commands, undo and persistence wherever delivered.

Jensen approved the original six character stories on 2026-11-16, then approved consolidating the related authoring family after reviewing original enemy/item screenshots. Item story 12.6 moves to **29.7, retaining #1722**; enemy story 13.9 moves to **29.8, retaining #1734**. Completed 12.4 (#1715) and 12.5 (#1716) remain in Epic 12. The internal folder slug stays stable. The [consolidation record](discovery/authoring-family-consolidation.md) is the ownership and sequencing source.

**Owner sequencing: finish Epics 12 and 13 before starting implementation in Epics 29 and 30.** This epic's frontmatter enforces both full-epic gates. Planning publication does not start implementation. No retained story in 12 or 13 waits for 29.

## Design direction

- Use the accepted direction from the party discussions: RPG Maker's clarity, a flexible workspace and direct visual editing where it helps the task.
- Apply the website's dark ink surfaces, warm gold emphasis, restrained framing and small radii through reusable semantic styles. Maintain light themes, host high contrast, visible focus and validation cues.
- Validate one shared design against five examples: a party character, a board NPC, equipment, an item usable from menus/battles, and a battle enemy. Sparse and populated cases matter. Historical screenshots are task references, not current implementation evidence.
- `.itm` serves both inventory roles and board entities, including NPCs. Equipment, menu, board and battle capabilities remain independent and combinable. Lead with enabled behavior; keep other capabilities discoverable. Do not infer an exclusive type from a name, silently clear inactive fields, or introduce a new format or runtime category.
- Identity, appearance, reference actions, meaningful lists and selected details share conventions. Character growth, item capabilities and enemy tactics/rewards retain their distinct meanings. Overview, Appearance, Moves, Equipment, Progression and Advanced are a character starting hypothesis; 29.1 settles task-appropriate groups across the family.
- Keep the chosen stance beside its preview and assignment. Timing and collision/activation geometry appear only where the format supports them. Enemy battle stances do not imply directional movement or board polygons.
- Prefer concise rows and direct previews to a card per field. Present script actions with game-author language and documented technical behavior. For an NPC, explain activation/interaction rather than implying that every board action picks up an inventory object.

## Requirements and ownership

These refine existing capability and T-xx identifiers. Each row has one primary delivery owner; 29.6 verifies the union.

| Source | Outcome | Owner |
| --- | --- | --- |
| CAP-15/CAP-16/CAP-18; EA-04/EA-06 | Shared task navigation and visual language validated against five representative uses | 29.1 |
| T-50 | Character identity, profile, starting stats and explicit advanced bindings | 29.2 |
| T-52 and T-56 graphics subset | Shared stance/detail/preview presentation, with format-specific timing and geometry | 29.3; real enemy adapter in 29.8 |
| T-51/T-53 | Character moves and actual OR-based unlock rules, body slots and accessories | 29.4 |
| T-54 | Accurate bounded growth results with readable numeric alternative | 29.5 |
| T-55 | Item/NPC identity, combinable capabilities, prices, key flag, eligibility and placement scope | 29.7 (#1722) |
| T-56 | Enemy stats, stances, moves/resistances, tactics, escape/critical rules, rewards and encounter visit | 29.8 (#1734) |
| CAP-15/CAP-16/CAP-18; ADR 0022 | Connected visits, saved values and real game use across shipped editor hosts | 29.6 |

Every story preserves supported data, same-version unknown residue and explicit bindings. Navigation is view state and does not create another editable document or dirty a file. Host I/O goes through platform-services; shared UI belongs in editor-ui. ADR 0025 and ADR 0031 apply. Browser layout, controls and UI scheduling are not subject to core-only determinism restrictions.

**Every user-triggered editor action is registered in CommandRegistry and discoverable in the command palette.** Buttons, menus, context menus and shortcuts dispatch the same command; no private action implementation lives in a control. Apply the owner's 2026-11-16 rule across navigation, reference actions, preview controls and edits, preserving model/undo ownership.

## Delivery sequence

After the two epic gates:

1. **29.1 (#2962): Establish the shared authoring workspace and visual direction.** Document the five workflows and land the common presentation foundation.
2. **29.2 (#2963): Put character identity and starting stats first.** Fix #2959 and retain explicit bindings.
3. **29.3 (#2964): Edit appearance and animation in context.** Deliver reusable selection/preview controls and the existing character/item integration; test the enemy subset with an authored contract fixture.
4. **29.4 (#2965): Make character moves and equipment understandable.** Preserve slot identity and all unlock data.
5. **29.5 (#2966): Show what character progression settings produce.** Use documented arithmetic and starting values.
6. **29.7 (#1722): Author items and NPCs with combinable capabilities.** Complete the moved T-55 functionality in the shared workspace.
7. **29.8 (#1734): Author enemy combat behavior and rewards.** Complete the moved T-56 functionality and real enemy integration of 29.3.
8. **29.6 (#2967): Prove connected character item and enemy authoring.** Final five-journey acceptance, after 29.2–29.5, 29.7 and 29.8 and the real linked providers.

Existing story numbers 29.1–29.6 do not change. New local numbers follow the highest used ID; numeric order does not override the explicit dependency graph. All eight stories remain draft backlog with no sprint.

## Existing work and integration boundaries

| Existing owner | Relationship |
| --- | --- |
| 12.4 / #1715 and 12.5 / #1716 | Delivered sprite and character field foundations; preserve implementations and round-trip contracts. |
| 12.11 / #1721 | Owns board object placement and local overrides; 29.7 edits the shared item definition and returns to that placement. |
| 12.12 / #1723 | Delivers broad connected visit/run services using retained P0 editors before 29. The final definition-family acceptance consumes those services. |
| 13.1 / #1727 | Supplies the existing feature-registration seam before enemy authoring. |
| 13.10 / #1735 | Keeps move/status editors in Epic 13; prove them with authored enemy fixtures without requiring the later enemy UI. 29.6 visits the real providers. |
| Epic 30 / #2985 | Owns the board canvas, inspector and placement-origin experience. It consumes shared definitions owned here; no duplicated item/enemy property panels. Owner order is 12/13 before 29/30. |
| #2609 and #2652 | Existing linked-provider and pending-edit lifecycle defects retain their own owners. Recheck actual fixes; unavailable navigation or failed persistence remains unmet acceptance. |
| PR #2950; #2703; #2924 / PR #2932 | Reuse the delivered shell styling, focused commands, shared Save and Run contracts; recheck current status before touching chrome. |

Epic 12's retained acceptance still proves a playable package and item sprite/placement flows. Full T-55 authoring is accepted in 29.7/29.6. Epic 13's retained acceptance still proves artwork and move/status/background tools against actual runtime providers with authored enemy fixtures. Full T-56 authoring is accepted in 29.8/29.6. Those earlier epic closures alone cannot claim the moved CAP-15/CAP-16 coverage complete.

## Done when

- At 1280×720 and in a 640px-wide pane, each example's identity and primary task controls are discoverable; no whole-editor horizontal scrolling is needed. Long section content may scroll.
- Character evidence covers nondefault bindings, profile, walk/idle/battle/custom stances, bases, move unlocks, equipment and growth. Renaming never regenerates explicit bindings.
- Item evidence covers an NPC with board scripts and placement overrides, equipment with eligibility and bonuses, and a usable item with distinct menu/battle effects. A combined-capability fixture proves these roles remain independent and stored inactive values survive toggling.
- Enemy evidence covers battle/custom stances, stats, moves/weaknesses/strengths, AI or program, escape and critical fields, rewards and the actual encounter-pool visit, respecting the chosen battle provider's supported semantics.
- Every journey edits, undoes/redoes, visits a real linked provider and returns, saves, closes and reopens. Observe the saved values and the corresponding game behavior using repeatable authored fixtures.
- Run the journeys in web/PWA and actual VS Code, plus every shipped standalone editor using this UI. A player-only shell or component harness is not host acceptance. Missing providers remain explicit unmet criteria.
- Actual captures identify commit, fixture, host/version, viewport and theme. Keyboard, high-contrast, focus-return, validation and numeric geometry checks accompany light/dark captures.
- Focused behavior checks and applicable repository gates pass. No runtime, format or golden change is made merely to fit the layout. Every discovered defect is tracked separately.

## Scope boundaries

This epic owns the related definition editors and their shared experience. Board placement, party membership, runtime inventory, generic art/animation editing and move/status definitions retain their existing owners.

A universal Database, new asset IDs or formats, automatic NPC classification, templates, batch editing, new traits or combat rules, whole-shell redesign and wholesale copying of legacy UI are outside this approval. Existing research proposals and future native-kind decisions are not silently promoted into implementation requirements here.

## Sources and authority

- Owner conversation, 2026-11-16: original six character stories, subsequent family consolidation, retained issue identities and explicit 12/13-before-29/30 sequencing.
- Capability spine: CAP-15/CAP-16/CAP-18. Architecture AD-19/AD-20 as amended by ADR 0022; ADR 0025/0031; owner registered-command rule of 2026-11-16.
- Party inputs: research-editor-ux-for-beginners/decisions.md and engagement-area-map.md (EA-04/EA-06); flow 04 remains a proposal where not separately accepted. Connected workspace DESIGN.md, EXPERIENCE.md and connected-authoring-and-tests.md retain their recorded authority.
- Normative behavior: `docs/editor-features.md` T-50–T-56; `docs/spec/formats/character.md#layout`; `docs/spec/formats/item.md#layout`; `docs/spec/formats/item.md#board-items-vs-inventory-items`; `docs/spec/formats/enemy.md#layout`; `docs/spec/formats/battle-data.md`; `docs/spec/engine/progression-and-levels.md`; `docs/spec/engine/plugins-and-battle.md`; `docs/guardrails.md`.
- Website reference: /Users/jensen/projects/tk-reawakened-website/site/style.css, inspected 2026-11-16. Background #0d121d, surface #151e31, line #394661, trim #907a4c, ink #f2eee4, muted #b4bed0, gold #f4c85b, red #e06070 are reference colors adapted through contrast-checked semantic tokens.
- Current-layout defect #2959 cites main 2eaf991b966cbf528ab47514f20742e70ed40171. Scope audit also checked main 684f4e01b5e9aa13cbba61a969820d717c2377f1: item currently mounts shared SpriteView; character adds CharacterAuthoringView. No legacy GPL source was consulted.

Input paths in frontmatter are initiative-relative except ../../../ paths, which are relative to this folder. Story 29.1 writes the implementable experience contract under docs/ before code, consistent with G7.
