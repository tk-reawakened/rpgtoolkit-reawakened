// The host seeds customMode and inspects these observations after executeProgram.
global(customMode)
global(customCalls)
global(customSource)
global(customTarget)
global(customErrorResumed)
global(customSourceActorId)
global(customTargetActorId)
customCalls = customCalls + 1
customSource = sourceHandle()
customTarget = targetHandle()
if (customMode == "attack") {
  sourceFighter = stockBattle.resolveFighter(sourceHandle())
  targetFighter = stockBattle.resolveFighter(targetHandle())
  if (sourceFighter != null) {
    customSourceActorId = sourceFighter.id
  }
  if (targetFighter != null) {
    customTargetActorId = targetFighter.id
  }
  stockBattle.attack(sourceFighter, targetFighter)
}
if (customMode == "error") {
  missing_battle_ai_command()
  customErrorResumed = 1
  sourceFighter = stockBattle.resolveFighter(sourceHandle())
  targetFighter = stockBattle.resolveFighter(targetHandle())
  stockBattle.attack(sourceFighter, targetFighter)
}
if (customMode == "handoff") {
  ai(2)
}
if (customMode == "invalid") {
  ai(4)
  customErrorResumed = 1
}
