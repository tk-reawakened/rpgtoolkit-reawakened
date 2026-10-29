// battle-main-file-custom-fight-queries.prg — the E-79 fighter-name and battle-stance animation queries
// (BAT-3 callbacks 121 and 122) that entry 7.12's broad program leaves unasserted (Epic 7.29, #749).
//
// The main file names this program as its custom fight program. It registers its own `battle` handler, spells its
// enemies out with the public FightEnemy, then reads every fighter's name and every ruled stance animation through
// that same public surface before it finishes the fight. With `stock_battle` absent every answer still comes from the
// real actor records and source assets, not from a package.
global(queryCalls)
global(queryAfterFight)
global(queryEnemyName)
global(queryEnemy2Name)
global(queryHeroName)
global(queryHero2Name)
global(queryEnemyFight)
global(queryEnemyDefend)
global(queryEnemySpecial)
global(queryEnemyDie)
global(queryEnemyRest)
global(queryHeroFight)
global(queryHeroDefend)
global(queryHeroSpecial)
global(queryHeroDie)
global(queryHeroRest)
global(queryEnemyAttackAlias)

queryCalls = 0
queryAfterFight = 0

function mainFileQueryLoop() {
  local(enemy)
  local(enemy2)
  local(hero)
  local(hero2)
  queryCalls = queryCalls + 1

  enemy = battle.fighter(0, 0)
  enemy2 = battle.fighter(0, 1)
  hero = battle.fighter(1, 0)
  hero2 = battle.fighter(1, 1)

  // Callback 121: each handle's own display name.
  queryEnemyName = enemy.name
  queryEnemy2Name = enemy2.name
  queryHeroName = hero.name
  queryHero2Name = hero2.name

  // Callback 122: the animation file the source asset names for each ruled stance. Enemies store
  // REST, FIGHT, DEFEND, SPECIAL MOVE, DIE; characters store FIGHT, DEFEND, SPECIAL MOVE, DIE, REST.
  queryEnemyFight = fighteranimationfile(enemy, "fight")
  queryEnemyDefend = fighteranimationfile(enemy, "defend")
  queryEnemySpecial = fighteranimationfile(enemy, "special move")
  queryEnemyDie = fighteranimationfile(enemy, "die")
  queryEnemyRest = fighteranimationfile(enemy, "rest")
  queryHeroFight = fighteranimationfile(hero, "fight")
  queryHeroDefend = fighteranimationfile(hero, "defend")
  queryHeroSpecial = fighteranimationfile(hero, "special move")
  queryHeroDie = fighteranimationfile(hero, "die")
  queryHeroRest = fighteranimationfile(hero, "rest")
  queryEnemyAttackAlias = fighteranimationfile(enemy, "ATTACK")

  battle.finish(2)
  return 0
}

// The registered layer's engine binding is the program's own `battle` command. With stock_battle absent this is the
// only battle handler in the game, so the queries run through the public surface and nothing else.
function battle() {
  mainFileQueryLoop()
}

registerPlugin({
  name: "main_file_queries",
  commands: {
    battle: (next) => {
      return mainFileQueryLoop()
    }
  }
})

FightEnemy("slime.ene", "bat.ene", context.board.background)
queryAfterFight = queryAfterFight + 1
