// battle-actions.prg — headless stock_battle player-action fixture (Epic 7.5).
//
// The host test seeds the globals below, picks one scenario and lets this
// thread call the package's public stockBattle action surface. Nothing here
// re-implements a rule: the fixture only supplies actors, records what the
// overridable animate hook is called with, and reports the returned values.
// Authored nested programs verify the source/target context, optional data,
// errors, and saving while an action program is parked.

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
global(watchFallen)
global(postSource)
global(postTarget)
postSource = 0
postTarget = 0
global(programCalls)
global(programSource)
global(programTarget)
global(programContextSource)
global(programContextTarget)
global(programContextLabel)
global(programContextValue)
global(programStarted)
global(programResumed)
global(programErrorResumed)
programCalls = 0
programSource = 0
programTarget = 0
programContextSource = 0
programContextTarget = 0
programContextLabel = 0
programContextValue = 0
programStarted = 0
programResumed = 0
programErrorResumed = 0
order = ""
bd1 = 0
bd2 = 0
fallen1 = 0
fallen2 = 0
dealt = 0
total = 0

if (watchfallen == 1) {
  on(target, "fallen", (event) => { fallen1 = fallen1 + 1 })
}

if (hookmode == "record") {
  stockBattle.animate = (file, fighter) => {
    order = order + file + "@" + fighter.id + ":" + fighter.hp + ":" + fighter.smp + ";"
  }
  executeProgram = (file, context) => {
    order = order + "P:" + file + ":" + context.source + ">" + context.target + ":" + getstatus(target, 0) + ";"
  }
}
if (hookmode == "wait") {
  stockBattle.animate = (file, fighter) => {
    order = order + "w1 " + file + ";"
    threadSleep(getThreadId(), 0.05)
    order = order + "w2 " + file + ";"
  }
  executeProgram = (file, context) => {
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
if (scenario == "programcontext") {
  executeProgram(filein, { source: "" + attacker.id, target: "" + target.id, label: "extra", value: 17 })
}
if (scenario == "all") {
  on(target, "beforeDamage", (event) => { bd1 = bd1 + 1 })
  on(second, "beforeDamage", (event) => { bd2 = bd2 + 1 })
  on(target, "fallen", (event) => { fallen1 = fallen1 + 1 })
  on(second, "fallen", (event) => { fallen2 = fallen2 + 1 })
  dealt = attackall({ source: attacker, first: target, second: second, third: null, amount: amountin })
}
if (scenario == "drainall") {
  dealt = drainall({ source: attacker, first: target, second: second, third: null, amount: amountin })
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
postSource = sourceHandle()
postTarget = targetHandle()
ended = 1
end()
