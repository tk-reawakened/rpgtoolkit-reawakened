// Authored fixture: one line per documented visual event builder category
// (docs/editor-features.md T-45: Text, Display, Player, Fight, Control, Items,
// Variable manipulation, Input, Info). Interim evidence only (#2073): it does
// not enumerate the ~160 templates; #1744 and #1746 own that inventory.

// Text
mwin("Welcome back.")
text(1, 1, "Ready")
mwincls()

// Display
bitmap("title.png")

// Player
playerstance(0, "wave")

// Fight
fight(1, "field.bkg")

// Control
if (gold > 10) {
    branch(:shop)
}
:shop

// Items
giveitem("potion.itm")
takeitem("potion.itm")

// Variable manipulation
gold = 0
givegp(25)
kill(gold)

// Input
prompt("Your name?", answer)

// Info
getgp(gold)
getlevel(0, level)
delay(1)
