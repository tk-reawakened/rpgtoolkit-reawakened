text(1, 1, "Text")
pixeltext(8, 8, "Text")
fontsize(16)
bitmap("title.png")
playerstance(0, "wave")
fight(1, "field.bkg")
if (gold > 10) {
}
giveitem("potion.itm")
takeitem("potion.itm")
gold = 0
wait()
delay(1)
prompt("Your name?", answer)
getgp(gold)
mwin("Welcome back.")
wait()
mwincls()