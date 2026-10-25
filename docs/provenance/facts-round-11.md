<!-- Clean-room extraction round: battle behaviour (ADR 0006). Review status: REVIEWED. Two independent agents checked it: a clean-room reviewer (no copied expression, identifiers or quoted messages found; corrected Q2, Q4, Q5, Q9-Q13, Q15) and a fact-checker (claims checked against 2f986f3e and 9191b919; corrected the special-move animation order in Q7 and the battle-speed setter in Q2). All corrections applied and spot-checked against the source. -->

# Clean-Room Extraction: Toolkit 3 Battle Behaviour

## Versions consulted
- Shipped 3.1.0 release (2007-09-28)
- Final source (engine last changed 2010-01-12, never released)

The battle engine and the default battle system shipped with 3.1 are the same in both versions for everything below.

## Terms
- **Engine**: the game runtime. It holds the fighters, their charge and statuses, does the damage arithmetic, runs the internal enemy AI, and hands out rewards.
- **Default battle system**: the replaceable battle add-on that shipped with 3.1. It draws the battle, runs the main loop, shows the player menus, rolls for running away, and decides when the fight is won or lost. A game could ship a different one; where an answer depends on this layer, it says so.
- **Tick**: one step of the default battle system's main loop, in which the engine advances every fighter once.
- **Threshold**: the charge a fighter needs before it gets a turn (75 for players, 123 for enemies).

Confidence words follow the request: **certain** (read from the program's logic), **fairly sure** (read, but some reasoning across several parts or not run), **guessing**.

---

## Priority 1

### 1. Initial charge
- Every fighter starts at a random whole number from 0 to one below its threshold: 0 to 74 for players, 0 to 122 for enemies. Each fighter gets its own draw.
- Fallen players get a starting charge too, but it does not grow while they are fallen.
- Every fighter starts with a charge gain of 3 per tick.
- **Default: correct.** Certain.

### 2. What a tick is
- A tick is not tied to a clock. It is one pass of the default battle system's main loop. Each pass first ends the battle if it has been decided: a loss is checked before a win, and both before a successful escape. It then redraws the battle screen, shows any revived fighters, advances every fighter once, and briefly lets the operating system handle input.
- That loop has no timer, sleep, or frame cap of its own. The real-time rate therefore depends on machine speed and on how long it takes to redraw the screen.
- In one step, each living, unfrozen fighter below its threshold gains its current speed (3, adjusted by speed and slow statuses; see 6).
- The battle-speed setting from older versions does nothing in 3.x. Reading it always gives 0. A battle add-on that sets it is ignored, and the script command that used to set it stops with an error. Certain.
- **Default (one step per 1/60 second): not what the original does.** Certain about the structure. Guessing about the actual rate in real time, because I did not check whether drawing to the screen waits for the display refresh.

### 3. While someone is choosing or acting
- **Everything waits.** Turns run inside the tick. When the engine reaches a charged fighter, that fighter's whole turn (menu, target choice, animations, damage numbers, messages) finishes before the tick goes on. Nobody gains charge while the menu is open or while any animation plays, whether it is a player's or an enemy's.
- A charged player stays at full charge until their action is done. Their charge then goes back to 0. An enemy's charge goes back to 0 straight after it acts. Charge above the threshold is not carried over.
- In the engine, charge only advances when the battle system asks for a tick. A different battle add-on could pace things differently, but the default one always waits.
- **Default (others keep charging): wrong.** Certain.

### 4. Several fighters ready at once
- In each tick the engine goes through all enemies in their party order, then all players in party order.
- A fighter whose charge is already at or above its threshold when the engine reaches it takes its turn on the spot. A fighter that crosses the threshold during this tick's charging waits until the next tick to act.
- Several enemies, and several players, can act in the same tick, one after another. Each turn finishes completely before the next one starts.
- Whether the fight is over is only checked between ticks. If the fight is decided partway through a tick, fighters later in that tick still get their turns. Certain.
- One consequence: if the last living player falls partway through a tick, a later enemy that picks its target at random (levels 0 and 1, and every enemy with its own AI program) picks from an empty set, and the program divides by zero. Certain that the empty pick happens; guessing that the result is a crash. Levels 2 and 3 are not affected: they fall back to the first party slot.
- **Default (enemies first, then party order): correct.** Certain.

### 5. Status effects: when a round passes
**a) When it ticks.** A status ticks once per turn of the fighter carrying it. This happens in the tick where the engine finds that fighter fully charged, just before its turn. The charge resets after the turn, so it cannot tick again until the fighter charges up again. It does not keep ticking while a player's menu is open, because everything is paused then (see 3). Certain.

**b) Order within a round.** For each status, in this order:
1. If the status has its HP option on, its HP amount is applied.
2. Likewise for SMP.
3. Its program runs, if it has one.
4. Its round count goes down by one.
5. If the count is now 0, the status is removed and its speed, slow, or disable effect is undone.

So a status with N rounds takes effect N times, and one with 1 round left takes effect once more and then ends. Certain.

Further points:
- A status whose file gives 0 rounds or fewer does not wear off in any practical battle: its counter only gets back to 0 after about 65,000 of that fighter's turns. Certain that it does not end in normal play; fairly sure about the wrap-around, which depends on the compiler.
- The HP and SMP changes are subtracted from the fighter and stop at 0. Nothing caps them at the fighter's maximum, so a negative amount heals past maximum. Fairly sure.
- When a fighter has several statuses, they tick in order of their file names compared in upper case, character by character. So letters ignore case, but symbols such as an underscore sort after all letters. Fairly sure.
- If a status knocks the fighter to 0 HP, that turn still goes ahead. An enemy's internal-AI action does nothing, because a fallen attacker's attacks and moves are ignored. An enemy with its own AI program still runs that program. A player still gets the menu, but attacks, moves and items do nothing; Run still works. Fairly sure.
- All statuses end when the battle ends. They exist only inside a battle. Certain.

**c) Disable.** A disabled fighter's charge stops growing. If it was already at or above its threshold, it is set to one below. So the fighter never becomes charged, its statuses never tick, and the disable never runs out on its own. It ends only when something removes that status from outside (a script or the battle system) or when the battle ends. With several disabling statuses, the fighter is frozen until all of them are gone. Certain about the mechanism; fairly sure that nothing in the default battle system removes it.

Exception: if a disable lands on a player during that player's own turn (for example a move they aim at themselves, or a program run by that move or item), the end of the turn cancels the freeze. That player keeps charging, and the status then counts down and ends like any other. Enemies are not affected. Certain.

- **Default:** the order is wrong, because the effect is applied first and the count is reduced afterwards. The disable part is correct, with the consequence above.

### 6. Stacking status effects
- Each speed status adds 2 to the fighter's charge gain per tick, and each slow status takes 2 away. Different status files add up: two speed-ups give +4, and a speed-up plus a slow-down give 0. Certain.
- There is no floor and no ceiling. At 0 the fighter never charges, and so its statuses never tick again. Below 0 its charge goes down every tick and can go below zero. Fairly sure.
- Applying a status file the fighter already has (names compared ignoring case) restarts it: the old copy's speed, slow, or disable effect is undone, and the file is read again, so the round count goes back to the file's value. Counts are not added, and the effect is not doubled. Certain.
- **Default:** the effects do sum, and re-applying does restart. The floor at 0 is wrong: there is none.

### 7. Special moves and items: damage
- **Ordinary attack:** as already recorded in facts round 10 (luck swing, DP test, minimum 1). This round found nothing that disagrees.
- **Special moves:** no luck swing, no critical test, and no DP. The move's FP value is taken off the target's HP, its target-SMP value off the target's SMP, and its SMP cost off the user's SMP. Each of these stops at 0. There is no minimum of 1, so a move with 0 FP does no damage. Nothing caps them at maximum, so a move with negative FP heals and can push HP above maximum, for players and enemies alike. Certain.
- The default battle system then plays the user's special-move animation, then the move's own animation over the target, runs the move's program, applies the move's status effect to the target, and finally shows the damage. Certain.
- The default battle system refuses a move whose cost is more than the player's current SMP; the player stays in the menu. Enemies only choose moves they can afford (see 8). Certain.
- **Items:** the item's battle HP and SMP values are added to the target, then kept between 0 and the target's maximum. Items cannot overheal, and a negative value hurts but stops at 0. There is no luck, critical, or DP. One copy is taken from the inventory, and the default battle system runs the item's battle program after its animation. Certain.
- **Default:** right that there is no luck, critical, or DP. "Exactly as the file states" needs two corrections: special moves have no upper cap, and items are capped at maximum.

---

## Priority 2: enemy AI

All of this is in the engine, not the battle add-on.

**Overview of the levels:**
- **Level 0:** each turn a fair coin decides. Heads: an ordinary attack on a random living player. Tails: try a special move.
- **Level 1:** always try a special move. Targets are random.
- **Level 2:** like level 0, but targets are chosen by "weakest".
- **Level 3:** like level 1, but targets are chosen by "weakest".
- **Trying a special move:** pick at random, with equal chances, from the enemy's specials whose SMP cost is no more than its current SMP. The "usable in battle" flag is not checked. If no special qualifies, it makes an ordinary attack instead, using the same target rule.
- Enemies never defend or rest. An AI level outside 0 to 3 makes the enemy do nothing on its turn.

Certain for all of the above.

**a)** Level 1 picks a random living player, each with an equal chance, for a harmful move. For a healing move it picks a random living ally (see d). Certain.

**b)** "Weakest" means the lowest current HP, not the lowest share of maximum. Fallen fighters are skipped. On a tie, the earlier party position wins. Certain.

**c)** It makes an ordinary attack on the target its level would choose. Certain.

**d)** A special with FP below zero counts as healing. FP of exactly 0 counts as harmful. A healing move goes to the enemy's own side:
- at levels 0 and 1, to a random living ally, which may be the enemy itself or someone at full HP;
- at levels 2 and 3, to the living ally with the lowest current HP.

Certain.

**e)** The coin is an even/odd split of the C runtime's random number. Certain about that split; guessing about how fair it is in practice, because that depends on the library's generator, which I did not check.

**Default:** correct, except the healing target. The lowest-HP ally is chosen only at levels 2 and 3; levels 0 and 1 choose at random.

### 9. Fallen fighters
- **Targeting:** the internal AI never picks a fallen player, and the target handed to a custom AI program is a living player whenever one exists (see 4 for the case where none does). The engine does not refuse damage to a fallen target if a script names one directly. Certain.
- **Charging:** fallen fighters do not charge. Their charge is kept where it was when they fell. Certain.
- **Revival:** yes. In the default battle system's target cursor, the player can land on fallen allies, so a healing item revives them. Anything else that raises HP above 0 also works. The default battle system notices at the start of the next tick and shows the fighter normally again, and its charge carries on from where it stopped. Players who start the battle at 0 HP start fallen and can be revived the same way. The internal AI never revives anyone, because enemy healing only goes to living allies. Certain.
- **Defeated enemies** stay in their slot; they are not taken out of the fight. They stop charging and acting at once, the internal AI ignores them, and the player's cursor mostly skips them. Their death animation plays the next time the screen is drawn. The battle ends only at the start of the next tick, once every enemy is at 0 HP (see 4). Certain, apart from the cursor detail, which is fairly sure.
- **Default:** mostly correct. The one change is that defeated enemies stay in the fight as inactive fighters, rather than leaving it.

### 10. Custom AI program
- On the enemy's turn the engine sets the enemy as source and a random living player as target (see 4 if none is left), then runs the program and does nothing more. The program must act itself: it can attack, use a move or an item through script commands, or hand over to an internal AI level. It may also choose a different target.
- If it does nothing, the turn is spent and the enemy's charge goes back to 0.
- **Default: correct.** Certain.

---

## Priority 3: starts and outcomes

### 11. Running away
- If any one enemy in the fight forbids running, running is blocked for the whole fight. This is the engine's rule. Certain.
- **When blocked:** the default battle system still lists Run, but draws it differently. Picking it only plays the cancel sound, and the player stays in the menu without losing the turn. Certain.
- **When allowed:** running can fail. The default battle system succeeds 2 times in 5. Certain.
  - A failed attempt shows a message and uses up the turn.
  - A successful attempt shows a message, and the battle ends at the start of the next tick.
  - After a successful escape, no one else takes a turn. Players later in the same tick who were also fully charged still have their statuses tick, with nothing shown. If that leaves the whole party at 0 HP, the battle ends as a loss, not an escape. Fairly sure.
- After a successful run, the engine runs one run program: that of the last enemy, in encounter order, that has one. There are no rewards. Certain.
- **Default:** right that any one enemy blocks running. "Always succeeds" is wrong: the chance is 40%, and a failed attempt costs the turn.

### 12. Rewards
- The experience and gold of all enemies in the fight are added up.
- Every party member, fallen ones included, gets the full experience total. It is not shared out.
- The gold total is added once.
- **Order:**
  1. The gold is added to the purse, silently.
  2. A message gives the experience total, if it is above 0.
  3. Each member in party order receives the experience. For each level gained: that character's level-up program runs, if there is one; the level and stats go up; then the engine shows its own short message box saying that the character gained a level. The message is not shown when the character is already at the maximum level.
  4. A message gives the gold total, if it is above 0.
  5. The win program of the last enemy, in encounter order, that has one runs. Only one runs; enemies do not each get theirs.

  Certain.
- **Hazard:** a character already at the maximum level who receives enough experience to reach the next threshold freezes the game. The engine keeps retrying the level-up forever, and runs that character's level-up program on every retry. This happens whether or not a program exists. Certain from the logic; not run.
- **Default:** right that every member gets the full total, fallen ones included. The order is wrong: the experience message comes first, then each character's level-ups (each with its program, if any, then a built-in level-gained message), then the gold message, then a single win program.

### 13. Losing
- The fight is lost when every player in the battle is at 0 HP or below. Nothing else counts. It is checked between ticks, before the win check, so if both sides fall at the same moment it is a loss. This is the default battle system's rule. Certain.
- **If a game-over program exists,** it runs instead of the reset. The engine does not reset afterwards, and what happens next is up to the program. Certain.
- **Without one,** a game-over message is shown and the game resets to its start. Certain.
- Either way (and also after a win or an escape), the board music then comes back and the scene is redrawn. Certain.
- **Default: correct.**

### 14. Starting a fight from a script
**a)** The number of enemies is 1 to 4, each count equally likely. Each enemy is drawn on its own, with equal chances, from the game's enemy list entries whose skill level matches. The same enemy can appear more than once, and an enemy listed twice is twice as likely. If no enemy has that skill level, an error message box appears and no fight starts. Random encounters use exactly this draw, with the board's skill level and background, unless the game has set its own encounter program, which then runs instead. Certain.

**b)** The whole party takes part: every occupied party slot. Fallen members are included and start fallen. Certain.

**c)** Yes. Naming the enemies directly goes through the same setup, so any one of them can still forbid running, and their run and win programs still apply. Certain.

**Default: correct.**

---

## Optional

### 15. Special-move "usable in battle" and "usable from menu"
- When the editor's "usable in battle" checkbox is ticked, the stored byte is **0**. Unticked stores 1. The menu flag works the same way; in the editor its checkbox is labelled for use on the board. Certain.
- Both default add-ons read the byte the same way: the battle system lists a move in battle only when the byte is 0, and the menu lets a move be used only when its byte is 0. Certain.
- So 0 means usable, and the runtime and the editor's save agree. But when the editor opens a move, it puts the stored byte straight into the checkbox without converting it back. A move saved as usable therefore reopens with its box unticked, and the other way round. Certain from the editor's load and save logic.
- Opening a move may itself flip the stored value, so opening and re-saving a move could invert the flag. Guessing: this depends on whether the editor's UI library treats the program setting the box as a click.
- The internal enemy AI ignores this flag (see 8).
- **Default (1 = usable): wrong.** Not confirmed against a real file.

---

## Not verified from source
- The real-time length of a tick, and whether drawing to the screen waits for the display refresh.
- The quality and distribution of the C runtime's random number generator.
- What the user sees when the empty-target division by zero happens (see 4).
- Whether opening a move in the editor flips its usable flags (see 15).
- Whether the in-repo help manual describes any of these behaviours differently. I did not check it.
- Behaviour of third-party battle add-ons. Everything marked "default battle system" could differ in a game that replaced it.
