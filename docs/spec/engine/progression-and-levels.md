# Experience, rewards, and level progression

This page describes how enemy rewards, player character data, RPGCode, level-ups, and special-move availability fit together. It is an implementation-neutral compatibility contract; the actor model and behaviour rules are in [actors.md](actors.md).

## Sources of progression data

Progression is split across two asset types:

- A player character file (`.tem`, under `Chrs\`) defines starting stats and level-progression fields. See [the character format](../formats/character.md).
- An enemy file (`.ene`, under `Enemy\`) defines the reward for defeating that enemy. Its `exp` field is the integer experience reward and its `gp` field is the gold reward. See [the enemy format](../formats/enemy.md).

The character file names the RPGCode variables that hold experience, level, HP, max HP, DP, FP, SMP, and max SMP. The actor model owns the corresponding runtime stats; legacy variable names are live aliases to that owner.

## Awarding experience

A normal battle accumulates the `exp` value of each defeated enemy. The reward is issued only after the battle has been won; reaching zero HP is not itself an XP transaction.

```text
battle victory
  → sum defeated enemies' .ene exp fields
  → give the total to each eligible party member
  → run each actor's level-threshold check
```

A successful flee gives no experience or gold. A defeat follows the game-over path and gives no victory reward.

Experience can also be awarded outside battle with:

```rpgcode
giveExp(handle, amount)
```

This uses the same actor progression path as a battle reward, so quests, story events, and other RPGCode systems can grant XP without creating a battle.

## Threshold and level-up behavior

The actor stores total experience and mutable progress toward the next level. When an amount is awarded:

1. Add the amount to total experience.
2. Subtract the amount from the remaining requirement for the next level.
3. While the remaining requirement is zero or negative, perform a level-up and carry the negative remainder into the next requirement.

A sufficiently large award can therefore produce multiple level-ups in one operation; excess XP is not discarded.

The legacy fields have distinct roles:

- `levelType` is the initial XP requirement for the first level-up.
- `experienceIncrease` is the parameter used to derive later requirements.
- `levelUpType` selects the percentage-labelled or direct/fixed compatibility branch.

For later thresholds:

```text
levelUpType = 0:
  growth = truncate(oldRequirement * experienceIncrease / 100)
  nextRequirement = oldRequirement + growth

levelUpType = 1:
  nextRequirement = oldRequirement + experienceIncrease
```

Truncation happens after the multiplication and division. The calculation MUST NOT truncate `experienceIncrease / 100` before multiplying by the old requirement. This preserves percentage values below 100 as fractional growth that may truncate only after the full calculation. Progression fields and awards are safe integers. `levelUpType` MUST be `0` or `1`; a non-max-level actor MUST have a positive integer `nextRequirement` and a non-negative integer `remainingExperience`; and `maxLevel` MUST be a non-negative integer. An invalid award or policy is rejected without mutating the actor. A non-negative award is recorded even when the actor is already at `maxLevel`; no further level or stat changes occur there. Percentage growth and percentage stat increases truncate toward zero only after the full multiplication and division.

`maxLevel = 0` disables level advancement while still recording awarded experience. Configured stat-growth values (`levelHp`, `levelDp`, `levelFp`, and `levelSm`) MUST be non-negative safe integers. A malformed threshold or growth policy is rejected before any actor field is changed.
All policy, threshold, level, experience, award, and resulting stat values are safe integers at the actor creation, hydration, hook, and restore boundaries. The percentage product and every threshold/stat addition MUST be checked before committing; a non-safe intermediate or result is an error, not a rounded or partially applied value. `levelUpType` values outside `0` and `1`, negative `levelType`/`experienceIncrease`/growth values, fractional or unsafe values, and a non-positive active threshold are invalid. `maxLevel = 0` has no active threshold requirement.

The legacy ecosystem contains different arithmetic expectations in live advancement and restoration. The compatibility boundary keeps the field meanings above explicit; the Reawakened runtime uses the deterministic contract above for new evaluation and records any legacy restoration conversion during import rather than silently mixing formulas.

## Stat changes on level-up

A level-up increments the actor's level unless it is already at or above `maxLevel`. The default result increases:

- maximum HP;
- DP;
- FP; and
- maximum SMP.

The default level-up does not directly refill current HP or current SMP.

`levelUpType = 0` applies the configured `levelHp`, `levelDp`, `levelFp`, and `levelSm` values as percentage growth. The corresponding equipment bonus is excluded from the percentage base. The result is converted to an integer after the calculation.

`levelUpType = 1` applies those configured values as fixed points. Equipment bonuses remain separate from intrinsic progression and are not compounded by percentage growth.

### Legacy precedence and level-up programs

In legacy Toolkit 3.1 (and the final source; [facts-round-12.md](../../provenance/facts-round-12.md) §4, [facts-round-11.md](../../provenance/facts-round-11.md) Q12, both certain), `levelUpProgram` runs **before** the level increment and **cannot skip or replace** the built-in stat growth: for each level gained, the engine (1) runs the character's `levelUpProgram` if one is set, (2) if the character is below `maxLevel`, increments the level by one, sets the next experience threshold, and applies the built-in increases to maximum HP, DP, FP, and maximum SMP **on top of** whatever changes the program made (in percentage mode, worked out from the stat after the program's changes, minus equipment bonuses), and (3) shows the level-gained message.

Reawakened's modern rule allows a behaviour `levelUp` hook to override or customize growth, whereas legacy's `levelUpProgram` had built-in growth added on top of whatever the program did. A non-empty legacy `levelUpProgram` wins over a modern behaviour `levelUp` hook: core advancement records each crossed level and returns a plain-data legacy level-up handoff containing the actor id, award, target level, and default proposal for the owning script layer; it does not invoke the program or invoke the behaviour hook directly. The handoff contains no program path or callable. For a legacy `levelUpProgram`, the owning script layer runs the program for each crossed level before the built-in level increment and stat growth are applied on top. If the legacy program is empty, a resolved behaviour may return a partial plain-data result patch to override or customize the core proposal; otherwise the core default applies. Omitted result fields mean unchanged, and executable code is never stored in actor or save data.

The core invokes `statsChanged` only after one or more non-legacy level-ups actually apply core stat growth. An XP-only award, an award to an actor already at `maxLevel`, and a legacy-program handoff do not invoke `statsChanged` and cannot mutate stats through that hook. Hook delta keys and values are validated against the closed level-stat set before any level-up is committed.

## Modern actor progression

Modern actors MAY carry explicit progression policy data, such as a supported percentage rate, fixed increment, rounding rule, or minimum increase. Policy data is actor-owned plain data and can differ between actors.

A resolved behaviour receives the actor and a plain-data context. It may reuse or replace the core proposal, but the core remains responsible for validation, actor-owned mutation, progression state, and the `leveledUp` event when the result is not delegated to a legacy program.

The precedence is:

```text
non-empty legacy levelUpProgram
→ behaviour levelUp hook
→ actor progression policy
→ legacy levelType/experienceIncrease compatibility policy
→ core defaults
```

## Level-up RPGCode hook

The legacy character may name an RPGCode program to run during level-up. It can show custom messages, award items, modify variables, play sounds, apply custom stat changes, and trigger scripted effects.

The editor MAY offer a non-destructive conversion of this program into a named behaviour. It MUST warn when a legacy program takes precedence, preserve the original until conversion is accepted, and never execute both implementations automatically.

**Legacy (R12 §4; R11-Q12, certain).** In 3.1 all of an award's experience is added before the first level-up, and one grant that crosses several thresholds runs the level-up sequence once per level gained ([facts-round-12.md](../../provenance/facts-round-12.md) §4; [facts-round-11.md](../../provenance/facts-round-11.md) Q12). Each step runs in this order:

1. The character's `levelUpProgram` runs, if one is set.
2. If the character is below `maxLevel`, the engine increments the level by one, sets the next experience threshold, and applies the built-in growth to max HP, DP, FP, and max SMP on top of whatever the program changed.
3. The engine shows a short message saying the character gained a level.

Across a multi-level award, each run of `levelUpProgram` sees the full new experience total (the same on every run), the level before this step, and stats that already include the growth from earlier steps in the same award ("old values" means "before this step's growth", not "before the award"). Because the level is stored as an ordinary script variable in legacy, the program can modify the level itself; the engine then adds one to whatever value the program left and checks `maxLevel` against that value. In percentage mode (`levelUpType = 0`), legacy rounds the increase in the experience requirement down to a whole multiple of the current requirement (so any percentage under 100 adds nothing in legacy; see [Threshold and level-up behavior](#threshold-and-level-up-behavior) for Reawakened's non-truncating percentage formula). The program does not set `source` or `target`, so in 3.1 it sees whatever an earlier program or battle left in those slots (R12 §2; certain).

**Reawakened rule — running the program (OWNER; Jensen, 2026-10-25).** For each crossed level, the owning script layer runs `levelUpProgram` through [`executeProgram`](rpgcode-functions.md#reawakened-executeprogram) (`callProgram` is an alias) with `{ source: null, target: null }` (with room for level/growth details in `context`; a departure from R12's stale slots) before that step's level increment and built-in stat growth are applied on top. Contrast this with a modern behaviour `levelUp` hook, which can override or customize the growth proposal instead of having built-in growth added on top. *Rejected:* leaving the enclosing caller's `source` and `target` in place, which makes what the level-up program sees depend on whether the award came from a battle or a script.

## Special moves

A special move assigned to a character is not copied into a separate learned-move inventory. The engine evaluates its conditions when it builds the actor's available moves. A move is available when at least one configured condition succeeds:

- current experience is at least its minimum experience;
- current level is at least its minimum level; or
- a configured RPGCode variable equals its required value.

This allows a game to unlock abilities through XP, level, items, quests, or other script-controlled conditions.

## Persistence and restoration

Save data preserves each actor's current progression state, including total experience, level, remaining XP to the next level, and current progression requirement. It also preserves the actor's policy data, `legacyLevelUp` precedence flag, and behaviour name when present. The exact persisted progression fields are `experience` in `stats`, `level` in `stats`, `remainingExperience`, `nextRequirement`, `levelType`, `experienceIncrease`, `maxLevel`, `levelHp`, `levelDp`, `levelFp`, `levelSm`, and `levelUpType` in `progression`; `legacyLevelUp` is required plain data with value `true`, `false`, or `null` (`null` means unresolved source precedence). It never stores a callable, compiled hook, or raw program path. On restoration, package startup rebuilds behaviour registrations before actor hydration. A missing behaviour uses the core default and emits a located diagnostic; it never refuses the save.
The current actor section is schema version 2. Restoration migrates a version-1 actor section without resetting actors: it carries the saved actor, stats, and policy fields, derives the missing threshold state through the recurrence for the saved level, and sets `legacyLevelUp` to `null` because version 1 did not persist whether a source program existed. `null` is unresolved legacy precedence, not an assertion that the source program was absent; the actor owner MUST resolve it from the referenced character asset before awarding XP, or reject the award. Invalid migrated policy or arithmetic is rejected before the restored section is returned. A version-2 save preserves the threshold fields and resolved legacy flag exactly.

## Maximum level

In legacy 3.1 and the final source, if a character already at `maxLevel` earns enough experience to cross the threshold, the engine runs `levelUpProgram`, skips the level increment and stat growth, and never resets the threshold — causing an infinite loop that either runs `levelUpProgram` endlessly or spins in a tight loop and freezes the window ([facts-round-12.md](../../provenance/facts-round-12.md) §4, [facts-round-11.md](../../provenance/facts-round-11.md) Q12).

In Reawakened, at `maxLevel`, additional XP remains recorded, but no further level, stat changes, or level-up program runs occur. The threshold check terminates safely and cannot loop indefinitely.

## Parity checklist

- [ ] Read XP rewards from every defeated enemy's `.ene` `exp` field.
- [ ] Award the total only on victory, to every eligible party member.
- [ ] Award no victory XP or gold on a successful flee.
- [ ] Implement `giveExp(handle, amount)` through the same actor progression path.
- [ ] Support multiple level-ups from one large award.
- [ ] Preserve XP, level, threshold state, policy data, and behaviour name in saves.
- [ ] Apply level-up changes to max HP, DP, FP, and max SMP, excluding equipment bonuses from percentage growth.
- [ ] Run the configured legacy level-up program when present.
- [ ] Give a modern behaviour precedence only when no legacy level-up program is set.
- [ ] Make special moves available from XP, level, or variable conditions.
- [ ] Terminate safely at `maxLevel` while retaining subsequently awarded XP.
