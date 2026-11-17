---
type: epic
title: "Make character authoring clear, visual, and connected"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-15", "CAP-18"]
after: []
assignee: ""
risk: medium
stepsCompleted: [scope-confirmed, requirements-mapped, stories-drafted]
inputDocuments: ["spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md", "architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md", "research-editor-ux-for-beginners/decisions.md", "research-editor-ux-for-beginners/engagement-area-map.md", "research-editor-ux-for-beginners/flows/04-characters-items-database.md", "ux-connected-editors/DESIGN.md", "ux-connected-editors/EXPERIENCE.md", "ux-connected-editors/connected-authoring-and-tests.md", "../../../docs/editor-features.md", "../../../docs/spec/formats/character.md", "../../../docs/spec/engine/progression-and-levels.md"]
tracker_id: "#2968"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2968"
---

# Make character authoring clear, visual, and connected

## Problem and outcome

The character editor exposes the required fields, but presents a large sprite configuration before character identity and starting stats. Script bindings compete with everyday authoring. An author has to understand the implementation's field groups before making a person for their game. #2959 records the concrete layout defect.

An author should open a character, recognize who they are editing, change its look and starting values, configure moves, equipment and growth, follow linked assets, then save and use the character in a game. The character stays recognizable throughout that workflow. Completion requires a demonstrated workflow and visual evidence, as well as correct persisted data.

Jensen approved this six-story epic on 2026-11-16 after reviewing the current editor, earlier BMAD party discussions, the TK Reawakened website, and screenshots of the original character editor. This is an experience rebuild over the existing document model, commands, undo and persistence. It does not reopen the completed field-coverage story 12.5 (#1716).

## Design direction

- Apply the accepted direction from the party discussions: RPG Maker's clarity, a flexible workspace, and direct visual editing where it helps the task.
- Bring the website's dark ink surfaces, warm gold emphasis, restrained framing and small radii into reusable editor styles. Keep active tools, selection, focus, validation and primary actions distinguishable. Maintain light themes and host high-contrast behavior.
- Give identity, portrait, starting values and the selected appearance a useful first view. Put advanced script bindings behind a clearly named section without discarding or changing them.
- Organize around Overview, Appearance, Moves, Equipment, Progression and Advanced as a starting design hypothesis. Story 29.1 validates the exact grouping, labels and navigation with real content; this epic does not prescribe a tab for every group.
- Prefer concise rows, lists and direct previews to a separate card for each field. A shape belongs beside the sprite it affects, and a growth setting belongs beside its resulting values.

## Requirements and ownership

These are scoped acceptance requirements under the existing capability and T-xx identifiers, not new globally numbered requirements. Each row has one primary delivery story; 29.6 verifies the combined journey.

| Existing requirement / source | Character outcome | Primary story |
| --- | --- | --- |
| CAP-15; EA-04/EA-06; SC-14/SC-15 | Character task-led navigation and hierarchy, consuming the shared language/components | 29.1 (shared contract/style owners: 11.22/11.23) |
| T-50 | Identity, profile and starting stats first; explicit advanced bindings | 29.2 |
| T-52; F-06 | Stance selection, animation, timing and collision/activation in context | 29.3 |
| T-51, T-53; F-07 | Understandable move eligibility, body slots and accessories | 29.4 |
| T-54; progression-and-levels.md | Understand growth through accurate results and clear units | 29.5 |
| CAP-15, CAP-18; ADR 0022 | Connected visits, persisted edits and real use in each shipped editor host | 29.6 |

All stories preserve supported character data, unknown same-version residue and explicit variable bindings. View navigation does not dirty the file or create another editable document. Use semantic controls, visible keyboard focus, meaningful accessible names, and responsive layout within a narrow editor pane. Shared components live in `editor-ui`; host I/O stays behind platform-services. ADR 0025 and ADR 0031 remain binding. Core determinism is not a requirement to rebuild browser layout, controls or scheduling.

## Delivery sequence

1. **29.1 (#2962) — Establish the character workspace and visual direction.** Review current task flows and land the navigation/layout foundation, reusable styles, representative previews and a `docs/` UX contract.
2. **29.2 (#2963) — Put character identity and starting stats first.** Deliver the everyday entry point and an explicit Advanced area; fix #2959 together with the navigation foundation.
3. **29.3 (#2964) — Edit appearance and animation in context.** Improve the shared sprite presentation without forking its behavior for characters.
4. **29.4 (#2965) — Make moves and equipment understandable.** Edit meaningful lists and unlock rules while preserving legacy slot identity and data.
5. **29.5 (#2966) — Show what progression settings produce.** Add a bounded, accurate growth preview with a readable numeric alternative.
6. **29.6 (#2967) — Prove the connected character-authoring workflow.** Verify navigation, save/reopen, undo, keyboard access and game use across hosts, using the delivered sections.

29.1 implementation consumes 11.22 (#2987) and 11.23 (#2988); research and contract drafting may proceed before delivery. 29.2–29.5 depend on 29.1. 29.5 also depends on 29.2 for the starting-value context. 29.6 depends on all four implemented sections. Existing providers are pinned in `tickets.toml`; no whole unfinished epic blocks the design work. All six stories start as draft, with no sprint assigned.

## Existing work and integration boundaries

| Existing work | Relationship |
| --- | --- |
| #2959 character hierarchy bug | Native sub-issue of this epic; implementation in 29.1/29.2 closes it only when the visible first-view defect is fixed. Planning does not close it. |
| PR #2950 compact controls, focused commands and shared Save | Open at planning time. Reuse its final shell/command contracts; do not recreate board tools or a competing Save system. Recheck its status before touching shared chrome. |
| #2703 initial visual styling; #2924 / PR #2932 Run action | Delivered foundations. Build on their current state; do not restore the old bottom Run panel from the supplied preview. |
| #1715 / #1716 shared sprite and character fields | Existing implementations to retain and reorganize, including commands, lifecycle and round-trip guarantees. |
| #1723 / story 12.12 connected editing | Owns broader cross-editor integration. 29.6 owns character-specific presentation, return context and acceptance; report its evidence to 12.12 rather than duplicating the broad provider work. |
| #2609 linked program / special-move providers | Existing integration defect remains its own issue. 29.6 must use the real provider, or name this as an unmet dependency; an unavailable button does not pass the connected acceptance. |
| #2652 VS Code pending-edit lifecycle | Existing lifecycle defect remains its own issue. Reproduce against the actual delivered state and reference its fix; this epic makes no claim to have fixed it by redesigning the view. |

## Done when

- At 1280×720 and in a 640px-wide editor pane, identity and starting values are discoverable without scrolling through stance configuration; navigation, labels and primary actions remain usable without whole-editor horizontal scrolling. Longer section content may scroll within its content area.
- An authored fixture covers nondefault bindings, profile, walk/idle/battle/custom stances, collision and activation, a conditionally available move, equipment/accessories, growth and a level-up program. Changing a display name never silently regenerates bindings.
- The walkthrough goes from character creation/opening through appearance, stats, moves/equipment and progression, follows a supported linked asset and returns, saves/reopens, assigns the character using the owning game/project controls and runs the game with it. Tests observe both stored data and the relevant game result.
- Real captures show the entry view and each section in light/dark themes; keyboard and high-contrast checks cover focus, selection, errors and the numeric alternative to drawing. Captures identify the commit, fixture, viewport, theme and host.
- The journey runs in web/PWA and actual VS Code. A shipped standalone editor using these components is also exercised; a player-only shell is not editor-host evidence. Missing providers or lifecycle failures remain explicit unmet acceptance, not hidden exclusions.
- Each implementation story passes its focused behavior checks and applicable repository gates. No runtime, format or golden changes are made merely to accommodate the UI. Existing data, undo and host save ownership remain intact.

## Scope boundaries and cross-editor handoff

Shared placement/action/component rules now belong to 11.22 (#2987), and common styling implementation to 11.23 (#2988). This epic consumes those patterns and demonstrates the character-specific composition. Other editor rebuilds can reuse the same semantic tokens, navigation conventions, reference actions, list/detail treatment and preview layouts. Each other editor still needs its own task walkthrough and acceptance. The user is discussing those editors in a separate fork; this epic does not claim their implementation.

A universal Database, new asset identifiers or formats, templates, batch editing, new traits, combat rules, whole-shell redesign and wholesale recreation of the legacy UI are outside this approval. Older research sometimes proposes these features. Its proposals are supporting material, not owner approval to implement them here. A character definition remains distinct from starting-party membership, board placement and runtime inventory.

## Sources and authority

- Owner conversation, 2026-11-16: six-story character-authoring epic approved; website styling and original-editor screenshots are visual/task references.
- Existing capability spine: `spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md`, CAP-15 and CAP-18. Architecture: AD-19 and AD-20, as amended by ADR 0022.
- Party record: `research-editor-ux-for-beginners/decisions.md`; accepted direction and scenarios in `engagement-area-map.md`, EA-04, EA-06, SC-14, SC-15, F-06 and F-07. Detailed `flows/04-characters-items-database.md` is a proposal where not accepted elsewhere.
- Connected workspace: `ux-connected-editors/DESIGN.md`, `EXPERIENCE.md`, `connected-authoring-and-tests.md`. Respect each document's recorded status; neutral implementation tokens are not a restriction against the newly requested brand treatment.
- Normative behavior: `docs/editor-features.md` T-50–T-54; `docs/spec/formats/character.md#layout`; `docs/spec/engine/progression-and-levels.md`; `docs/adr/0022-shared-editor-authoring-contracts.md`; `docs/guardrails.md`.
- Website reference: `/Users/jensen/projects/tk-reawakened-website/site/style.css`, inspected 2026-11-16. Background `#0d121d`, surface `#151e31`, line `#394661`, trim `#907a4c`, ink `#f2eee4`, muted `#b4bed0`, gold `#f4c85b`, red `#e06070`. These are reference colors to adapt through contrast-checked semantic tokens, not hard-coded values for every host.
- Current-layout evidence: #2959 cites `mount.ts`, `sprite-view.tsx` and `character-authoring-view.tsx` at main `2eaf991b966cbf528ab47514f20742e70ed40171`. Historical captures are not a fresh walkthrough. No legacy GPL source was consulted.

Input paths in frontmatter are initiative-relative unless they begin `../../../`, which is relative to this epic directory. Story 29.1 writes the resulting implementable experience contract under `docs/` before code, consistent with G7.


## Shared design language handoff, 2026-11-16

Jensen requested shared styling and a design language defining where things live and what actions do, using Epics 29/30 as the inputs. [The shared contract](https://github.com/tk-reawakened/rpgtoolkit-reawakened/blob/e0895a9af/docs/design/editor-design-language.md) owns those common conventions; 29.1 retains character-specific hierarchy, navigation and T-50–T-54 coverage. 11.22 (#2987) validates shared compositions/component states; 11.23 (#2988) implements common styles against current editor surfaces and does not depend on this redesign. Merge the shared planning prerequisite PR #2986 before building 29.1. This changes ownership/prerequisites, not approved character capabilities.
