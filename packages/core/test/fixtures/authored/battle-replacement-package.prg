// A game-owned battle package that supplies the battle loop and transparently wraps Fight.
global(replacementBattleCalls)
global(replacementFightCalls)
global(replacementEnemyCount)
global(replacementPlayerCount)
global(replacementPause)
global(replacementOutcome)

function replacementBattleLoop() {
    local(index) = 0
    local(fighter)
    replacementBattleCalls = replacementBattleCalls + 1
    replacementEnemyCount = battle.partySize(0)
    replacementPlayerCount = battle.partySize(1)
    while (index < replacementEnemyCount) {
        fighter = battle.fighter(0, index)
        index = index + 1
    }
    fighter = battle.fighter(1, 0)
    if (replacementPause > 0) {
        threadsleep(getthreadid(), replacementPause)
    }
    battle.finish(replacementOutcome)
}

function battle() {
    replacementBattleLoop()
}

registerplugin({
    name: "replacement_battle",
    commands: {
        battle: (next) => {
            return replacementBattleLoop()
        },
        fight: (skill, background, next) => {
            replacementFightCalls = replacementFightCalls + 1
            return next(skill, background)
        }
    }
})
