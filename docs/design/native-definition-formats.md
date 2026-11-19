# Native authoring: definition formats
**Status: first-pass design, not a contract.** This page inventories fields and relationships
for native YAML definition families. It approves no schema, extension, conversion policy
or one actor format. See the companion [format-set overview](native-authoring-format-set.md);
current specs remain authoritative.

## Current contract and direction

- [ADR 0005](../adr/0005-independent-product-v1-and-native-format.md) makes Reawakened
  its own product and keeps named legacy formats first-class editable. Its second
  amendment brings scene, tileset and asset-pack authoring forward; other native
  contracts remain deferred.
- [ADR 0019](../adr/0019-tkr-authoring-formats.md#amendment-2026-11-11-one-editor-two-files-the-common-stamp)
  retains direct legacy board editing. Opening or saving a board does not convert it.
  Broader native-first import/build needs an explicit cutover; this page does not
  change that rule or mandate imports for existing projects.
- The proposed [native document conventions](../spec/formats/native-contracts.md)
  describe stamps, path identity, closed contract fields and the single top-level
  `pluginData` dictionary. Plugin data belongs in the owning document, not a new file
  per plugin, and unknown blocks must survive under that page's preservation rules.
- Epic 27.7, [#1808](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1808),
  already owns actor-family pre-release contracts and its field ledger. It prefers
  composition where possible but has **not** chosen one universal actor document.
  Do not duplicate that ticket; see [story details](../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-native-data-contracts/tickets.toml)
  and [boundary research](../findings/native-data-boundaries/README.md).
- [Epic 29 consolidation](../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-character-authoring/discovery/authoring-family-consolidation.md)
  combines character, item/NPC and enemy editor experiences. It approves no new
  formats or runtime categories; move/status editors retain their existing owners.

Recommendations describe **what needs a home**, not exact YAML keys, contract count,
extensions or capabilities that do not yet exist.

## Identity, presentation and boundaries

A **definition** describes reusable characteristics; a **placed instance** refers to
one and adds scene-specific position, layer, conditions or overrides. A second placed
guard should not require copying its definition. Party membership, current HP and active
effect duration are **runtime state**, not definition edits.

Legacy [board placements](../spec/formats/board.md#items-placed-on-the-board-sprites)
store activation/multitask programs, conditions and position separately from the
[item definition](../spec/formats/item.md#board-items-vs-inventory-items). A native
split must preserve definition defaults and local overrides. Whether a native placement
refers to a future actor contract is unsettled; the current scene contract governs.

A game-visible name is not the editor's **Friendly name**. Item `itemName` is an
inventory name/script handle; character `name` and `nameVar` are game data. Native
definitions may also have author-facing names/descriptions. Editing those labels must
not rename handles, regenerate variable bindings or replace player-visible descriptions.
Scene-local elements own their own Friendly names/descriptions. Project organization
supplies at most one optional user group per asset within its category, not a name or ID.

## Definition family inventory

The examples identify legacy inputs only; they propose no native extension. Keep
references distinguishable from literal names and script variables. These are minimum
preservation targets, not completed field mappings.

### Character (`.tem` input)

[Character layout and defaults](../spec/formats/character.md) record:

- Game-visible name; explicit variable bindings (name, experience, health, max health,
  defence, fight, special power, level) and separate starting values. Never derive
  or regenerate variable names from labels.
- Portrait, directional walk/idle animations, timing, battle/custom stances and
  collision/activation polygons. Preserve order, units, old defaults/fallbacks; missing
  art is not an authored replacement.
- Special-move slots, files, experience/level/variable-value eligibility, menu label
  and enabled flag; accessory names and armor slots. Learning eligibility belongs
  to the character-to-move link, not the reusable move.
- Starting level, growth, level cap, stat increments/mode and level-up program;
  preserve documented arithmetic and unlock semantics, not just similar values.

Readable labels, descriptions and linked previews are natural enrichment. Precise
grouping of shared appearance, progression and combat parts belongs to #1808.

### Item, NPC and world object (`.itm` input)

An item can combine equipment, menu, board and battle capabilities; these are not
exclusive item/NPC buckets. NPC is a use of this legacy family, not a new file kind.
See [item layout](../spec/formats/item.md#layout) and [family design](../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-character-authoring/epic-character-authoring.md).

- Preserve `itemName`, game description, all four flags, allowed-character handles,
  prices and key-item flag, including inactive capability fields.
- Equipment retains slots, accessory name, stat bonuses and equip/remove programs.
  Menu and battle use retain separate signed HP/SMP effects and programs. Equipment
  eligibility is not a blanket restriction on menu targets.
- Board presence retains default continuous/activation programs, movement and idle
  animations/timing, named stances and collision/activation polygons. Preserve the
  shared held/battle animation relationship; do not split it without a reviewed map.
- Keep placement overrides and conditions in the scene, not the shared item.
  Activation can mean interaction, not necessarily inventory pickup.

Authoring can emphasize enabled capabilities while retaining disabled data. More
expressive composition remains a proposal, not a behavior change.

### Enemy (`.ene` input)

[Enemy layout](../spec/formats/enemy.md) includes game name; HP/SMP/FP/DP; escape and
critical-hit rules; moves, weaknesses and strengths; built-in AI level or AI program;
experience/gold rewards; win/run programs; battle and named custom stances. Keep the
strength list even though historical editor UI could not edit it. The documented
writer/reader custom-stance mismatch is an import issue: record what was read,
diagnose ambiguity and prove mapping rather than dropping pairs. Battle stances do not
imply board movement, directional sprites or polygons.

Native enrichment could expose tactics, presentation labels and linked moves without
inventing battle rules. Encounter tables/scripts refer to enemies; an enemy definition
is not an encounter instance or mutable combatant state.

### Special move (`.spc` input)

[Special-move data](../spec/formats/battle-data.md#special-move-spc) includes game
name/description, signed target HP and SMP effects, user SMP cost, program, menu and
battle availability, status-effect reference and animation. A reusable move is distinct
from character learning requirements and an enemy move list. Account for legacy
**zero-means-usable** flags and the editor checkbox discrepancy. Keep signed stored
values even where Reawakened runtime clamps results differently. Author-facing
description or per-user presentation is an opportunity, not a new combat rule.

### Status effect (`.ste` input)

[Status data](../spec/formats/battle-data.md#status-effect) includes game name,
duration in rounds, speed/slow/disable flags, periodic HP/SMP flags and signed amounts,
and per-round program flag/reference. The definition differs from an applied effect's
remaining duration and affected fighter. Preserve disabled flags and amounts; apply
the documented runtime clamp, never rewrite imported signed values. Friendly
descriptions may explain the effect but do not define its mechanics.

### Battle background (`.bkg` input)

[Battle-background data](../spec/formats/battle-data.md#fight-background-bkg) combines
image, music and four event sounds: selection, choice, ready and cannot-act. It is a
reusable battle presentation referenced by boards/scripts, not an enemy, battle state
or image file. A native definition could give it a Friendly name and description and
link its media; preserve each event's identity and reference.

## Files that are not definition YAML

Scripts remain external `.prg` files; images, audio and standalone media retain their
formats. Definitions refer to them; project organization holds presentation metadata.
Inline programs remain compatibility data, not filenames to discard. Their native
representation awaits contract design; paths, script strings and asset IDs differ.
A [save](../spec/formats/save-game.md) is runtime state/continuation, not an editable definition: Reawakened's canonical save is JSON and legacy save import is deferred.
A [distribution package](../spec/formats/packaging-and-paths.md#distribution-package-this-projects-own)
is a build artifact, not a YAML authoring asset. Existing package rules apply; this
does not claim future native kinds are excluded or a definition builder exists.

## Compatibility acceptance before contract or importer approval

1. **Field ledger:** For every supported version and documented field (including
   ignored, reserved, empty, disabled and version-specific), record destination,
   transformation/default, opaque preservation or justified loss/refusal, with
   evidence. A refused variant is not “migrated.”
2. **Preservation:** Import, edit an unrelated field, save and reopen nondefault and
   same-version unknown/residue data. Give opaque data a home or report/refuse loss;
   do not promise arbitrary binary round trips. Keep unknown plugin blocks byte-for-
   byte under native conventions. Capability toggles and absent plugins must not
   silently drop data.
3. **Identity/references:** Test duplicate/case-folded paths, separators, missing or
   ambiguous files and nested paths under applicable contracts. Preserve variable
   bindings, handles, stance names and other script-visible strings, not guessed IDs.
   Computed RPGCode references evade static literal searches; report unresolved cases
   instead of claiming complete dependency discovery or safe automatic rename.
4. **Slots/defaults:** Exercise sparse move/equipment/allowed-character slots, order,
   empty entries and old-version fallbacks. Distinguish stored board slots from runtime
   numbering: [R-06](../spec/formats/board.md#items-placed-on-the-board-sprites) keeps
   raw empty slots while hydration compacts them. Prove mappings against script-visible
   behavior; never assume all slot arrays can be compacted.
5. **Observed behavior:** Use authored character, NPC, equipment, combined-capability
   item, enemy, move, effect and background fixtures. Import, edit, save, reopen, build
   where supported and run; assert bindings, progression, placement overrides,
   move/AI/effect behavior and linked media events. Include negative amounts, disabled
   flags, old defaults, custom stances and strengths. Compare with Reawakened rules,
   marking known legacy differences. Source-only wiring tests are not acceptance.
6. **Limits/ownership:** Identify supported versions and missing evidence, authoritative
   editing source and protection of generated outputs before cutover. Test unavailable
   media/scripts and diagnostics. Validate eventual schema, editor and runtime paths on
   real hosts; this page claims none has shipped.

## Key source files

- [Character](../spec/formats/character.md), [item](../spec/formats/item.md) and [enemy](../spec/formats/enemy.md) layouts.
- [Battle definitions](../spec/formats/battle-data.md) and [board placements](../spec/formats/board.md).
- [Native contracts](../spec/formats/native-contracts.md) and [Epic 27 family ownership](../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-native-data-contracts/tickets.toml).
