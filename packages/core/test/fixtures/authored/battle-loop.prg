// battle-loop.prg — authored hook for exercising the stock_battle RPGCode loop.
// The turn spends its action without a native battle callback; tests may ask it
// to park for several ticks or finish with an outcome while the loop owns release.
global(turnCount)
global(turnOrder)
global(turnSleepTicks)
global(finishOnTurn)
global(finishCode)
global(turnSource)
global(turnTarget)
turnCount = 0
turnOrder = ""
turnSleepTicks = 0
finishOnTurn = 0
finishCode = 2
stockBattle.turn = (party, index) => {
  turnSource = sourceHandle()
  turnTarget = targetHandle()
  turnCount = turnCount + 1
  turnOrder = turnOrder + party + ":" + index + ","
  if (finishOnTurn == turnCount) {
    battle.finish(finishCode)
  }
  if (turnSleepTicks > 0) {
    threadSleep(getThreadId(), turnSleepTicks / 60)
  }
  return 0
}
battle
