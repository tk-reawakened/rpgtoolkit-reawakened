// battle-main-file-custom-fight.prg — an authored main-file custom fight program that supplies its own battle loop
// (Epic 7.12, BAT-9 rule 4). The main file names it, the engine runs it for a custom encounter, and it
//   1. registers its own `battle` handler with registerPlugin, then
//   2. spells its enemies out with the public FightEnemy, which prepares the core state and runs that handler.
// The handler exercises every ruled battle-facing operation and finishes the fight. The program touches no stock
// package name: with `stock_battle` absent or present-but-replaced it must behave identically.
global(apiCoverage)
global(apiCalls)
global(apiAfterFight)
global(apiEnemyCount)
global(apiHeroCount)
global(apiInitialOutcome)
global(apiRunAllowed)
global(apiBackground)
global(apiInitialEnemyCharge)
global(apiAddedEnemyCharge)
global(apiReleasedEnemyCharge)
global(apiEnemyPercent)
global(apiHeroPercent)
global(apiHeroHp)
global(apiHeroMaxHp)
global(apiHeroSmp)
global(apiHeroMaxSmp)
global(apiHeroFp)
global(apiHeroDp)
global(apiStatusName)
global(apiStatusChanges)
global(apiEnemyDamage)
global(apiEnemy2Damage)
global(apiEnemyDefeated)
global(apiEnemy2Defeated)
global(apiSeededRoll)

apiCoverage = ""
apiCalls = 0
apiAfterFight = 0
apiStatusChanges = 0
apiEnemyDefeated = 0
apiEnemy2Defeated = 0

function mainFileBattleLoop() {
  local(enemy)
  local(enemy2)
  local(hero)
  local(hero2)
  apiCalls = apiCalls + 1

  enemy = battle.fighter(0, 0)
  enemy2 = battle.fighter(0, 1)
  hero = battle.fighter(1, 0)
  hero2 = battle.fighter(1, 1)

  apiEnemyCount = battle.partySize(0)
  apiHeroCount = battle.partySize(1)
  apiCoverage = apiCoverage + "party-size;"
  apiInitialOutcome = battle.outcome
  apiRunAllowed = battle.canRun
  apiBackground = battle.background
  apiCoverage = apiCoverage + "battle-read;"

  apiInitialEnemyCharge = battle.charge(0, 0)
  battle.addCharge(0, 0, 8)
  apiAddedEnemyCharge = battle.charge(0, 0)
  battle.setCharge(0, 0, 90)
  battle.releaseCharge(0, 0)
  apiReleasedEnemyCharge = battle.charge(0, 0)
  battle.setCharge(0, 0, 23)
  battle.releaseCharge(0, 1)
  battle.addCharge(1, 0, 20)
  battle.setCharge(1, 1, 49)
  apiEnemyPercent = battle.chargePercent(0, 0)
  apiHeroPercent = battle.chargePercent(1, 0)
  apiCoverage = apiCoverage + "charge;"

  hero.hp = 9
  hero.maxHp = 21
  hero.smp = 5
  hero.maxSmp = 9
  hero.fp = 6
  hero.dp = 7
  apiHeroHp = hero.hp
  apiHeroMaxHp = hero.maxHp
  apiHeroSmp = hero.smp
  apiHeroMaxSmp = hero.maxSmp
  apiHeroFp = hero.fp
  apiHeroDp = hero.dp
  apiCoverage = apiCoverage + "stats;"

  hero.on("statusChanged", (event) => { apiStatusChanges = apiStatusChanges + 1 })
  applystatus("Hero", "custom-fight.ste")
  apiStatusName = getstatus("Hero", 0)
  removestatus("Hero", "custom-fight")
  apiCoverage = apiCoverage + "status;"

  enemy.on("defeated", (event) => { apiEnemyDefeated = apiEnemyDefeated + 1 })
  enemy2.on("defeated", (event) => { apiEnemy2Defeated = apiEnemy2Defeated + 1 })
  apiEnemyDamage = enemy.damage(8, hero.id, "hp")
  apiEnemy2Damage = enemy2.damage(8, hero.id, "hp")
  enemy.emit("defeated", { actorId: enemy.id })
  enemy2.emit("defeated", { actorId: enemy2.id })
  apiCoverage = apiCoverage + "damage-defeated;"

  apiSeededRoll = random(100)
  pixelText(12, 18, "Custom fight " + apiSeededRoll)
  apiCoverage = apiCoverage + "draw;"
  threadSleep(getThreadId(), 1/60)
  apiCoverage = apiCoverage + "tick-wait;"
  battle.finish(2)
  apiCoverage = apiCoverage + "finish;"
  return 0
}

// The registered layer's engine binding is the program's own `battle` function, as a replacement package supplies.
function battle() {
  mainFileBattleLoop()
}

registerPlugin({
  name: "main_file_battle",
  commands: {
    battle: (next) => {
      return mainFileBattleLoop()
    }
  }
})

FightEnemy("slime.ene", "bat.ene", context.board.background)
apiAfterFight = apiAfterFight + 1
