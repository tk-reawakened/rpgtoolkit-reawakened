// battle-custom-fight.prg — an authored main-file custom fight program (Epic 7.9, BAT-9 rule 2).
//
// The engine runs this program in place of the random draw when an encounter fires and the main file names it.
// The 5.11 request is `context`: no fighter was drawn and no battle exists yet, so the program spells its own
// enemies out with FightEnemy. The host test picks one scenario in `customMode`; every other global records what
// the program was given or did.
global(customMode)
global(customCalls)
global(seenTrigger)
global(seenKey)
global(seenSkill)
global(seenBackground)
global(seenActorId)
global(seenActorSource)
global(seenActorX)
global(seenActorLayer)
global(seenProgram)
global(seenSource)
global(seenTarget)
global(seenContext)
global(afterFight)
global(turnCount)

customCalls = customCalls + 1
seenTrigger = context.trigger
seenKey = context.board.key
seenSkill = context.board.skill
seenBackground = context.board.background
seenActorId = context.actor.id
seenActorSource = context.actor.source
seenActorX = context.actor.x
seenActorLayer = context.actor.layer
seenProgram = context.program
seenSource = sourceHandle()
seenTarget = targetHandle()
seenContext = context

if (customMode != "record" && customMode != "fight-nopackage") {
  // The stock loop is the battle; this program only spends the players' turns. A player kills every enemy at once
  // and an enemy does nothing, so each scenario reaches outcome 2 without any AI or data request.
  stockBattle.turn = (party, index) => {
    local(player)
    local(enemy)
    local(enemyIndex) = 0
    local(enemyCount)
    if (party == 1) {
      turnCount = turnCount + 1
      player = battle.fighter(1, index)
      enemyCount = battle.partySize(0)
      while (enemyIndex < enemyCount) {
        enemy = battle.fighter(0, enemyIndex)
        physical({ source: player, target: enemy, amount: 999 })
        enemyIndex = enemyIndex + 1
      }
    }
    return 0
  }
}

if (customMode == "fight-one") {
  FightEnemy("slime.ene", context.board.background)
}
if (customMode == "fight-order") {
  FightEnemy("bat.ene", "slime.ene", "bat.ene", context.board.background)
}
if (customMode == "fight-four") {
  FightEnemy("slime.ene", "bat.ene", "slime.ene", "bat.ene", context.board.background)
}
if (customMode == "fight-five") {
  FightEnemy("slime.ene", "bat.ene", "slime.ene", "bat.ene", "slime.ene", context.board.background)
}
if (customMode == "fight-none") {
  FightEnemy(context.board.background)
}
if (customMode == "fight-nopackage") {
  FightEnemy("slime.ene", context.board.background)
}
afterFight = afterFight + 1
