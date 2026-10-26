coverage = ""
enemy = battle.fighter(0, 0)
enemy2 = battle.fighter(0, 1)
hero = battle.fighter(1, 0)
hero2 = battle.fighter(1, 1)

enemyCount = battle.partySize(0)
heroCount = battle.partySize(1)
coverage = coverage + "party-size;"
initialOutcome = battle.outcome
runAllowed = battle.canRun
battleBackground = battle.background
coverage = coverage + "battle-read;"

initialEnemyCharge = battle.charge(0, 0)
battle.addCharge(0, 0, 8)
addedEnemyCharge = battle.charge(0, 0)
battle.setCharge(0, 0, 90)
battle.releaseCharge(0, 0)
releasedEnemyCharge = battle.charge(0, 0)
battle.setCharge(0, 0, 23)
battle.releaseCharge(0, 1)
battle.addCharge(1, 0, 20)
battle.setCharge(1, 1, 49)
enemyPercent = battle.chargePercent(0, 0)
heroPercent = battle.chargePercent(1, 0)
coverage = coverage + "charge;"

hero.hp = 9
hero.maxHp = 21
hero.smp = 5
hero.maxSmp = 9
hero.fp = 6
hero.dp = 7
heroHp = hero.hp
heroMaxHp = hero.maxHp
heroSmp = hero.smp
heroMaxSmp = hero.maxSmp
heroFp = hero.fp
heroDp = hero.dp
coverage = coverage + "stats;"

hero.on("statusChanged", (event) => { statusChanges = statusChanges + 1 })
statusChanges = 0
applystatus("Hero", "custom-fight.ste")
statusName = getstatus("Hero", 0)
removestatus("Hero", "custom-fight")
coverage = coverage + "status;"

enemyDamage = enemy.damage(8, hero.id, "hp")
enemy2Damage = enemy2.damage(8, hero.id, "hp")
enemyDefeated = 0
enemy2Defeated = 0
enemy.on("defeated", (event) => { enemyDefeated = enemyDefeated + 1 })
enemy2.on("defeated", (event) => { enemy2Defeated = enemy2Defeated + 1 })
enemy.emit("defeated", { actorId: enemy.id })
enemy2.emit("defeated", { actorId: enemy2.id })
coverage = coverage + "damage-defeated;"

seededRoll = random(100)
pixelText(12, 18, "Custom fight " + seededRoll)
coverage = coverage + "draw;"
wait(pressed)
coverage = coverage + "input;"
battle.finish(outcomecode)
coverage = coverage + "finish;"
