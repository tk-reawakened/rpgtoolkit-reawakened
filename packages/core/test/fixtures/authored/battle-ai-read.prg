// Read the enemy's own .ene data through the public read-only primitive.
enemyData = battleenemydata(battle.fighter(0, 0))
readAiLevel = enemyData.ailevel
readCustomAi = enemyData.customai
readProgram = enemyData.aiprogram
readSpecialCount = enemyData.specialcount
readSpecial0 = enemyData.specialmoves[0]
readSpecial1 = enemyData.specialmoves[1]
done = 1
end()
