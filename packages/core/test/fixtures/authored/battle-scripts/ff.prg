// ff.prg — the FF-style battle script of the actor-boundary fixture (epic 20, entry 20.13).
//
// What it does for a game author: a hero with a four-digit health pool takes six hits whose damage
// is rolled from the seeded random source, then a reward that takes the hero past one level. The
// damage roll and the reward are the same core operations the Zelda-style script uses; only the
// registered behaviour of the hero differs.
//
// Precisely (docs/spec/engine/actors.md#store-and-action-boundary): the thread sends the
// cancelable `beforeDamage` event with the rolled amount on the game emitter, parks until its
// listeners have run on a later tick, and applies the surviving damage through the package command
// `hit`, which dispatches through the actor owner. `reward` awards experience through the owner,
// so the `armour` behaviour's `levelUp` hook decides the growth and its `statsChanged` hook
// decides the committed health.

spawn(9999, 9999, 1000)
log = ""
for (round = 0; round < 6; round = round + 1) {
    roll = 900 + random(600)
    event = game.emitcancelable("beforeDamage", { dmg: roll })
    taken = hit(1, event.detail.dmg)
    log = log + round + ":" + roll + ">" + taken + ";"
}
reward(1, 1500)
health = hpof(1)
lvl = levelof(1)
ended = 1
end()
