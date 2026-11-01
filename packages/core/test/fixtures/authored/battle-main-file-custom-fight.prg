// battle-main-file-custom-fight.prg — an authored main-file custom fight program that supplies its own battle loop
// (Epic 7.12, BAT-9 rule 4). The main file names it, the engine runs it for a custom encounter, and it
//   1. registers its own `battle` handler with registerPlugin, then
//   2. spells its enemies out with the public FightEnemy, which prepares the core state and runs that handler.
// The handler exercises every ruled battle-facing operation and finishes the fight. The program calls nothing of the
// stock package; its only mention of it is a listener for `stock_battle.defeated`, which proves a custom loop's own
// `defeated` event is not re-emitted there. With `stock_battle` absent or present-but-replaced it behaves identically.
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
global(apiEnemyDefeatedCause)
global(apiEnemyDefeatedSource)
global(apiEnemyDefeatedDetail)
global(apiEnemy2DefeatedCause)
global(apiEnemy2DefeatedSource)
global(apiEnemy2DefeatedDetail)
global(apiGameDefeatedCount)
global(apiHeroId)
global(apiSeededRoll)
global(apiPressed)

apiCoverage = ""
apiCalls = 0
apiAfterFight = 0
apiStatusChanges = 0
apiEnemyDefeated = 0
apiEnemy2Defeated = 0
apiGameDefeatedCount = 0

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
    hero.maxhp = 21
    hero.smp = 5
    hero.maxsmp = 9
    hero.fp = 6
    hero.dp = 7
    apiHeroHp = hero.hp
    apiHeroMaxHp = hero.maxhp
    apiHeroSmp = hero.smp
    apiHeroMaxSmp = hero.maxsmp
    apiHeroFp = hero.fp
    apiHeroDp = hero.dp
    apiCoverage = apiCoverage + "stats;"

    hero.on("statusChanged", (event) => { apiStatusChanges = apiStatusChanges + 1 })
    applystatus("Hero", "custom-fight.ste")
    apiStatusName = getstatus("Hero", 0)
    removestatus("Hero", "custom-fight")
    apiCoverage = apiCoverage + "status;"

  // `defeated` carries the ruled `{ cause, source }` detail (BAT-12, EMIT-13). A custom loop emits it itself; with no
  // stock package loaded there is nothing that re-emits it on the game as `stock_battle.defeated`.
    enemy.on("defeated", (event) => {
        apiEnemyDefeated = apiEnemyDefeated + 1
        apiEnemyDefeatedCause = event.detail.cause
        apiEnemyDefeatedSource = event.detail.source
        apiEnemyDefeatedDetail = event.detail
    })
    enemy2.on("defeated", (event) => {
        apiEnemy2Defeated = apiEnemy2Defeated + 1
        apiEnemy2DefeatedCause = event.detail.cause
        apiEnemy2DefeatedSource = event.detail.source
        apiEnemy2DefeatedDetail = event.detail
    })
    on(game, "stock_battle.defeated", (event) => { apiGameDefeatedCount = apiGameDefeatedCount + 1 })
    apiHeroId = hero.id
    apiEnemyDamage = enemy.damage(8, hero.id, "hp")
    apiEnemy2Damage = enemy2.damage(8, hero.id, "hp")
    enemy.emit("defeated", { cause: "script", source: hero.id })
    enemy2.emit("defeated", { cause: "script", source: hero.id })
    apiCoverage = apiCoverage + "damage-defeated;"

    apiSeededRoll = random(100)
    pixeltext(12, 18, "Custom fight " + apiSeededRoll)
    apiCoverage = apiCoverage + "draw;"
    wait(apiPressed)
    apiCoverage = apiCoverage + "input;"
    battle.finish(2)
    apiCoverage = apiCoverage + "finish;"
    return 0
}

// The registered layer's engine binding is the program's own `battle` function, as a replacement package supplies.
function battle() {
    mainFileBattleLoop()
}

registerplugin({
    name: "main_file_battle",
    commands: {
        battle: (next) => {
            return mainFileBattleLoop()
        }
    }
})

fightenemy("slime.ene", "bat.ene", context.board.background)
apiAfterFight = apiAfterFight + 1
