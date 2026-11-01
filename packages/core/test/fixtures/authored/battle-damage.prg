// battle-damage.prg — headless stock_battle damage contract fixture (Epic 7.14).
//
// Every action below enters the package's one damage helper from this RPGCode
// thread. The helper emits beforeDamage on the target actor, waits for the
// cancelable dispatch, then writes the surviving field through the actor owner.
// The listener on saveTarget sleeps so a save can be taken while dispatch is
// between listeners; all state used by the fixture is plain RPGCode data.

global(source)
global(mutationTarget)
global(cancelTarget)
global(specialTarget)
global(smpTarget)
global(allFirst)
global(allSecond)
global(drainFirst)
global(saveTarget)
global(plainTarget)
global(lethalPhysical)
global(lethalSpecial)
order = ""
cancelFallen = 0

on(mutationTarget, "beforeDamage", (event) => {
    order = order + "m1"
    mutationDetail = event.detail
    mutationInitialDamage = event.detail.damage
    event.detail.damage = event.detail.damage / 2
})
on(mutationTarget, "beforeDamage", (event) => {
    order = order + "m2"
    sourceDetail = event.detail.source
    targetDetail = event.detail.target
})
mutationTaken = physical({ source: source, target: mutationTarget, amount: 10 })

on(cancelTarget, "fallen", (event) => { cancelFallen = cancelFallen + 1 })
on(cancelTarget, "beforeDamage", (event) => {
    order = order + "c1"
    event.cancel()
})
on(cancelTarget, "beforeDamage", (event) => {
    order = order + "c2" + event.canceled
})
cancelTaken = physical({ source: source, target: cancelTarget, amount: 10 })

on(specialTarget, "beforeDamage", (event) => {
    event.detail.damage = event.detail.damage + 2
})
specialTaken = special({ source: source, target: specialTarget, amount: 5 })

on(smpTarget, "beforeDamage", (event) => {
    event.detail.damage = event.detail.damage + 3
})
smpTaken = drain({ source: source, target: smpTarget, amount: 4 })

plainTaken = physical({ source: source, target: plainTarget, amount: 3 })

on(lethalPhysical, "fallen", (event) => {
    lethalPhysicalCause = event.detail.cause
    lethalPhysicalSource = event.detail.source
})
on(lethalSpecial, "fallen", (event) => {
    lethalSpecialCause = event.detail.cause
    lethalSpecialSource = event.detail.source
})
lethalPhysicalTaken = physical({ source: source, target: lethalPhysical, amount: 10 })
lethalSpecialTaken = special({ source: source, target: lethalSpecial, amount: 10 })

on(clampHp, "beforeDamage", (event) => {
    event.detail.damage = event.detail.damage + 40
    clampHpMutated = event.detail.damage
})
clampHpTaken = physical({ source: source, target: clampHp, amount: 5 })

on(clampSmp, "beforeDamage", (event) => {
    event.detail.damage = event.detail.damage + 40
    clampSmpMutated = event.detail.damage
})
clampSmpTaken = drain({ source: source, target: clampSmp, amount: 2 })

on(allFirst, "beforeDamage", (event) => { event.detail.damage = event.detail.damage - 1 })
on(allSecond, "beforeDamage", (event) => { event.detail.damage = event.detail.damage + 1 })
allTaken = attackall({ source: source, first: allFirst, second: allSecond, third: null, amount: 6 })

on(drainFirst, "beforeDamage", (event) => { event.detail.damage = event.detail.damage / 2 })
drainAllTaken = drainall({ source: source, first: drainFirst, second: null, third: null, amount: 8 })

on(saveTarget, "beforeDamage", (event) => {
    nullSourceDetail = event.detail.source
    order = order + "s1"
    threadsleep(getthreadid(), 0.05)
    order = order + "s2"
})
savedTaken = physical({ source: null, target: saveTarget, amount: 4 })
ended = 1
end()
