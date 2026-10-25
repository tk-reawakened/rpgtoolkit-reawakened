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

**Reawakened rule (OWNER; Jensen, 2026-10-19).** The core owns the actor model ([actors.md](actors.md)) and the `battle` section ([BAT-2](#bat-2)): who is in the fight and each fighter's charge. The `stock_battle` package owns the loop and tick ([BAT-4](#bat-4)), the charge rate, damage, status round effects, enemy AI, the sequence that follows an outcome, battle music cues and the UI. There is no core battle phase, no core rules engine and no core `fightTick`. The one battle-specific operation the core keeps is the compatibility adapter of [BAT-8](#bat-8), so a custom fight program written for 3.1's outcome codes still receives rewards.

*Evidence:* the 2026-10-19 owner decision in the Epic 20 notes; [actors.md](actors.md#core-and-battle-boundary). *Rejected:* a core rules engine behind the default UI, which gives two rule owners and stops a replacement from being a real replacement.

<a id="bat-2"></a>
## BAT-2 — The `battle` section (OWNER)

**Reawakened rule.** The section is `null` when no battle is active, otherwise one record:

| Field | Type | Meaning |
|---|---|---|
| `id` | integer | A battle number from the battle owner's counter, never reused in a run. |
| `boardKey` | string | The board the battle started on; the board's music is re-posted from it at the end ([BAT-10](#bat-10)). |
| `background` | string | The `.bkg` file name ([battle-data.md](../formats/battle-data.md#fight-background-bkg)). |
| `canRun` | boolean | True unless an enemy forbids running ([BAT-8](#bat-8)). |
| `outcome` | 0–4 or `null` | Set once by `finish` ([BAT-3](#bat-3)); `null` while the fight is live. |
| `parties` | two ordered arrays | Party 0 is the enemies, party 1 is the player's party; each entry is `{ party, actorId, charge }`. |

Status effects, HP, SMP, FP and DP stay on the actor and are never copied here. The array order is the turn-order tie-break ([BAT-4](#bat-4)). A dangling `actorId` or a repeated `(party, actorId)` pair is a located load diagnostic; the entry is kept and marked unusable, so a later script can repair it, and the loop skips it as not living. `reset()` clears the section.

*Evidence:* AD-10; [actors.md](actors.md#actor-data-and-identity). *Rejected:* a battle-local copy of stats, which needs a merge rule and breaks the one-owner rule of ACT-3.

<a id="bat-3"></a>
## BAT-3 — The facing API and the callback mapping (OWNER)

**Reawakened rule.** A battle package or custom fight program reaches the battle through one global `battle` object plus the actor's own stat and status methods. No `fight*` callback table exists.

| Operation | Meaning |
|---|---|
| `battle.partySize(party)` | Number of entries in party 0 or 1. |
| `battle.fighter(party, index)` | The actor object at that position. |
| `battle.charge(party, index)`, `addCharge`, `setCharge`, `releaseCharge` | Read, add to, set, or reset to 0 the stored charge. |
| `battle.chargePercent(party, index)` | The charge as a whole percent of the fighter's threshold, clamped 0 to 100. |
| `battle.canRun` | The section's flag, read only by the package. |
| `battle.outcome`, `battle.finish(code)` | `finish` validates 0 to 4 and writes `outcome`; a second `finish` is the catchable `battle.already-finished`. |

A fighter handle in a script is `source`, `target`, a party-member name, or an enemy reference `{ party: 0, index }`; an unknown handle, a bad party or an out-of-range index is the catchable `battle.bad-fighter`.

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

**Reawakened rule — one battle thread, one pass per engine tick (OWNER; Jensen, 2026-10-25).** The package runs the whole battle on **one RPGCode thread**. Each pass takes at least one engine tick (`threadSleep(getThreadId(), 1/60)`, converted by the ruled `max(1, floor(seconds * 60 + 0.5))`), so the rate is fixed at 60 passes a second and is a Reawakened choice, not parity (R11-Q2 gives no real rate). Because a turn runs inside the pass and its waits park the one thread, nobody charges while a turn is in progress, exactly as in 3.1. A turn's waits spread its steps over many ticks, so the single thread's cost per tick is the idle advance plus one fighter's step, well inside `STEP_BUDGET`: the step-budget spike measured about 40 steps per fighter for an idle step, so nine fighters cost about 360 steps [INFERENCE from [the spike](../../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-platform/discovery/step-budget-spike.md)]. The spike's "one thread per fighter" condition addressed fighters acting *at the same time*, which 3.1 never does; a pass that is preempted resumes next tick and is late, not wrong.

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

**Legacy and Reawakened rule — items (R11-Q7).** The item's battle HP and SMP values are added to the target and the result is kept between 0 and the target's maximum. No luck, critical or DP. One copy leaves the inventory through a posted consume effect (never by editing the list), and the item's battle program runs after its animation.

`attackall` and `drainall` deal their amount to each living target without a critical test. Damage and heals go through the actor's `damage` operation, so `fallen` fires once per lethal hit; before it, the package sends the cancelable `beforeDamage` on the battle thread ([BAT-12](#bat-12), entry 7.14).

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

*Evidence:* [R11-Q5, Q6](../../provenance/facts-round-11.md); E-75; [battle-data.md](../formats/battle-data.md#status-effect-ste). *Rejected:* aging every actor's statuses each tick (3.1 ages per turn, which is why disable is strong); and a floor of 0 on the rate, which 3.1 does not have.

<a id="bat-7"></a>
## BAT-7 — Enemy AI

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

**Reawakened rule.** The coin is one seeded draw from {0, 1}. The draw order is the coin, then the special-move pick, then the target, then the combat draws of BAT-5 (a Reawakened choice; the original's order is not recorded). The built-in `ai(level)` sets the level of the acting enemy and rejects a level outside 0 to 3 with a catchable error, instead of silently doing nothing. When no living player remains, an AI turn is skipped: 3.1 divides by zero on an empty target pick after the party falls mid-pass (R11-Q4), which is not reproduced. An error in a custom AI program is reported and ends only that turn.

*Evidence:* [R11-Q8, Q9, Q10](../../provenance/facts-round-11.md); E-76. *Rejected:* an engine-side AI, which would stop a custom fight program from replacing it.

<a id="bat-8"></a>
## BAT-8 — Outcomes, running, rewards and losing

**Outcome codes (legacy, unchanged).** 0 ran away (automatic), 1 ran away (handled by the package), 2 won (automatic), 3 won (handled by the package), 4 lost.

**Legacy (R11-Q11, Q12, Q13).**

* **Run.** If any one enemy forbids running, running is blocked for the whole fight; the menu still lists Run but draws it differently, choosing it plays the cancel sound and keeps the turn. When allowed, the default battle system succeeds **2 times in 5**; a failed attempt shows a message and uses the turn. A success shows a message and the battle ends at the start of the next pass; nobody else takes a turn, though other charged players in that pass still have their statuses tick. If that leaves every player at 0 HP the battle is a loss, not an escape. After a successful escape the engine runs one run program: the **last enemy, in encounter order, that has one**. No rewards.
* **Win.** The enemies' experience and gold are each summed. In order: the gold is added silently; a message gives the experience total if above 0; each party member in party order, fallen included, receives the **full** experience total, and for each level gained the level-up program runs if there is one, the stats rise, and a short level-gained message is shown (not at maximum level); a message gives the gold total if above 0; then the win program of the **last enemy, in encounter order, that has one** runs (only that one).
* **Lose.** Every player at 0 HP or below, checked between passes, before the win check, so a simultaneous fall is a loss. If a game-over program exists it runs instead of the reset and the engine does not reset afterwards; without one a game-over message shows and the game resets. In every outcome the board music then returns and the screen is redrawn.

**Reawakened rule (OWNER; Jensen, 2026-10-25).** The compatibility adapter. `battle.finish(code)` records the outcome. For 0, 2 and 4 the core then performs the sequence above using only generic operations that already exist: the actors' experience award (which handles level-ups and the maximum-level case, [progression-and-levels.md](progression-and-levels.md#maximum-level)), one plain-data gold effect for Epic 8's inventory, the message path, running the named program, and `reset()`. For 1 and 3 the core does nothing: the package or custom program has handled it. The stock package uses the same adapter. This is the only battle-specific operation in the core; it exists so a fight program written for 3.1's outcome codes needs nothing more. The success chance is one seeded draw in `[0, 5)` with 0 and 1 succeeding. A blocked Run does not spend the turn; `battle.finish(0)` while `canRun` is false is the catchable `battle.cannot-run`.

**Departure.** The maximum-level freeze recorded in R11-Q12 (a character at maximum level given enough experience retries forever) is not reproduced; the actor owner terminates safely there.

*Evidence:* [R11-Q11 to Q13](../../provenance/facts-round-11.md); E-77; [progression-and-levels.md](progression-and-levels.md). *Rejected:* a purely package-owned reward sequence, because a custom fight program with no package present would then receive no rewards and E-79 ("a script can build its own battle screen without a second rules engine") would fail.

<a id="bat-9"></a>
## BAT-9 — Starting a battle and the party sources

**Legacy (R11-Q14).** `Fight(skill, background)` draws **1 to 4** enemies, each count equally likely; each enemy is drawn on its own with equal chances from the main file's enemy-list entries whose skill level matches (the same enemy may repeat, and an entry listed twice is twice as likely). If no entry matches, an error message box appears (the E-70 message) and no fight starts. A random encounter uses exactly this draw with the board's skill level and background, unless the game names its own fight program. The whole party takes part, **every occupied slot, fallen members included, who start fallen**. `FightEnemy` sets up the same way, so any enemy can still forbid running and its programs still apply.

**Reawakened rule.** The 5.11 encounter handoff supplies the drawn enemies, background and board; the start path hydrates the enemies ([actors.md](actors.md)) as party 0, takes party 1 from the actor store's ordered party, writes the section ([BAT-2](#bat-2)) and starts the registered `battle` command or the main file's custom fight program, then waits for the outcome. `skill` is always −1 on the random path, as in 3.1. An empty party is a located error. A main-file custom fight program replaces the package's loop and uses the same section and the same outcome adapter. The no-enemies message is shown by the start path and no battle begins.

*Evidence:* [R11-Q14](../../provenance/facts-round-11.md); E-70, E-71. *Rejected:* the package choosing enemies, which would give random starts two implementations.

<a id="bat-10"></a>
## BAT-10 — Battle music and sounds

**Reawakened rule.** The package plays the background's music through the media object with source `battle` (Epic 21); a `beforePlay` listener may replace or cancel it. A fight stops the board's music and has no fallback (audio facts, round 8 Q8); at the end the battle track stops and the board's music is re-posted from `boardKey`, restarting from the beginning (round 8 Q9) or silent if the board had none. Menu and battle cues are voices that mix over the music and never stop it. Audio is never saved: a mid-battle load stops any stale track and plays the battle track again. A missing cue is silent.

*Evidence:* [audio-media.md](audio-media.md); [battle-data.md](../formats/battle-data.md#fight-background-bkg). *Rejected:* saving audio state, which would make a loaded battle claim a track the runner is not playing.

<a id="bat-11"></a>
## BAT-11 — The default battle UI (OWNER, with the owner's approval of the screen at 7.11)

**Reawakened rule.** The default UI draws only with the existing 3.1 primitives (`fillrect`, `drawrect`, `text`, `pixelText`, `bitmap`, `drawcanvas`, `rendernow`) and reads the existing key queue; no `drawBox` or `drawBar` is added. It redraws from the state each pass, keeps no animation state of its own, and never mutates the battle. Layout and the golden frame are ruled by entry 7.11 with the owner's approval.

*Rejected:* new screen primitives for the first UI, which would widen the rendering core before a second use.

<a id="bat-12"></a>
## BAT-12 — Events and `defeated`

**Reawakened rule (OWNER, 2026-10-19).**

* `beforeDamage` is sent by the package's battle thread as `emitCancelable` on the target actor with plain detail `{ source (actor id or null), target (actor id), damage }`, for every damage path ([BAT-5](#bat-5), entry 7.14).
* `fallen` is the core's actor event, fired once on the transition into fallen with `{ cause, source }` ([actors.md](actors.md#standard-actor-and-board-events)).
* `defeated` is emitted by the package on an enemy actor **once per enemy per battle**, when it first reaches 0 HP, with `{ cause: "damage" | "status" | "script", source: actorId | null }`. A run emits none; a lost battle emits none for the players. A defeated enemy stays in its slot as an inactive fighter (R11-Q9); it stops charging and acting at once and the AI ignores it.
* The package re-emits it on the game as **`stock_battle.defeated`** (EMIT-8 and EMIT-13: a package event on a shared emitter carries the package namespace). There is no `battle` emitter.
* The legacy `fightInform` codes map to the package's own events or data: 0 and 1 (HP, SMP removed) to damage and drain results, 2 (attacked), 3 (special), 4 (item) and 5 (fully charged) to package notifications, 6 (died) to `defeated`, 7 (party defeated) to the loss check. 3.1 never sent 6 or 7; the rebuild does not repeat that gap.

*Rejected:* a `battle` emitter object (EMIT-8 forbids new built-in emitters without need).

<a id="bat-13"></a>
## BAT-13 — Save, restore and reset

**Reawakened rule.** The `battle` section ([BAT-2](#bat-2)) is saved with the fighters and charge, validated on load with located diagnostics, and cleared by reset. The save schema version of the section moves from the empty placeholder under the save schema-bump rule, with a restorable fixture of the old shape. The battle thread and its parked waits are VM state (G1). Statuses live in the actor section. A mid-battle save restores the same fighters, charge, background, `canRun` and outcome with an identical state hash.

*Rejected:* saving audio or UI state.

<a id="bat-14"></a>
## BAT-14 — Package loading and the no-package path

**Reawakened rule.** The `stock_battle` package loads by name from the manifest and `.gam` (the legacy `tk3fight.dll` row maps to it in memory). When no battle package is loaded and the game has no custom fight program, a battle ends at once with a diagnostic instead of hanging, matching the 3.1 rule that without a battle plugin battles end immediately. A missing package never refuses a load.

<a id="bat-15"></a>
## BAT-15 — Determinism, hazards not reproduced, and golden policy

**Reawakened rule.** Battles use only the seeded shared RNG and tick-counted waits (G3); a draw-list or save golden changes only in a pull request that says why (G5).

**Hazards recorded and not reproduced** (R11-Q4, Q5, Q12, and the status note of [BAT-6](#bat-6)): the empty-target division after the party falls mid-pass; the maximum-level experience retry; the wrap-around of a status with fewer than 1 round; the cancellation of a player's self-disable at turn end. **Hazards reproduced and documented for authors:** a charge rate of 0 or less; a disable that nothing removes.

**Unverified in the source (R11 "Not verified").** The real-time length of a 3.1 tick; the quality of the legacy random generator; whether opening a `.spc` in the 3.1 editor flips its flags on re-save; whether the legacy help describes any of this differently; and third-party battle add-ons.
