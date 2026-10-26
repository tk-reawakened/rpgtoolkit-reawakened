// The main game triggers the core encounter setup through the public RPGCode commands.
global(replacementStart)
global(replacementAfter)

if (replacementStart == "random") {
  Fight(1, "")
} else {
  FightEnemy("slime.ene", "")
}
replacementAfter = replacementAfter + 1
