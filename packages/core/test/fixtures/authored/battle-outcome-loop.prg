global(outcomeMode)
global(outcomeTurnCount)
global(outcomeEventCount)
global(outcomeEventCause)
global(outcomeEventSource)
global(levelProgramCount)
global(levelProgramContinuation)
global(levelProgramLog)
global(outcomeSequence)
global(outcomeHandledCode)
global(outcomeBattleEndedCount)
global(outcomeBattleEndedCode)
outcomeMode = ""
outcomeTurnCount = 0
outcomeEventCount = 0
outcomeEventCause = ""
outcomeEventSource = ""
levelProgramCount = 0
levelProgramContinuation = 0
levelProgramLog = ""
outcomeSequence = ""
outcomeHandledCode = 0
outcomeBattleEndedCount = 0
outcomeBattleEndedCode = -1
on(game, "battleEnded", (event) => {
  outcomeBattleEndedCount = outcomeBattleEndedCount + 1
  outcomeBattleEndedCode = event.detail.outcome
})
on(game, "stock_battle.defeated", (event) => {
  outcomeEventCount = outcomeEventCount + 1
  outcomeEventCause = event.detail.cause
  outcomeEventSource = event.detail.source
})
stockBattle.turn = (party, index) => {
  local(player)
  local(enemy)
  local(enemyIndex) = 0
  local(enemyCount)
  if (party == 1 && outcomeMode != "") {
    outcomeTurnCount = outcomeTurnCount + 1
    player = battle.fighter(1, index)
    if (outcomeMode == "win") {
      enemyCount = battle.partySize(0)
      while (enemyIndex < enemyCount) {
        enemy = battle.fighter(0, enemyIndex)
        physical({ source: player, target: enemy, amount: 999 })
        enemyIndex = enemyIndex + 1
      }
    }
    if (outcomeMode == "simultaneous") {
      enemy = battle.fighter(0, 0)
      physical({ source: player, target: enemy, amount: 999 })
      physical({ source: enemy, target: player, amount: 999 })
    }
    if (outcomeMode == "run") {
      stockBattle.run()
    }
    if (outcomeMode == "handled") {
      battle.finish(outcomeHandledCode)
    }
  }
  return 0
}
battle
