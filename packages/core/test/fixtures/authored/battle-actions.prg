// battle-actions.prg — headless stock_battle player-action fixture (Epic 7.5).
//
// The host test seeds the globals below, picks one scenario and lets this
// thread call the package's public stockBattle action surface. Nothing here
// re-implements a rule: the fixture only supplies actors, records what the
// overridable animate hook is called with, and reports the returned values.
// Move and item programs are left empty: the package has no program-call
// primitive that can resume the action, so program ordering is not asserted.

global(scenario)
global(hookmode)
global(attacker)
global(target)
global(second)
global(third)
global(amountin)
global(poolin)
global(filein)
global(rounds)
order = ""
bd1 = 0
bd2 = 0
fallen1 = 0
fallen2 = 0
dealt = 0
total = 0

if (hookmode == "record") {
  stockBattle.animate = (file, fighter) => {
    order = order + file + "@" + fighter.id + ":" + fighter.hp + ":" + fighter.smp + ";"
  }
  stockBattle.runProgram = (file, source, target) => {
    order = order + "P:" + file + ":" + source.id + ">" + target.id + ":" + getstatus(target, 0) + ";"
  }
}
if (hookmode == "wait") {
  stockBattle.animate = (file, fighter) => {
    order = order + "w1 " + file + ";"
    threadSleep(getThreadId(), 0.05)
    order = order + "w2 " + file + ";"
  }
  stockBattle.runProgram = (file, source, target) => {
    order = order + "p1 " + file + ";"
    threadSleep(getThreadId(), 0.05)
    order = order + "p2 " + file + ";"
  }
}

if (scenario == "attack") {
  dealt = stockBattle.attack(attacker, target)
}
if (scenario == "attackamount") {
  dealt = stockBattle.attackAmount(attacker, target, amountin, poolin)
}
if (scenario == "stream") {
  for (i = 0; i < rounds; i = i + 1) {
    total = total + stockBattle.attack(attacker, target)
    total = total + stockBattle.attackAmount(target, attacker, 3 + i, "smp")
  }
}
if (scenario == "special") {
  moved = stockBattle.special(attacker, target, filein)
  movedhp = moved.hp
  movedsmp = moved.smp
  movedcost = moved.cost
}
if (scenario == "item") {
  used = stockBattle.item(attacker, target, filein)
  usedhp = used.hp
  usedsmp = used.smp
}
if (scenario == "all") {
  on(target, "beforeDamage", (event) => { bd1 = bd1 + 1 })
  on(second, "beforeDamage", (event) => { bd2 = bd2 + 1 })
  on(target, "fallen", (event) => { fallen1 = fallen1 + 1 })
  on(second, "fallen", (event) => { fallen2 = fallen2 + 1 })
  dealt = attackall({ source: attacker, first: target, second: second, third: null, amount: amountin })
}
if (scenario == "parked") {
  on(target, "beforeDamage", (event) => {
    order = order + "b1;"
    threadSleep(getThreadId(), 0.05)
    order = order + "b2;"
  })
  on(target, "fallen", (event) => { fallen1 = fallen1 + 1 })
  dealt = attackall({ source: attacker, first: target, second: null, third: null, amount: amountin })
}
ended = 1
end()
