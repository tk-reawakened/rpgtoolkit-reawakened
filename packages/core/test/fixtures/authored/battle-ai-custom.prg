// The host seeds customMode and inspects these observations after executeProgram.
global(customMode)
global(customCalls)
global(customSource)
global(customTarget)
global(customErrorResumed)
global(customSourceActorId)
global(customTargetActorId)
customCalls = customCalls + 1
customSource = sourcehandle()
customTarget = targethandle()
if (customMode == "attack") {
    sourceFighter = stockBattle.resolveFighter(sourcehandle())
    targetFighter = stockBattle.resolveFighter(targethandle())
    if (sourceFighter != null) {
        customSourceActorId = sourceFighter.id
    }
    if (targetFighter != null) {
        customTargetActorId = targetFighter.id
    }
    stockBattle.attack(sourceFighter, targetFighter)
}
if (customMode == "actions") {
    sourceFighter = stockBattle.resolveFighter(sourcehandle())
    targetFighter = stockBattle.resolveFighter(targethandle())
    stockBattle.attack(sourceFighter, targetFighter)
    customAttackHp = targetFighter.hp
    stockBattle.special(sourceFighter, targetFighter, "hit.spc")
    customMoveHp = targetFighter.hp
    customMoveSmp = targetFighter.smp
    customMoveSourceSmp = sourceFighter.smp
    stockBattle.item(sourceFighter, targetFighter, "potion.itm", null)
    customItemHp = targetFighter.hp
    customItemSmp = targetFighter.smp
}
if (customMode == "error") {
    missing_battle_ai_command()
    customErrorResumed = 1
    sourceFighter = stockBattle.resolveFighter(sourcehandle())
    targetFighter = stockBattle.resolveFighter(targethandle())
    stockBattle.attack(sourceFighter, targetFighter)
}
if (customMode == "handoff") {
    ai(2)
}
if (customMode == "invalid") {
    ai(4)
    customErrorResumed = 1
}
