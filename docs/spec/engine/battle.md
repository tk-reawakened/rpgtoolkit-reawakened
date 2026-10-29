# Battle: package boundary, state, rules and outcomes

This page rules how a Reawakened battle behaves and who owns each part of it. [plugins-and-battle.md](plugins-and-battle.md) describes what Toolkit 3.1 does (E-70 to E-79) and the 140-method plugin callback interface; this page says what the rebuild does with it. Behaviour facts come from the owner-relayed clean-room round recorded in [facts-round-11.md](../../provenance/facts-round-11.md) (cited as `R11-Qn`) and from [facts-round-10.md](../../provenance/facts-round-10.md) for the ordinary attack; actor ownership comes from [actors.md](actors.md).

**How to read this page.** A paragraph starting **Legacy** says what Toolkit 3.1 does. A paragraph starting **Reawakened rule** is this project's rule; where it departs from 3.1 it says so. Every Reawakened rule on this page was approved by the owner (Jensen, 2026-10-25) at entry 7.1's checkpoint. Every row names a rejected alternative. Ruled by entry 7.1 of Epic 7 (issue #504).

| Row | Topic |
|---|---|
| [BAT-1](#bat-1) | Boundary: what the core owns and what the `stock_battle` package owns |
| [BAT-2](#bat-2) | The `battle` save section |
| [BAT-3](#bat-3) | The battle-facing API and the E-79 callback mapping |
| [BAT-4](#bat-4) | The loop, the tick, charge and turn order |
| [BAT-5](#bat-5) | Damage, special moves and items |
| [BAT-6](#bat-6) | Status effects |
| [BAT-7](#bat-7) | Enemy AI |
| [BAT-8](#bat-8) | Outcomes, running, rewards and losing |
| [BAT-9](#bat-9) | Starting a battle and the party sources |
| [BAT-10](#bat-10) | Battle music and sounds |
| [BAT-11](#bat-11) | The default battle UI |
| [BAT-12](#bat-12) | Events and `defeated` |
| [BAT-13](#bat-13) | Save, restore and reset |
| [BAT-14](#bat-14) | Package loading and the no-package path |
| [BAT-15](#bat-15) | Determinism, hazards not reproduced and golden policy |

<a id="bat-1"></a>
## BAT-1 — The boundary (OWNER)

**What it means for a game author.** The engine knows what a fighter *is* (its stats, statuses and level); a battle *package* decides how a fight plays. The stock battle is one such package, written in RPGCode, and you can replace it entirely with your own.

**Reawakened rule (OWNER; Jensen, 2026-10-19; battle/board audio split amended 2026-10-26).** The core owns the actor model ([actors.md](actors.md)) and the `battle` section ([BAT-2](#bat-2)): who is in the fight and each fighter's charge. The `stock_battle` package owns the loop and tick ([BAT-4](#bat-4)), the charge rate, damage, status round effects, enemy AI, the sequence that follows an outcome, battle music cues and the UI. There is no core battle phase, no core rules engine and no core `fightTick`. The one battle-specific operation the core keeps is the compatibility adapter of [BAT-8](#bat-8), so a custom fight program written for 3.1's outcome codes still receives rewards. The battle side may start its `.bkg` music through the engine-mediated audio-effect producer, but it does not own board-music restoration ([BAT-10](#bat-10)).

*Evidence:* the 2026-10-19 owner decision in the Epic 20 notes; [actors.md](actors.md#core-and-battle-boundary). *Rejected:* a core rules engine behind the default UI, which gives two rule owners and stops a replacement from being a real replacement.

<a id="bat-2"></a>
## BAT-2 — The `battle` section (OWNER)

**Reawakened rule.** The section is `null` when no battle is active, otherwise one record:

| Field | Type | Meaning |
|---|---|---|
| `id` | integer | A battle number from the battle owner's counter, never reused in a run. |
| `boardKey` | string | The board where the battle began. It identifies the battle's board context; the board/audio owner restores music from the active board's data on return, not by looking up music through this key ([BAT-10](#bat-10)). |
| `background` | string | The `.bkg` file name ([battle-data.md](../formats/battle-data.md#fight-background-bkg)). |
| `canRun` | boolean | True unless an enemy forbids running ([BAT-8](#bat-8)). |
| `outcome` | 0–4 or `null` | Set once by `finish` ([BAT-3](#bat-3)); `null` while the fight is live. |
| `parties` | two ordered arrays | Party 0 is the enemies, party 1 is the player's party; each entry is `{ party, actorId, charge }`. |

Status effects, HP, SMP, FP and DP stay on the actor and are never copied here. The array order is the turn-order tie-break ([BAT-4](#bat-4)). A dangling `actorId` or a repeated `(party, actorId)` pair is a located load diagnostic; the entry is kept and marked unusable, so a later script can repair it, and the loop skips it as not living. `reset()` clears the section.

*Evidence:* AD-10; [actors.md](actors.md#actor-data-and-identity). *Rejected:* a battle-local copy of stats, which needs a merge rule and breaks the one-owner rule of ACT-3.

<a id="bat-3"></a>
## BAT-3 — The facing API and the callback mapping (OWNER)

**Reawakened rule (OWNER; Jensen, 2026-10-25; clarified 2026-10-26).** A battle package or custom fight program reaches the battle through one global `battle` object plus the actor's own stat and status methods. `battle.background` exposes the read-only fight-background filename, and `battle.fighter(party, index)` returns canonical actor-object handles; invalid fighter handles raise `battle.bad-fighter`, distinct from `battle.bad-outcome` for an invalid outcome. No `fight*` callback table exists.

| Operation | Meaning |
|---|---|
| `battle.partySize(party)` | Number of entries in party 0 or 1. |
| `battle.fighter(party, index)` | The actor object at that position. |
| `battle.charge(party, index)`, `addCharge`, `setCharge`, `releaseCharge` | Read, add to, set, or reset to 0 the stored charge. |
| `battle.chargePercent(party, index)` | The charge as a whole percent of the fighter's threshold, clamped 0 to 100. |
| `battle.canRun` | The section's flag, read only by the package. |
| `battle.background` | Read-only fight-background filename. |
| `battle.outcome`, `battle.finish(code)` | `finish` accepts only integer codes 0 to 4 and writes `outcome`; an invalid code is `battle.bad-outcome`, distinct from fighter-handle `battle.bad-fighter`. A second `finish` is the catchable `battle.already-finished`. |

A fighter handle in a script is `source`, `target`, a party-member name, the canonical actor-object handle returned by `battle.fighter(party, index)`, or an enemy reference `{ party: 0, index }`; an unknown handle, a bad party or an out-of-range index is the catchable `battle.bad-fighter`.

**The mapping of E-79's callbacks 114 to 132.**

| # | Legacy callback | Rebuild operation |
|---|---|---|
| 114 | party size | `battle.partySize` |
| 115–120 | fighter HP, max HP, SMP, max SMP, FP, DP | the actor's stat reads (`gethp`, `getmaxhp`, `getsmp`, `getmaxsmp`, `getfp`, `getdp` over the handle) |
| 121 | fighter name | the actor's display name |
| 122 | fighter animation for a stance | the actor's animation for that stance (presentation) |
| 123 | charge percent | `battle.chargePercent` |
| 124 | advance one tick | **no operation**: the package's loop is the tick ([BAT-4](#bat-4)) |
| 125 | draw text at a pixel position | the existing `pixelText` primitive |
| 126 | release a fighter's charge | `battle.releaseCharge` |
| 127 | physical attack | the package's physical action, which calls the actor's `damage` ([BAT-5](#bat-5)) |
| 128 | use an item | the package's item action ([BAT-5](#bat-5)) |
| 129 | use a special move | the package's special action ([BAT-5](#bat-5)) |
| 130 | handle window events | **no operation**: the host owns its event loop |
| 131, 132 | add or remove a status effect | `applystatus`, `removestatus` ([BAT-6](#bat-6)) |

The legacy stat built-ins (`hp`, `givehp`, `smp`, `givesmp`, `fp`, `givefp`, `dp`, `maxhp`, `maxsmp` and their `get` forms, `giveexp`) are aliases onto actor stats and are not a second store; `givehp` and `givesmp` go through the actor's damage and heal path so `fallen` fires once. Callbacks outside 114 to 132 belong to canvases, animations, strings and inventory, which other rows and epics own.

*Evidence:* [plugins-and-battle.md](plugins-and-battle.md#e-79). *Rejected:* a bespoke `fight*` callback object, which would keep the legacy plugin ABI inside the rebuild.

<a id="bat-4"></a>
## BAT-4 — The loop, the tick, charge and turn order

**Legacy (R11-Q2, Q3, Q4).** A tick is one pass of the battle system's main loop, with no timer: its real-time rate depends on the machine. A pass first ends the battle if it has been decided (loss, then win, then a successful escape), then redraws, shows revived fighters, advances every fighter once, and lets the system handle input. Within the advance, enemies are visited in party order and then players in party order; a charged fighter takes its whole turn on the spot (menu, choices, animations, numbers, messages) before the pass continues, and **nobody charges while a turn is in progress**. A fighter that crosses its threshold during the advance acts in the next pass. Whether the fight is over is checked only between passes, so fighters later in the same pass still act. Charge above the threshold is not carried over: it returns to 0 after the turn.

**Reawakened rule — one battle thread, one pass per engine tick (OWNER; Jensen, 2026-10-25).** The package runs the whole battle on **one RPGCode thread**. Each pass takes at least one engine tick (`threadSleep(getThreadId(), 1/60)`, converted by the ruled `max(1, floor(seconds * 60 + 0.5))`), so the rate is fixed at 60 passes a second and is a Reawakened choice, not parity (R11-Q2 gives no real rate). Because a turn runs inside the pass and its waits park the one thread, nobody charges while a turn is in progress, exactly as in 3.1. A turn's waits spread its steps over many ticks, so the single thread's cost per tick is the idle advance plus one fighter's step, well inside `STEP_BUDGET`: the implemented steady idle pass measures 75 steps per living fighter plus 26 steps of pass overhead, so eight fighters cost 626 steps and nine cost 701 of the 1000-step budget, both without statuses and with one cached inert status per fighter [MEASURED by [the BAT-4 pass-cost test](../../../packages/core/test/battle-loop.test.ts); supersedes [the spike](../../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-platform/discovery/step-budget-spike.md)'s inferred estimate]. The spike's "one thread per fighter" condition addressed fighters acting *at the same time*, which 3.1 never does; a pass that is preempted resumes next tick and is late, not wrong.

* **Fight background read.** The loop first reads its fight background once ([BAT-10](#bat-10-cue-inventory)); that file request may take engine ticks before the draws below, and no later pass requests a file for a cue.
* **Initial charge (R11-Q1).** One seeded draw per fighter from 0 to its threshold minus 1 (players 75, enemies 123), in party order, enemies then players; fallen players get one too. The draw order is a Reawakened choice.
* **The advance.** Each living, unfrozen fighter below its threshold gains its rate. The stored charge is not clamped; `chargePercent` is. A fallen fighter does not charge and keeps its charge, and charging continues from it if the fighter is revived (R11-Q9).
* **Rate.** `3 + 2 × (speed statuses) − 2 × (slow statuses)`, with **no floor and no ceiling** (R11-Q6). A rate of 0 or less means the fighter never reaches its threshold, so it never acts and its statuses never tick. Reproduced for parity and recorded as an author hazard.
* **Turn order.** Enemies by party index, then players by party index; a charged fighter acts when reached, and several fighters may act in one pass, one after another.
* **After a turn.** The fighter's charge becomes 0. The loop never sleeps through a pass in which nobody is ready by spinning: a pass costs at least one tick.
* **Disable (R11-Q5c).** A frozen fighter's charge does not grow, and a charge already at or above the threshold is set to one below it. See [BAT-6](#bat-6).

*Evidence:* [R11-Q1 to Q4, Q6, Q9](../../provenance/facts-round-11.md); E-72; the step-budget spike. *Rejected:* one thread per fighter, which only fixes a problem 3.1 does not have (simultaneous turns) and lets two turns' waits overlap; and a core-owned charge accumulator, which would put a battle rule in the core against BAT-1.

<a id="bat-5"></a>
## BAT-5 — Damage, special moves and items

**Ordinary attack.** The ruling is the E-74 rule recorded from facts round 10, unchanged: one seeded luck draw of a whole percentage from −10 to +9 applied in exact integer arithmetic with the fraction dropped toward zero, then the critical draws (offensive value, then defensive value; −1 means no draw), DP subtracted unless critical, a floor of 1, and HP or SMP never below 0. The draw order is luck, offensive, defensive. Not restated here.

**Legacy and Reawakened rule — special moves (R11-Q7).** No luck swing, no critical test, no DP and no floor of 1: the move's FP is subtracted from the target's HP, its target-SMP value from the target's SMP, and its SMP cost from the user's SMP; each stops at 0. A move with 0 FP does no damage. The player's menu refuses a move whose cost exceeds the user's current SMP. After the effect, the user's special-move animation plays, then the move's own animation over the target, then the move's program runs, then its status effect is applied, then the amounts are shown.

**Reawakened departure (OWNER; Jensen, 2026-10-25).** 3.1 lets a move with negative FP or negative target SMP raise a stat above its maximum. The actor owner clamps every stat to `[0, max]`, so a heal stops at the maximum. Departure recorded; the rule is that no stat leaves its range.

**Legacy and Reawakened rule — items (R11-Q7).** The item's battle HP and SMP values are added to the target and the result is kept between 0 and the target's maximum. No luck, critical or DP. One copy leaves the inventory through a posted consume effect (never by editing the list), applied by the inventory owner before the item's animation and program; successful consumption routes through the stable entry id and emits one `itemRemoved` event. The battle program runs after its animation.

`attackall` and `drainall` deal their amount to each living target without a critical test. Damage and heals go through the actor's `damage` operation, so `fallen` fires once per lethal hit; before it, the package sends the cancelable `beforeDamage` on the battle thread ([BAT-12](#bat-12), entry 7.14).

**Program call and `context` / `source`/`target` (OWNER; Jensen, 2026-10-25; from [facts-round-12.md](../../provenance/facts-round-12.md)).** *Legacy (R12):* for a special move, `source` = the user and `target` = the victim; for an item, `source` = the user and `target` = the recipient; neither is restored afterwards (certain); the slots are set before the animations and, for an item, the copy is taken from the inventory before the program runs (certain, R12 §3). **Reawakened rule (OWNER; Jensen, 2026-10-25):** the move's program runs through [`executeProgram`](rpgcode-functions.md#reawakened-executeprogram) with `{ source: user, target: victim, move: moveData, ... }` and the item's battle program runs through `executeProgram` with `{ source: user, target: recipient, item: itemData, ... }`, exposing `context` in the called program's root scope, setting the thread's `source` and `target` slots for the call, and restoring both slots when the program ends. *Rejected:* leaving the pair set after the call, or limiting the call to two fixed positional parameters instead of a generic context payload, as there.

*Evidence:* facts round 10; [R11-Q7](../../provenance/facts-round-11.md); E-74. *Rejected:* applying the ordinary-attack luck and DP to specials, which R11-Q7 contradicts; and a second damage formula for the package.

<a id="bat-6"></a>
## BAT-6 — Status effects

**Legacy (R11-Q5, Q6).**

* A status ticks **once per turn of the fighter that carries it**, in the pass where that fighter is found fully charged, just before its turn. It does not tick while a menu is open (nothing moves then).
* For each status in turn: apply its HP amount if set, then its SMP amount if set, then run its program (with the fighter as `source` and `target`), then reduce its round count by 1, then, if the count is 0, remove it and undo its speed, slow or disable contribution. A status with N rounds therefore acts N times.
* A fighter's statuses tick in order of their file names compared in upper case, character by character.
* Each speed status adds 2 to the rate and each slow status takes 2 away; different files add, with no floor or ceiling. Applying a status the fighter already has (names compared ignoring case) undoes the old copy and reads the file again, so the count restarts; counts never add.
* A disabled fighter never becomes charged, so its statuses never tick and a disable never ends by itself. It ends when something removes it or the battle ends. With several disabling statuses the fighter is frozen until all are gone. A disable that lands on a *player* during that player's own turn is cancelled at the end of that turn.
* All statuses end with the battle. A status that takes a fighter to 0 HP does not stop the turn: attacks, moves and items of a fallen attacker do nothing, an enemy with a custom AI program still runs it, and a player still gets the menu and can still run.

**Reawakened rule.** Identity and duration are the actor's status counter ([actors.md](actors.md)); the package applies the effect and calls `advanceStatus` at the ruled point. The rules above are reproduced, with these departures **(OWNER; Jensen, 2026-10-25)**:

1. A heal from a status stops at the maximum (BAT-5).
2. A `.ste` with fewer than 1 round loads with a diagnostic and lasts until removed; the legacy wrap-around after about 65,000 turns is not reproduced.
3. The player-turn disable cancellation is **not** reproduced: a disable stays until removed, which keeps one meaning for the reference count.
4. If `advanceStatus(1)` cannot age one status at a time, the package applies all effects in order and then ages all counts; the only difference is a status program reading another status's remaining rounds mid-turn.

**Program call and `context` / `source`/`target` (OWNER; Jensen, 2026-10-25; from [facts-round-12.md](../../provenance/facts-round-12.md)).** *Legacy (R12):* `source` and `target` are both the afflicted fighter and are not restored afterwards (certain; R12 says the program runs "once per round tick", read here as once per turn of the fighter). **Reawakened rule (OWNER; Jensen, 2026-10-25):** the status program step runs through [`executeProgram`](rpgcode-functions.md#reawakened-executeprogram) with `{ source: fighter, target: fighter, status: statusName, ... }`, restoring the pair afterwards. *Rejected:* leaving the pair set after the call, as there.

*Evidence:* [R11-Q5, Q6](../../provenance/facts-round-11.md); E-75; [battle-data.md](../formats/battle-data.md#status-effect-ste). *Rejected:* aging every actor's statuses each tick (3.1 ages per turn, which is why disable is strong); and a floor of 0 on the rate, which 3.1 does not have.

<a id="bat-7"></a>
## BAT-7 — Enemy AI (OWNER)

**Legacy (R11-Q8).** The AI is the engine's. A level outside 0 to 3 makes the enemy do nothing. Enemies never defend or rest.

| Level | Behaviour |
|---|---|
| 0 | a fair coin: heads, an ordinary attack on a random living player; tails, try a special move |
| 1 | always try a special move; targets random |
| 2 | like 0, but the target is the weakest |
| 3 | like 1, but the target is the weakest |

* **Trying a special move:** choose with equal chances among the enemy's specials whose cost is at most its current SMP (the "usable in battle" flag is not checked). If none qualifies, make an ordinary attack with the same target rule.
* **Weakest:** the living player with the lowest current HP (not the lowest share of maximum); ties go to the earlier party position; fallen fighters are skipped.
* **Healing or harmful:** FP below 0 is healing, FP of exactly 0 is harmful. A healing move goes to the enemy's own side: at levels 0 and 1 a random living ally (possibly itself, possibly at full HP), at levels 2 and 3 the living ally with the lowest current HP.
* **A custom AI program** gets the enemy as `source` and a random living player as `target`, runs, and nothing else happens: it must act itself (an attack, a move, an item, or a hand-over to a built-in level). A program that does nothing spends the turn (R11-Q10).
* The internal AI never targets a fallen player.

<!-- OWNER: ERR-2 governs errors in custom battle programs; the enemy turn ends when its program returns — Jensen delegated to director 2026-10-26. -->
**Reawakened rule (OWNER; Jensen, 2026-10-26).** The coin is one seeded draw from {0, 1}. The draw order is the coin, then the special-move pick, then the target, then the combat draws of BAT-5 (a Reawakened choice; the original's order is not recorded). The built-in `ai(level)` sets the level of the acting enemy and rejects a level outside 0 to 3 with a catchable error, instead of silently doing nothing. When no living player remains, an AI turn is skipped: 3.1 divides by zero on an empty target pick after the party falls mid-pass (R11-Q4), which is not reproduced. An error inside a custom AI program is handled by its own handler if it set one; otherwise it is reported and the program continues with its next step (ERR-2). The enemy's turn ends when the program returns; the caller continues after the call (see [`executeProgram`](rpgcode-functions.md#reawakened-executeprogram)).

**Program call and `context` / `source`/`target` (OWNER; Jensen, 2026-10-25; from [facts-round-12.md](../../provenance/facts-round-12.md)).** *Legacy (R12):* the random living player target is picked before the program runs, and the slots are not restored afterwards (certain). **Reawakened rule (OWNER; Jensen, 2026-10-25):** the custom AI program runs through [`executeProgram`](rpgcode-functions.md#reawakened-executeprogram) with `{ source: enemy, target: randomLivingPlayer }`, restoring the pair afterwards. An error follows the `executeProgram` / ERR-2 rule above; the enemy's turn ends when the program returns. *Rejected:* leaving the pair set after the call, as the legacy command did.

*Evidence:* [R11-Q8, Q9, Q10](../../provenance/facts-round-11.md); E-76; ERR-2 in [rpgcode-errors-and-threads.md](rpgcode-errors-and-threads.md); `packages/core/test/battle-ai.test.ts` — “custom AI receives source/target handles, can act or hand off, and ERR-2 continues after errors”. *Rejected:* an engine-side AI, which would stop a custom fight program from replacing it, and ending the enemy turn at the error rather than continuing the custom program.

<a id="bat-8"></a>
## BAT-8 — Outcomes, running, rewards and losing

**Outcome codes (legacy, unchanged).** 0 ran away (automatic), 1 ran away (handled by the package), 2 won (automatic), 3 won (handled by the package), 4 lost.

**Legacy (R11-Q11, Q12, Q13).**

* **Run.** If any one enemy forbids running, running is blocked for the whole fight; the menu still lists Run but draws it differently, choosing it plays the cancel sound and keeps the turn. When allowed, the default battle system succeeds **2 times in 5**; a failed attempt shows a message and uses the turn. A success shows a message and the battle ends at the start of the next pass; nobody else takes a turn, though other charged players in that pass still have their statuses tick. If that leaves every player at 0 HP the battle is a loss, not an escape. After a successful escape the engine runs one run program: the **last enemy, in encounter order, that has one**. No rewards.
* **Win.** The enemies' experience and gold are each summed. In order: the gold is added silently; a message gives the experience total if above 0; each party member in party order, fallen included, receives the **full** experience total, and for each level gained the level-up program runs if there is one, the stats rise, and a short level-gained message is shown (not at maximum level); a message gives the gold total if above 0; then the win program of the **last enemy, in encounter order, that has one** runs (only that one).
* **Lose.** Every player at 0 HP or below, checked between passes, before the win check, so a simultaneous fall is a loss. If a game-over program exists it runs instead of the reset and the engine does not reset afterwards; without one a game-over message shows and the game resets. In every outcome the board music then returns and the screen is redrawn.

**Reawakened rule (OWNER; Jensen, 2026-10-25; run chance amended 2026-10-26).** The compatibility adapter. `battle.finish(code)` records the outcome. For 0, 2 and 4 the core then performs the sequence above using only generic operations that already exist: the actors' experience award (which handles level-ups and the maximum-level case, [progression-and-levels.md](progression-and-levels.md#maximum-level)), one plain-data gold effect using Epic 8's inventory action shape (`{ type: "addGold", amount }`; [E-81](plugins-and-battle.md#e-81)), the message path, running the named program, and `reset()`. For 1 and 3 the core does nothing: the package or custom program has handled it. The stock package uses the same adapter. This is the only battle-specific operation in the core; it exists so a fight program written for 3.1's outcome codes needs nothing more. The stock package uses one seeded `random(5)` draw; this built-in maps a uint32 draw to `1 + (draw % 5)`, so results 1 and 2 correspond to residues 0 and 1. Under uniform uint32 inputs, the absolute probability deviation of `random(5) <= 2` from 2/5 is `3/(5*2^32) = 1.39698e-10`. The deviation is accepted with no RNG change. A blocked Run does not spend the turn; `battle.finish(0)` while `canRun` is false is the catchable `battle.cannot-run`.

**Departure.** The maximum-level freeze recorded in R11-Q12 (a character at maximum level given enough experience retries forever) is not reproduced; the actor owner terminates safely there.

**Program call and `context` / `source`/`target` (OWNER; Jensen, 2026-10-25; from [facts-round-12.md](../../provenance/facts-round-12.md)).** *Legacy (R12):* the win, run, game-over and level-up programs do not set the slots and see whatever an earlier program or battle left there (certain). **Reawakened rule (OWNER; Jensen, 2026-10-25):** the adapter's win, run and game-over program steps, and the level-up program step of the reward sequence, run through [`executeProgram`](rpgcode-functions.md#reawakened-executeprogram) with `{ source: null, target: null }` (with room for reward/level details in `context`; a departure from R12's stale values) and restore the caller's slots afterwards. *Rejected:* leaving the battle's last pair in place, as there.

*Evidence:* [R11-Q11 to Q13](../../provenance/facts-round-11.md); E-77; [progression-and-levels.md](progression-and-levels.md). *Rejected:* a purely package-owned reward sequence, because a custom fight program with no package present would then receive no rewards and E-79 ("a script can build its own battle screen without a second rules engine") would fail.

<a id="bat-9"></a>
## BAT-9 — Starting a battle and the party sources

**Legacy (R11-Q14).** `Fight(skill, background)` draws **1 to 4** enemies, each count equally likely; each enemy is drawn on its own with equal chances from the main file's enemy-list entries whose skill level matches (the same enemy may repeat, and an entry listed twice is twice as likely). If no entry matches, an error message box appears (the E-70 message) and no fight starts. A random encounter uses exactly this draw with the board's skill level and background, unless the game names its own fight program. The whole party takes part, **every occupied slot, fallen members included, who start fallen**. `FightEnemy` sets up the same way, so any enemy can still forbid running and its programs still apply.

**Reawakened rule — a random encounter draws, a custom encounter is spelled out (OWNER; Jensen, 2026-10-26).** *In plain terms:* an ordinary random encounter picks its enemies by chance from the game's list of available enemies. If the game names its own fight program, the engine picks nobody and passes nobody: it runs that program, and the program says exactly which enemies fight, in the order it writes them, by calling `FightEnemy`. *Precisely:*

1. **A drawn encounter (the main file names no fight program).** The 5.11 handoff (`battle.randomEncounter`) supplies the drawn enemies, background and board. The start path hydrates the enemies ([actors.md](actors.md)) as party 0 in handoff order, takes party 1 from the actor store's ordered party, writes the section ([BAT-2](#bat-2)), starts the registered `battle` command and waits for the outcome. The legacy callback's `skill = -1` sentinel is legacy-callback-only; it is not part of the Reawakened package/start contract, whose request carries the board record and its own skill value. An empty party is a located error. The no-enemies message is shown by the start path and no battle begins.
2. **A custom encounter (the main file's custom-fight flag is set and names a program).** The evaluator still rolls the encounter chance ([E-70](plugins-and-battle.md#e-70)) but draws no enemy, neither the count nor a pool pick, and its request (`battle.customFight`) carries **no fighters**: only the trigger kind, the board (`key`, `skill`, `background`), the player and the program's name. A set flag with a blank name names no program, so that encounter is a drawn one. The start path creates no battle, loads no enemy and takes no random number. It runs the named program in place of the draw and of the package start, through the [`executeProgram`](rpgcode-functions.md#reawakened-executeprogram) frame push on a new thread the engine starts for it. The program's `context` is the request itself (`trigger`, `board`, `actor` and `program`), and its `source` and `target` are `null` (*legacy:* R12 does not record the slots this program sees). A program name that matches no file is the catchable `program.missing` of `executeProgram`: nothing runs, no battle starts and the game goes on.
3. **The program spells its enemies out.** The program starts the fight itself with `FightEnemy(enemy, …, background)`: one to four enemy files in the order written, then a background (`context.board.background` is the board's). That call is the start of any scripted fight, so it gives the setup of the legacy paragraph above (the enemies hydrated as party 0 in the order written, party 1 from the ordered party with fallen members starting fallen, the background recorded, `canRun` false if any one enemy forbids running), starts the registered `battle` command and waits for the outcome, which takes the outcome path of [BAT-8](#bat-8). It draws nothing. A program may instead call `Fight(skill, background)`, for example with `context.board.skill`, to take the legacy seeded draw. `Fight` and `FightEnemy` never start the custom program, so a program that calls them cannot start itself; only an encounter's custom request does. Without the `stock_battle` package either call is the catchable `battle.package-missing` ([BAT-14](#bat-14)).
4. **A program with its own battle loop.** A program that runs its own loop instead of the package's ([E-79](plugins-and-battle.md#e-79), [BAT-3](#bat-3)) still uses the same `battle` section and the same outcome adapter ([BAT-8](#bat-8)). It takes the same setup, without the package's loop, from the package's setup-only entry points, which share this start path; entry 7.12 proves that path and rules any public surface it needs.

<!-- OWNER: Jensen, 2026-10-26 (a random encounter draws from the list of available enemies, a custom encounter is spelled out); applied without a format change (the program names its enemies with FightEnemy) by the director the same day. -->

*Evidence:* [R11-Q14](../../provenance/facts-round-11.md); E-70, E-71; [rpgcode-functions.md](rpgcode-functions.md#reawakened-executeprogram) for the call. *Rejected:* the package choosing enemies, which would give random starts two implementations; the engine drawing enemies for a custom program or passing it the main file's list, which gives a custom encounter a hidden draw and mistakes what may be drawn for what fights now; a per-encounter enemy-list field on the board or in the main file, which is a format change that 3.1 stores nothing for and nothing needs, because the program already decides and `FightEnemy` is the spelled-out surface.

<a id="bat-10"></a>
## BAT-10 — Battle music and sounds

<!-- OWNER: BAT-10 — Jensen, 2026-10-26; evidence: owner ruling that, after `boardReturned`, the board/audio producer requests music from the active board; rejected alternative: have battle code look up or restore board music by `battle.boardKey`, which couples battle logic to board/audio ownership. -->

**Reawakened rule (OWNER; Jensen, 2026-10-26).** At battle start, the engine-mediated battle audio producer reads the music field from the fight background's `.bkg`. When that field supplies a non-empty music asset, it posts the existing `music.play` effect to the built-in `music` track with looping enabled and source `battle`; it does not use a package-declared track. The audio applier replaces the current music track, and `beforePlay` can replace or cancel the music request. If a `beforePlay` listener fails, the music-start request is rejected without falling back to the original track; it does not reject or stop the battle start. The engine producer supplies `source`; it is not a caller-controlled `mediaPlay` option ([audio-media.md#media-3](audio-media.md#media-3)). If the `.bkg` has no music, the producer posts no effect, so the board's current music keeps playing rather than being stopped or replaced.

After outcome handling completes, the battle lifecycle announces the non-cancelable game event `battleEnded` with `{ outcome }`. In the `events` phase the engine returns the presentation to the active board and emits `boardReturned` with `{ boardKey }`. The engine-owned board/audio producer reacts to that return event by reading the active board's own `bkgMusic` and posting its normal `music.play` effect to the built-in `music` track, with source `board` and `null` when the board has no music. This happens before the `audio` phase applies the effect. A different board file replaces the current music; a same-file request on a playing single-voice music track carries on; a `null` request stops and clears the track. Thus the current track can remain playing through outcome handling when no battle track replaced it, and an already-playing board track can carry on after `boardReturned`. The battle system neither caches the prior board track nor searches for one by `battle.boardKey`; that saved key identifies the starting board but is not a music lookup.

Menu and battle cues are voices on their configured tracks, so they mix over music and never stop it. A missing cue is silent. The battle section stays plain data and stores no audio handle or duplicate music file. Playback is saved by the independent audio section ([audio-media.md#audio-save-load](audio-media.md#audio-save-load)): on a mid-battle load, an active music track restarts at the load tick under that contract, while the battle background, battle thread and board identity restore from their own plain-data state. When the battle later returns to the board, `boardReturned` causes the engine to read the active board's music again.

<a id="bat-10-cue-inventory"></a>
**Cue inventory (entry 7.19; issue #691).** The only battle audio cue names are the approved `.bkg` fields of [battle-data.md](../formats/battle-data.md#fight-background-bkg) and the two music requests above. No other combat cue name exists: the only other sound fields in the formats are the character file's legacy swipe, defend, special and die sounds, which [character.md](../formats/character.md) marks "legacy; ignored"; `.anm` frame sounds on stance animations ([animation.md](../formats/animation.md)), which are owned by the engine's animation phase and route to `sfx` with source `animation` under [audio-media.md R-59](audio-media.md#r-59-routing); and the main file's cursor sounds, which are menu cues. No format names a damage, critical, item or level-up sound, and [audio-media.md](audio-media.md) lists no producer for one, so none is routed. An empty or missing file is silent and never changes the fight.

| Cue (contract field) | Meaning, as written by the contract | Trigger | Route | Owner |
|---|---|---|---|---|
| battle music (`.bkg` `music`) | battle music in `Media\` | battle start, when non-empty | engine producer: `music.play(file, true, false, "battle")` on `music` ([BAT-10](#bat-10)) | engine, entry 7.10 |
| board music on return (board `bkgMusic`) | the active board's music | `boardReturned` | engine board producer: `music.play(file, true, null, "board")`, or a null request, on `music` | engine, entry 7.10 |
| `readySound` | a fighter's charge bar is full | the pass in which `stock_battle` finds an unfrozen fighter at or over its threshold ([BAT-4](#bat-4)), once for that fill of the bar, for an enemy or a player (the `fightInform` code 5 moment of [E-79](plugins-and-battle.md#e-79)) | `stock_battle` calls `mediaPlay(file, { track: "ui", loop: 0 })`, a voice on `ui` | `stock_battle`, entry 7.19 |
| `cantDoSound` | action not possible | a blocked Run, the one refusal `stock_battle` itself decides ([BAT-8](#bat-8)); the refusals of the default UI (an unaffordable special, for example) are owned by entry 7.11 | same voice route as `readySound` | `stock_battle`, entry 7.19; further sites entry 7.11 |
| animation frame sounds (`.anm` frame `sound`) | sound in `Media\` played when an animation frame is shown | visible `.anm` frame during battle stances or actions | engine animation phase: `sfx.play` on `sfx` with source `animation` ([audio-media.md R-59](audio-media.md#r-59-routing)) | engine animation phase; stance playback owned by entry 7.11 |
| `selectSound` | menu cursor moved | a battle-menu cursor move | not routed by entry 7.19 | entry 7.11 |
| `chooseSound` | menu item chosen | a battle-menu choice | not routed by entry 7.19 | entry 7.11 |
| main-file `cursorMoveSound`, `cursorSelectSound`, `cursorCancelSound` | menu cursor sounds | menu move, confirm, cancel | not routed by entry 7.19 | entry 7.11 (main menu: Epic 8) |

**Reawakened rule (OWNER; Jensen, 2026-10-27; entry 7.19).** The owner explicitly approved routing battle-ready and action-unavailable sounds as UI voices separate from music, allowing overlap. In plain terms, the two `.bkg` sounds that are not menu sounds (`readySound` and `cantDoSound`) play as one-shot voices on the `ui` track, so they mix over the battle music and never stop it. Technically: `readySound` and `cantDoSound` are started by the stock package through `mediaPlay` on the built-in `ui` track, the track [audio-media.md R-59](audio-media.md#r-59-routing) assigns to battle-menu sounds, so `beforePlay` sees them with source `script` and `wavstop` does not stop them; the `ui` track's four voices let same-tick cues all play. The stock package reads the fight background through `battlebackgrounddata()` once, when its loop starts and before any charge is drawn, so no pass ever waits on a file; an empty field starts nothing. A cue is not de-duplicated: two fighters filling in one pass are two voices. `selectSound`, `chooseSound` and the main-file cursor sounds are menu cues and this entry adds none of them.

**Source gap recorded, not guessed.** [R11-Q11](../../provenance/facts-round-11.md) says a blocked Run "plays the cancel sound"; the `.bkg` has no cancel sound and the main file's `cursorCancelSound` is a menu cue, so which of the two a blocked Run plays is not settled by an approved contract. The stock package already starts `cantDoSound` there (outcomes entry, #511) and entry 7.19 keeps that one site; entry 7.11 owns the ruling and every other refusal site.

*Evidence:* Jensen's 2026-10-26 and 2026-10-27 owner rulings (routing battle-ready and action-unavailable sounds as UI voices separate from music, allowing overlap; board-return music after `boardReturned`; playback in independent audio section; listener failure rejects start); [audio-media.md](audio-media.md), especially [MEDIA-3](audio-media.md#media-3) and [audio-save-load](audio-media.md#audio-save-load); [rpgcode-modules-and-objects.md#emit-13](rpgcode-modules-and-objects.md#emit-13); [main-loop-and-startup.md#reawakened-phases](main-loop-and-startup.md#reawakened-phases); [battle-data.md](../formats/battle-data.md#fight-background-bkg); `packages/core/src/script/packs/battle.ts` (battle state starts before `playBattleMusic` posts its separate music request); `packages/core/test/audio-runtime.test.ts` — “a failed engine beforePlay dispatch rejects the start” (music-start request only). *Rejected:* saving the board's audio in `BattleSection` or making battle code restore it by `boardKey`, which duplicates audio state and gives the battle system responsibility for board presentation; treating a rejected music request as a rejection of battle start, which would bind battle outcome to optional audio playback.

<a id="bat-11"></a>
## BAT-11 — The default battle UI (OWNER; Jensen, approved 2026-10-28)

**Reawakened rule (OWNER; Epic 7.1).** The default UI draws only with the existing 3.1 primitives (`fillrect`, `drawrect`, `text`, `pixelText`, `bitmap`, `drawcanvas`, `rendernow`) and reads the existing key queue; no `drawBox` or `drawBar` is added. It redraws when shown values change, keeps no animation state of its own, and never mutates the battle. Layout and the golden frame are ruled by entry 7.11 with the owner's approval.

<a id="bat-11-screen"></a>
**Owner-approved rule: the screen, the keys and the golden frames (Jensen, 2026-10-28; entry 7.11, issue #514).** Jensen approved the complete screen, including all five decisions, layout, colours, keys, target-list presentation and golden frames. It uses only behaviour this page, [rpgcode-functions.md](rpgcode-functions.md) and [display-input-audio.md](display-input-audio.md) already document, and says so where it does not.

*In plain terms.* While a battle runs the stock package shows one screen: the fight background with the enemies standing on the left and the player's party on the right, a status panel along the bottom edge with each party member's name, HP, SMP and charge, and a short message line above the panel. When a player's charge is full a command box appears in the middle (Fight, the character's own label for special moves, Items, Run). The arrow keys move a cursor, Enter or Space chooses, Esc goes back one step. After an action the numbers it changed float over the fighters for about half a second. A defeated enemy stays where it stood, shown in its "die" pose. Enemies' charge and SMP are never shown.

*Precisely.*

1. **Primitives.** The screen draws only with `fillrect`, `drawrect`, `pixelText`, `bitmap`, `drawcanvas` into the render-now canvas ([E-57](main-loop-and-startup.md#e-57)), plus the non-drawing setup commands `rendernow`, `rendernowenabled`, `createcanvas`, `killcanvas`, `colorrgb` and `fontsize`, and shows each fighter's stance with `pinnedanimation`, `showpinnedanimation` and `endanimation` ([`pinnedanimation`](rpgcode-functions.md#reawakened-pinnedanimation)). It uses no `drawBox`, `drawBar`, `drawenemy`, `drawline`, `setpixel`, or any command not listed. Jensen approved `pinnedanimation` and `endanimation` for fighters; the engine, not the script, advances each fighter's picture.
2. **When there is a screen.** The screen exists when `battlescreensize()` ([rpgcode-functions.md](rpgcode-functions.md)) is not null. A headless run has no screen: a player's charged turn is then skipped exactly as before this entry, and no command of this block is called.
3. **Layout (logical pixels; the screen size is the host's, 640×480 shown).** One data table in the package holds every number below (`stockBattleUi.makeLayout`), so the owner can read the screen as values. Enemies anchor to the top left, players to the top right, the panel to the bottom edge, the menu to the centre, so a larger screen adds space instead of moving a panel off screen.

| Part | Position and size |
|---|---|
| Background | the `.bkg` picture stretched to the whole screen; a flat dark blue when it names none |
| Enemy slot *i* (0 to 3) | top-left corner at x = 40 + 120 × (*i* mod 2), y = 40 + 112 × ⌊*i* / 2⌋, a 64 × 64 picture; its name (8 px font) 3 px below, then a 64 × 6 HP bar; no SMP, no charge |
| Player slot *i* (0 to 4) | a 64 × 64 picture; the first three fill the right edge, top-left corner at x = width − 104, y = 24 + 76 × *i*; members four and five start a second column 76 px further left at y = 24 + 76 × (*i* − 3), so no two pictures — and none against the enemy grid — overlap at the five-member maximum. Name, HP, SMP and charge are in the panel only |
| Command panel | the bottom-left 144 px (x = 8..151, y = height − 132..height − 1), four vertical options (Fight, Special, Items, Run) 26 px high. It persists beneath submenus and targeting: the active command has `>` and a highlighted background; when a submenu (Special, Items) or target selection is open, the chosen command text uses the same yellow (`RGB 255, 224, 64`) as the active party member's name |
| Party status panel | the bottom-right panel adjacent to the command box (x = 160..width − 9, y = height − 132..height − 1); row *i* is 24 px high starting 8 px below its top, so **five** members — [E-85](plugins-and-battle.md#e-85)'s maximum — fit without clipping: name (16 px font), HP bar 112 × 14 at x = 276 with `HP cur/max` inside, SMP bar 96 × 14 at x = 396 with `SP cur/max` inside, charge bar 112 × 14 at x = 500 (whole percent of threshold). The active member's row background is highlighted and its name uses the shared highlight yellow; a fallen member's name is grey |
| Message line | a 20 px strip at height − 132 − 24, full width; empty (not drawn) unless an action is being shown |
| Special / Item list | a description header (the list's title plus the selected entry's own game-authored description) across the top, then a broad two-column list over the field above the panels: up to eight rows per column, 30 px apart, sized to the number of rows, so at most **sixteen entries show at once**. The highlighted row rectangle spans the entire width of its column covering the entry text and its cost/count without clipping the final character. More than sixteen entries are shown a page of sixteen at a time: the page that holds the cursor is drawn, moving the cursor past the last row of a page shows the next page (and wraps from the last entry to the first page), and the header shows `page/pages` at its right edge. Each row shows the entry's label on the left and its cost (`SP 4`) or count (`x3`) on the right, dimmed when it cannot be chosen. The list is drawn over the field, so while it is open the fighters' pictures and the enemies' names and HP bars are not shown (the pictures are engine animations drawn above the canvas and would otherwise cover the list); they return, on the frame their animation has reached, when the list closes |
| Target cursor | When targeting an action, a separate target selection list above the command panel shows eligible targets by name in slot order, including fallen allies when using a healing item or move. **Owner-approved:** a revive is aimed by selecting the fallen ally's name from the list, not by selecting a battlefield picture alone. The command panel remains visible below. Names are not deduplicated (e.g. four R.O.U.S. enemies all appear); repeated names receive a letter suffix (`Name A`, `Name B`, etc.) matching the battlefield label. Up/Down cycles through the full candidate list (wrapping). The active target in the list is highlighted with `>` and the selection background (`RGB 40, 64, 140`), while the corresponding battlefield fighter is simultaneously highlighted with a two-pixel rectangle in the shared highlight yellow (`RGB 255, 224, 64`). Targeting allies shows all party members; targeting enemies shows living enemies |
| Damage numbers | the amount in the 12 px gap directly above the fighter's picture, 8 px font (a number cannot sit on the picture, which the engine draws above the canvas): HP lost in red, HP gained as `+n` in green at the picture's left edge, SMP changed as `SP n` in blue 32 px further right, so a fighter that gains both shows both side by side |

4. **Stances and playback.** A fighter is drawn from the animation its source file names for the stance, through `fighteranimationfile` ([BAT-3](#bat-3), callback 122): `rest` normally, `fight` or `special move` while it is performing that action, `die` while its HP is 0. Each fighter's stance is one **pinned animation** started with `pinnedanimation` at the fighter's slot: the engine owns its playback, so a frame advances exactly once per the animation's stored frame delay (a delay of one tick shows every frame on its own tick), looping stances (rest, fight, special move) loop, and the die stance plays once and holds its last frame. The screen ends and restarts a fighter's animation only when the stance file changes (acting, falling, rising), so the script does no per-tick drawing for animation. A fighter whose file names no animation for the stance is shown with its `rest` animation, and one with no animation at all as a grey outline. Pinned pictures draw above the render-now canvas ([E-57](main-loop-and-startup.md#e-57)), so the canvas carries only what is not a fighter picture (damage numbers sit in the 12 px gap above it, see the layout table). While a Special or Item list is open the pictures are hidden with `showpinnedanimation`, not ended: each keeps its place in its timeline, so a fallen fighter's die pose stays held and the rest frames resume on the same ticks when the list closes. **Owner decision 2 (approved):** engine-owned, tick-exact stance playback through pinned animations replaces static frame 0 pictures.
5. **Redraw.** The frame is composed off screen and shown with one final `drawcanvas`, so a redraw that takes several ticks of script steps never shows half a frame. Target selection may use an additional scratch canvas to preserve a cursor-free base while composing the next selection. The screen is redrawn when a value it shows changes, not on every pass, and a charge bar repaints on its own; it keeps no rule state, only the last values it drew. The reason is measured, not assumed: one drawing command on a 640 × 480 canvas cost 72 ms before the canvas encoder was made faster and 14 ms after, and one full redraw is about 4,300 script steps, more than four ticks of the 1,000-step budget, so redrawing every pass would stretch every pass to five ticks and break the fixed pass rate of [BAT-4](#bat-4). Fighter animation is deliberately **not** part of the redraw: repainting eight fighters from the script was measured at about 1,300 steps per tick even after the canvas work was minimised, which cannot keep a one-tick frame delay, and is why item 4 hands it to the engine. A change to a displayed fighter's name, HP, maximum HP, SMP, maximum SMP or charge, as well as a player cursor move, is on screen within six ticks (a tenth of a second), without another input. This applies both while a menu or result is shown and during idle battle passes. **Owner decision 3 (approved):** redraw when a shown value changes rather than every pass.
6. **Keys.** Only the existing key queue is read, with the names of [E-110](display-input-audio.md#e-110): `UP`, `DOWN`, `LEFT`, `RIGHT`, `ENTER`, `SPACE`, `ESC`. One key is read per tick, so a held key is one move per tick. When the command box opens, keys already buffered are discarded.

| Where | `UP` / `DOWN` | `LEFT` / `RIGHT` | `ENTER` / `SPACE` | `ESC` |
|---|---|---|---|---|
| command box | previous / next command, wrapping | nothing | choose the command | nothing (it opens no menu) |
| special or item list | previous / next entry, wrapping, scrolling | nothing | choose the entry | back to the command box |
| target selection | previous / next target, wrapping | previous / next target, wrapping | perform the action | back to the list (or the command box for Fight) |

7. **Commands and refusals.**
   * **Fight** chooses a target among the **living enemies** (a defeated enemy keeps its slot but is skipped) and performs [BAT-5](#bat-5)'s ordinary attack.
   * **Special** (labelled with the character's own special-move name, "Special" when it has none) lists the moves of the character's file that are available now ([progression-and-levels.md](progression-and-levels.md#special-moves)) and whose own battle byte is 0 ([battle-data.md](../formats/battle-data.md#special-move-spc)), in slot order, each with its SMP cost. A move whose cost exceeds the user's current SMP is listed grey; choosing it plays the "cannot" sound and **the player stays in the list**, nothing is spent and no random number is drawn. **Owner decision 4 (approved):** a move with non-negative FP (damage or status) is aimed at living enemies; a healing move (negative FP, [BAT-5](#bat-5)) is aimed at party members (fallen members included, matching Items so a healing move can revive). The action is performed by [BAT-5](#bat-5)'s special action.
   * **Items** lists the inventory stacks with at least one unit whose item file says it is usable in a fight (`battleinventory`, `battleitemdata(...).usable`), with their counts. Each row is one stack, identified by its item file and handle ([E-81](plugins-and-battle.md#e-81)); two stacks of one file are two rows. The target list is **every party member, fallen members included**, so a healing item raises a fallen ally above 0 HP ([BAT-5](#bat-5): the amount goes through the actor, which clamps to its maximum). The use is [BAT-5](#bat-5)'s item action. **The stack the player chose is the stack that is used:** before anything is applied the screen checks that the chosen stack still has a unit, and refuses the use (the "cannot" sound, the player stays at the target list) when it has none; the use then posts [`battleconsume`](rpgcode-functions.md)'s `inventory.consume` request naming the chosen stack's file and handle, and the inventory owner removes one unit from exactly that stack, so the count shown on that row falls by one after a use and no other row changes.
   * **Run** is always listed. When running is blocked ([BAT-8](#bat-8)) it is drawn grey and struck through; choosing it plays the "cannot" sound and **the player keeps the turn and stays in the command box**. When it is allowed, choosing it performs [BAT-8](#bat-8)'s run (two chances in five), which uses the turn whether it succeeds or not.
   * A command whose list would be empty (no special moves, no usable items) is listed grey and refused the same way as a blocked Run.
8. **After an action.** The screen takes a copy of every fighter's HP and SMP before the action and compares afterwards; the differences are the damage numbers, drawn and then kept for 36 ticks (they leave the screen when the redraw that clears them finishes, about four ticks later) together with a one-line message (`Hero attacks Slime`, `Mage uses fire on Slime`, `Hero uses Potion on Rogue`; for an enemy, `<name> acts`). During those ticks nobody charges ([BAT-4](#bat-4)). An action that changed nothing and has no message costs no ticks. Status effects that change HP between turns are shown by the bars, not by numbers.
9. **Sounds.** The `.bkg`'s menu-move sound plays when a cursor moves, its choose sound when a choice is made (a command, a list entry, a target), and its "cannot" sound on every refusal above, through `mediaPlay` on the `ui` track ([BAT-10](#bat-10)); a missing sound is silent. The "fighter ready" sound and the combat sounds belong to entry 7.10.
10. **The overlay belongs to the game.** The screen borrows the reserved render-now canvas ([E-57](main-loop-and-startup.md#e-57)) for the length of the battle, and a game may already be using it for its own HUD. When the screen starts it reads `rendernowenabled()` and, if the canvas exists, copies its pixels to a private canvas; when it ends it puts those pixels back, restores the on/off flag, and leaves the canvas in place (a canvas the battle itself created is left cleared and switched off). The battle's frames overdraw the game's HUD while it runs, and a game script that draws on the overlay during a battle is overdrawn too: during a battle the screen owns the overlay.
11. **What the screen reads and writes.** It reads the battle and the actors and the data commands `battlebackgrounddata`, `battlecharacterdata` (its special-move list), `battleinventory`, `battleitemdata`, `battlemovedata` and `fighteranimationfile`; the only writes are the package's own action functions that the player's choice calls, and the key queue. It never changes a battle value to draw it.
12. **Golden frames (G5).** Five frames of one seeded battle (seed 291; Slime, Bat, Slime against Hero, Mage, Rogue, the Rogue fallen, the Bat forbidding running), reached by a fixed key script, are recorded in `golden/battle-ui/frames.json` with their images in `golden/battle-ui/*.png`: `command` (the command box with Run blocked), `special` (the Magic list with full-width row highlight and persistent bottom-left command context), `target` (choosing a Fight target by name with disambiguated enemy names and fighter highlight), `revive` (a Potion aimed at the fallen Rogue with ally target list and fighter highlight), and `defeated` (a defeated enemy holding its die pose). The test compares the frame's pixels exactly. The frames change only in a pull request that says why; `BATTLE_UI_GOLDEN=record` rewrites them deliberately.

13. **Not in this entry.** Party portraits (the `.cha` profile picture is not read), enemy HP numbers, attack and effect animations, scrolling messages longer than one line, and the "fighter ready" cue. **Owner decision 5 (approved):** the screen shows each enemy's HP bar and hides enemy charge and SMP.

*Rejected alternatives:* redrawing the whole screen every pass (above, measured); drawing sprites with `bitmap` (a fighter's picture file is not readable by a script, only the animation file name); repainting the fighters from the script each tick (measured above); raising the per-tick step budget; opening the Epic 8 menu for Items (it is a menu screen, not a battle choice, and is not on this entry's boundary); a second input device abstraction.

*Evidence:* Jensen's 2026-10-28 approval of the complete BAT-11 screen; the owner-approved primitive boundary at entry 7.1; the existing draw-command catalogue in [rpgcode-functions.md](rpgcode-functions.md). The layout and golden frame remain scoped to entry 7.11. *Rejected:* new screen primitives for the first UI, which would widen the rendering core before a second use.

<a id="bat-12"></a>
## BAT-12 — Events and `defeated`

**Reawakened rule (OWNER; Jensen, 2026-10-19).**

* `beforeDamage` is sent by the package's battle thread as `emitCancelable` on the target actor with plain detail `{ source (actor id or null), target (actor id), damage }`, for every damage path ([BAT-5](#bat-5), entry 7.14).
* `fallen` is the core's actor event, fired once on the transition into fallen with `{ cause, source }` ([actors.md](actors.md#standard-actor-and-board-events)).
* `defeated` is emitted by the package on an enemy actor **once per enemy per battle**, when it first reaches 0 HP, with `{ cause: "damage" | "status" | "script", source: actorId | null }`. A run emits none; a lost battle emits none for the players. A defeated enemy stays in its slot as an inactive fighter (R11-Q9); it stops charging and acting at once and the AI ignores it.
* The package re-emits it on the game as **`stock_battle.defeated`** (EMIT-8 and EMIT-13: a package event on a shared emitter carries the package namespace). There is no `battle` emitter.
* The legacy `fightInform` codes map to the package's own events or data: 0 and 1 (HP, SMP removed) to damage and drain results, 2 (attacked), 3 (special), 4 (item) and 5 (fully charged) to package notifications, 6 (died) to `defeated`, 7 (party defeated) to the loss check. 3.1 never sent 6 or 7; the rebuild does not repeat that gap.

*Evidence:* [EMIT-13](rpgcode-modules-and-objects.md#emit-13); `packages/core/test/battle-outcomes-stock.test.ts` — “enemy defeated emits once locally before game re-emission for each enemy, including after event-queue restore”. *Rejected:* a `battle` emitter object (EMIT-8 forbids new built-in emitters without need).

<a id="bat-13"></a>
## BAT-13 — Save, restore and reset (OWNER)

**Reawakened rule (OWNER; Jensen, 2026-10-26).** The live `battle` section ([BAT-2](#bat-2)) stores the fighters and charge, is validated on load with located diagnostics, and is cleared by reset. Its schema version follows the save schema-bump rule. The former schema-v1 empty placeholder remains supported by the migration and its restorable fixture; the live section is no longer an empty placeholder. The battle thread and its parked waits are VM state (G1). Statuses live in the actor section. A mid-battle save restores the same fighters, charge, background, `canRun` and outcome with an identical state hash. Battle playback is not part of `BattleSection`; playback is saved by the independent audio section ([audio-media.md#audio-save-load](audio-media.md#audio-save-load)).

*Evidence:* [BAT-2](#bat-2), G1, the schema-v1 migration fixture, and [audio-media.md#audio-save-load](audio-media.md#audio-save-load). *Rejected:* removing the schema-v1 migration with the live placeholder, or storing playback or UI state in `BattleSection`; the former breaks old-save compatibility and the latter duplicates audio/model ownership.

<a id="bat-14"></a>
## BAT-14 — Package loading and the no-package path (OWNER)

**Reawakened rule (OWNER; Jensen, 2026-10-25).** The `stock_battle` package loads by name from the manifest and `.gam` (the legacy `tk3fight.dll` row maps to it in memory). When no battle package is loaded, a battle start ends at once with a diagnostic instead of hanging, matching the 3.1 rule that without a battle plugin battles end immediately: a drawn encounter reports `battle.package-missing` and starts nothing, a custom encounter still runs its program ([BAT-9](#bat-9)), and a program's `Fight` or `FightEnemy` call is the catchable `battle.package-missing`. A missing package never refuses a load.

*Evidence:* [E-71](plugins-and-battle.md#e-71); `packages/core/test/battle-start.test.ts`; `packages/core/test/engine.test.ts` — “engine displays no-enemies handoffs, runs custom starts as a program, and rejects absent stock_battle”. *Rejected:* refusing game load because the battle package is absent, or allowing a start to hang or fall through into an unregistered handler.

<a id="bat-15"></a>
## BAT-15 — Determinism, hazards not reproduced, and golden policy (OWNER)

**Reawakened rule (OWNER; Jensen, 2026-10-25).** Battles use only the seeded shared RNG and tick-counted waits (G3); a draw-list or save golden changes only in a pull request that says why (G5).

**Hazards recorded and not reproduced** (R11-Q4, Q5, Q12, and the status note of [BAT-6](#bat-6)): the empty-target division after the party falls mid-pass; the maximum-level experience retry; the wrap-around of a status with fewer than 1 round; the cancellation of a player's self-disable at turn end. **Hazards reproduced and documented for authors:** a charge rate of 0 or less; a disable that nothing removes.

**Unverified in the source (R11 "Not verified").** The real-time length of a 3.1 tick; the quality of the legacy random generator; whether opening a `.spc` in the 3.1 editor flips its flags on re-save; whether the legacy help describes any of this differently; and third-party battle add-ons.

*Evidence:* G3 and G5; the seeded draw and tick-wait contracts in [BAT-4](#bat-4) and [BAT-8](#bat-8). *Rejected:* wall-clock timers or unseeded randomness, which break replay determinism, and changing a draw-list or save golden without a reviewable explanation, which violates G5.
