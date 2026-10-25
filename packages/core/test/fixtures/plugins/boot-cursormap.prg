// boot-cursormap.prg - host fixture for cursor-map key waits and save/restore.
map = createCursorMap()
cursorMapAdd(10, 20, map)
cursorMapAdd(50, 60, map)
selected = cursorMapRun(map)
done = 1
end()
