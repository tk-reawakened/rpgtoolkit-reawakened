// The main game triggers the core encounter setup through the public RPGCode commands.
global(replacementStart)
global(replacementAfter)

if (replacementStart == "random") {
    fight(1, "")
} else {
    fightenemy("slime.ene", "")
}
replacementAfter = replacementAfter + 1
