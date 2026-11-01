// Drive a real stock enemy turn; an optional second turn exercises per-enemy AI ownership.
stockBattle.turn(0, 0)
if (secondturn == 1) {
    stockBattle.turn(0, 1)
}
done = 1
end()
