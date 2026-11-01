// zelda.prg — the Zelda-style battle script of the actor-boundary fixture (epic 20, entry 20.13).
//
// What it does for a game author: a hero whose health is counted in whole hearts of four points
// takes six hits of ten points, then a reward that takes the hero past one level. Every hit asks
// the game's `beforeDamage` listeners first, so a shield or a guard can change it before it lands.
//
// Precisely (docs/spec/engine/actors.md#store-and-action-boundary): the thread sends the
// cancelable `beforeDamage` event on the game emitter and parks until its listeners have run on a
// later tick, then applies the surviving damage through the package command `hit`. `hit`
// dispatches through the actor owner, so the `hearts` behaviour's `statsChanged` hook decides the
// committed health; nothing here writes the actor section. `reward` awards experience through the
// owner, so the same behaviour's `levelUp` hook decides the growth. `hpof` and `levelof` read the
// committed record back.

spawn(48, 48, 24)
log = ""
for (round = 0; round < 6; round = round + 1) {
    event = game.emitcancelable("beforeDamage", { dmg: 10 })
    taken = hit(1, event.detail.dmg)
    log = log + round + ":" + event.detail.dmg + ">" + taken + ";"
}
reward(1, 24)
health = hpof(1)
lvl = levelof(1)
ended = 1
end()
