// stock_menu — the default player menu (E-80).
// docs/spec/engine/plugins-and-battle.md#e-80-stock-menu
//
// The four screens are RPGCode `menuProviders` and the save/load picker is the `dirsav` command layer. Each
// provider is its screen's own blocking loop on the calling script thread: draw, wait for one key, handle it, repeat.
// The package owns navigation and drawing only; party, inventory, equipment and
// menu state are read through the read-only provider context and changed only through the owner actions.
//
// Everything drawn goes into the reserved render-now overlay, whose previous pixels are stashed and restored when
// the screen closes, so the menu is one blit in the core draw list and holds no state a renderer could own.

stockMenu = {
    // ---- palette (A11Y-4: text and chrome meet 4.5:1 / 3:1 against the panel) --------------------------------
    panelR: 16,
    panelG: 16,
    panelB: 24,
    inkR: 232,
    inkG: 232,
    inkB: 240,
    dimR: 140,
    dimG: 140,
    dimB: 152,
    lineR: 88,
    lineG: 88,
    lineB: 104,
    barR: 40,
    barG: 64,
    barB: 140,
    markR: 255,
    markG: 224,
    markB: 64,

    // ---- layout ----------------------------------------------------------------------------------------------
    rowH: 20,
    listTop: 24,
    labelX: 24,
    pageSize: 8,
    w: 0,
    h: 0,
    screen: 0,
    stash: 0,
    stashOn: 0,
    savedFont: 0,
    savedR: 0,
    savedG: 0,
    savedB: 0,
    screenName: "",
    mode: "list",
    selection: 0,
    member: 0,
    slot: 0,
    message: "",
    context: null,
    charCache: {},
    itemCache: {},
    stackIds: {},
    stackHandles: {},
    stackSources: {},
    stackQty: {},
    stackCount: 0,
    itemcount: 0,
    moveFiles: {},
    listPositions: {},
    listHasRemove: 0,
    moveNames: {},
    moveCosts: {},
    moveCount: 0,
    memberIds: {},
    memberCount: 0,
    saveNames: {},
    saveCount: 0,

    // ---- drawing ---------------------------------------------------------------------------------------------
    box: (x1, y1, x2, y2, r, g, b) => {
        colorrgb(r, g, b)
        fillrect(x1, y1, x2, y2, stockMenu.screen)
        return 0
    },
    frame: (x1, y1, x2, y2, r, g, b) => {
        colorrgb(r, g, b)
        drawrect(x1, y1, x2, y2, stockMenu.screen)
        return 0
    },
    words: (x, y, text, size, r, g, b) => {
        colorrgb(r, g, b)
        fontsize(size)
        pixeltext(x, y, text, stockMenu.screen)
        return 0
    },
    panel: () => {
        stockMenu.box(8, 8, stockMenu.w - 9, stockMenu.h - 9, stockMenu.panelR, stockMenu.panelG, stockMenu.panelB)
        local(graphic) = ""
        if (stockMenu.context != null) {
            graphic = stockMenu.context.menu.graphic
        }
        if (graphic != 0 && graphic != "") {
            setimage(graphic, 8, 8, stockMenu.w - 16, stockMenu.h - 16, stockMenu.screen)
        }
        stockMenu.frame(8, 8, stockMenu.w - 9, stockMenu.h - 9, stockMenu.lineR, stockMenu.lineG, stockMenu.lineB)
        return 0
    },
    // A row's focus indicator is the selection bar, two pixels larger than the row on every side (A11Y-5).
    row: (y, label, value, focused, dim) => {
        local(r) = stockMenu.inkR
        local(g) = stockMenu.inkG
        local(b) = stockMenu.inkB
        local(text) = label
        if (dim != 0) {
            r = stockMenu.dimR
            g = stockMenu.dimG
            b = stockMenu.dimB
        }
        if (focused != 0) {
            stockMenu.box(16, y - 2, stockMenu.w - 17, y + 18, stockMenu.barR, stockMenu.barG, stockMenu.barB)
            r = stockMenu.markR
            g = stockMenu.markG
            b = stockMenu.markB
        }
        stockMenu.words(stockMenu.labelX, y, text, 16, r, g, b)
        if (value != "") {
            stockMenu.words(stockMenu.w - 168, y, value, 16, r, g, b)
        }
        return 0
    },
    header: (text) => {
        stockMenu.words(stockMenu.labelX, stockMenu.listTop, text, 18, stockMenu.markR, stockMenu.markG, stockMenu.markB)
        return 0
    },
    footer: () => {
        if (stockMenu.message != "") {
            stockMenu.words(stockMenu.labelX, stockMenu.h - 40, stockMenu.message, 16, stockMenu.markR, stockMenu.markG, stockMenu.markB)
        }
        return 0
    },
    clearPanel: () => {
        stockMenu.panel()
        return 0
    },

    // ---- frame lifecycle -------------------------------------------------------------------------------------
    begin: (context, screenName) => {
        local(parent) = {
            context: stockMenu.context, screenName: stockMenu.screenName, w: stockMenu.w, h: stockMenu.h,
            screen: stockMenu.screen, stash: stockMenu.stash, stashOn: stockMenu.stashOn,
            savedFont: stockMenu.savedFont, savedR: stockMenu.savedR, savedG: stockMenu.savedG, savedB: stockMenu.savedB,
            mode: stockMenu.mode, member: stockMenu.member, slot: stockMenu.slot, message: stockMenu.message,
            charCache: stockMenu.charCache, itemCache: stockMenu.itemCache
        }
        local(w) = 0
        local(h) = 0
        getres(w, h)
        stockMenu.context = context
        stockMenu.screenName = screenName
        stockMenu.w = w
        stockMenu.h = h
        stockMenu.message = ""
        stockMenu.savedFont = getfontsize()
        stockMenu.savedR = 0
        stockMenu.savedG = 0
        stockMenu.savedB = 0
        getcolor(stockMenu.savedR, stockMenu.savedG, stockMenu.savedB)
        stockMenu.stashOn = rendernowenabled()
        stockMenu.stash = 0
        if (cnvrendernow != 0) {
            stockMenu.stash = createcanvas(w, h)
            drawcanvas(cnvrendernow, 0, 0, w, h, stockMenu.stash)
        }
        rendernow(1)
        stockMenu.screen = cnvrendernow
        return parent
    },
    close: (parent) => {
        clear(stockMenu.screen)
        if (stockMenu.stash != 0) {
            drawcanvas(stockMenu.stash, 0, 0, stockMenu.w, stockMenu.h, stockMenu.screen)
            killcanvas(stockMenu.stash)
            stockMenu.stash = 0
        }
        if (stockMenu.stashOn == 0) {
            rendernow(0)
        }
        fontsize(stockMenu.savedFont)
        colorrgb(stockMenu.savedR, stockMenu.savedG, stockMenu.savedB)
        stockMenu.context = parent.context
        stockMenu.screenName = parent.screenName
        stockMenu.w = parent.w
        stockMenu.h = parent.h
        stockMenu.screen = parent.screen
        stockMenu.stash = parent.stash
        stockMenu.stashOn = parent.stashOn
        stockMenu.savedFont = parent.savedFont
        stockMenu.savedR = parent.savedR
        stockMenu.savedG = parent.savedG
        stockMenu.savedB = parent.savedB
        stockMenu.mode = parent.mode
        stockMenu.member = parent.member
        stockMenu.slot = parent.slot
        stockMenu.message = parent.message
        stockMenu.charCache = parent.charCache
        stockMenu.itemCache = parent.itemCache
        return 0
    },
    // One key press, normalised: a game with bindings delivers action names, a game without delivers legacy names.
    normalize: (key) => {
        local(name) = "" + key
        if (name == "UP") { return "up" }
        if (name == "DOWN") { return "down" }
        if (name == "LEFT") { return "left" }
        if (name == "RIGHT") { return "right" }
        if (name == "ENTER") { return "confirm" }
        if (name == "ESC") { return "cancel" }
        return name
    },
    // Menu cues are one-shot `ui` voices (R-59): they mix over music and `wavstop` does not stop them.
    cue: (kind) => {
        local(file) = ""
        if (stockMenu.context != null) {
            if (kind == "move") { file = stockMenu.context.menu.movesound }
            if (kind == "choose") { file = stockMenu.context.menu.choosesound }
            if (kind == "cancel") { file = stockMenu.context.menu.cancelsound }
        }
        if (file != "") {
            mediaplay(file, { track: "ui", loop: 0 })
        }
        return 0
    },

    // ---- selection -------------------------------------------------------------------------------------------
    selection: () => {
        local(frames) = stockMenu.context.menu.screens
        if (frames.length < 1) {
            return 0
        }
        return frames[frames.length - 1].selection
    },
    choose: (index) => {
        local(frames) = stockMenu.context.menu.screens
        local(actor) = null
        if (frames.length > 0) {
            actor = frames[frames.length - 1].actorId
        }
        stockMenu.context.menu.updateCurrent({ actorId: actor, selection: index })
        return 0
    },
    withMember: (actorId, index) => {
        stockMenu.context.menu.updateCurrent({ actorId: actorId, selection: index })
        return 0
    },
    wrap: (value, count) => {
        if (count < 1) {
            return 0
        }
        local(next) = value
        while (next < 0) {
            next = next + count
        }
        return next % count
    },

    // ---- owner data ------------------------------------------------------------------------------------------
    members: (context) => {
        local(list) = context.party.members
        local(count) = list.length
        local(index) = 0
        stockMenu.memberCount = count
        stockMenu.memberIds = {}
        for (index = 0; index < count; index = index + 1) {
            stockMenu.memberIds[index] = list[index].id
        }
        return list
    },
    stacks: (context) => {
        local(items) = context.inventory.items
        local(total) = items.length
        local(index) = 0
        local(position) = 0
        local(entry)
        local(before)
        local(count) = 0
        stockMenu.stackCount = 0
        stockMenu.stackIds = {}
        stockMenu.stackHandles = {}
        stockMenu.stackSources = {}
        stockMenu.stackQty = {}
        for (index = 0; index < total; index = index + 1) {
            entry = items[index]
            if (entry.quantity > 0) {
                // Ascending stack id, by insertion: the section keeps creation order, but a save may restore any order.
                position = count
                while (position > 0 && stockMenu.stackIds[position - 1] > entry.id) {
                    stockMenu.stackIds[position] = stockMenu.stackIds[position - 1]
                    stockMenu.stackHandles[position] = stockMenu.stackHandles[position - 1]
                    stockMenu.stackSources[position] = stockMenu.stackSources[position - 1]
                    stockMenu.stackQty[position] = stockMenu.stackQty[position - 1]
                    position = position - 1
                }
                stockMenu.stackIds[position] = entry.id
                stockMenu.stackHandles[position] = entry.handle
                stockMenu.stackSources[position] = entry.source
                stockMenu.stackQty[position] = entry.quantity
                count = count + 1
            }
        }
        stockMenu.stackCount = count
        return count
    },
    itemData: (source) => {
        local(cached) = stockMenu.itemCache[source]
        if (cached != null) {
            return cached
        }
        local(data) = menuitemdata(source)
        if (data == null) {
            data = { description: "", keyitem: 0, menuy: 0, equipable: 0, slots: {}, accessory: "", usedby: 0, allowed: {} }
        }
        stockMenu.itemCache[source] = data
        return data
    },
    characterData: (source, actorId) => {
        local(key) = source + "|" + actorId
        local(cached) = stockMenu.charCache[key]
        if (cached != null) {
            return cached
        }
        local(data) = menucharacterdata(source, actorId)
        if (data == null) {
            data = { name: "", portrait: "", bodyslots: {}, accessoryslots: {}, specialname: "", hasspecial: 0, specialcount: 0, specialmoves: {} }
        }
        stockMenu.charCache[key] = data
        return data
    },
    equippedAt: (context, actorId, slot) => {
        local(equipment) = context.inventory.equipment
        local(index) = 0
        for (index = 0; index < equipment.length; index = index + 1) {
            if (equipment[index].actorId == actorId && equipment[index].slot == slot) {
                return equipment[index].itemId
            }
        }
        return 0
    },
    handleOfStack: (itemId) => {
        local(index) = 0
        for (index = 0; index < stockMenu.stackCount; index = index + 1) {
            if (stockMenu.stackIds[index] == itemId) {
                return stockMenu.stackHandles[index]
            }
        }
        return "-"
    },
    slotTokens: {},
    fits: (item, character, slot) => {
        if (item.equipable != 1) {
            return 0
        }
        if (slot == "head") { return character.bodyslots.head }
        if (slot == "neck") { return character.bodyslots.neck }
        if (slot == "right-hand") { return character.bodyslots.right-hand }
        if (slot == "left-hand") { return character.bodyslots.left-hand }
        if (slot == "body") { return character.bodyslots.body }
        if (slot == "legs") { return character.bodyslots.legs }
        // A named accessory fits when the file names one and the character's slot carries the same name.
        if (item.accessory == "") {
            return 0
        }
        return character.accessoryslots[slot] == item.accessory
    },
    timeText: (seconds) => {
        local(hours) = integermuldiv(seconds, 1, 3600)
        local(minutes) = integermuldiv(seconds - hours * 3600, 1, 60)
        local(secs) = seconds - hours * 3600 - minutes * 60
        local(mm) = "" + minutes
        local(ss) = "" + secs
        if (minutes < 10) { mm = "0" + minutes }
        if (secs < 10) { ss = "0" + secs }
        return hours + ":" + mm + ":" + ss
    },

    // ---- the main screen -------------------------------------------------------------------------------------
    drawMain: (context) => {
        local(members) = stockMenu.members(context)
        local(index) = 0
        local(y) = stockMenu.listTop
        local(member)
        local(portrait)
        local(caption)
        local(commands) = {}
        commands[0] = "Items"
        commands[1] = "Equip"
        commands[2] = "Abilities"
        commands[3] = "Save"
        commands[4] = "Load"
        commands[5] = "Quit"
        local(selection) = stockMenu.selection()
        local(dim) = 0
        stockMenu.clearPanel()
        for (index = 0; index < stockMenu.memberCount; index = index + 1) {
            member = members[index]
            caption = member.name + "  HP " + member.hp + "/" + member.maxhp + "  SMP " + member.smp + "/" + member.maxsmp + "  Lv " + member.level
            stockMenu.row(y, caption, "", 0, 0)
            portrait = stockMenu.characterData(member.source, member.id).portrait
            if (portrait != 0 && portrait != "") {
                setimage(portrait, 24, y, 16, 16, stockMenu.screen)
            }
            y = y + stockMenu.rowH
        }
        y = y + 4
        stockMenu.words(stockMenu.labelX, y, "Gold " + context.inventory.gold, 16, stockMenu.inkR, stockMenu.inkG, stockMenu.inkB)
        stockMenu.words(stockMenu.w - 168, y, "Time " + stockMenu.timeText(gametime), 16, stockMenu.inkR, stockMenu.inkG, stockMenu.inkB)
        y = y + stockMenu.rowH + 4
        for (index = 0; index < 6; index = index + 1) {
            dim = 0
            if (index == 3 && context.menu.saveallowed == 0) {
                dim = 1
            }
            stockMenu.row(y, commands[index], "", selection == index, dim)
            y = y + stockMenu.rowH
        }
        stockMenu.footer()
        return 0
    },
    mainScreen: (context) => {
        local(key) = ""
        local(done) = 0
        local(name) = ""
        local(selection) = 0
        local(parent) = stockMenu.begin(context, "main")
        while (done == 0) {
            stockMenu.drawMain(context)
            key = wait()
            if (key != "") {
                key = stockMenu.normalize(key)
                selection = stockMenu.selection()
                stockMenu.message = ""
                if (key == "up" || key == "down") {
                    if (key == "up") { selection = stockMenu.wrap(selection - 1, 6) }
                    if (key == "down") { selection = stockMenu.wrap(selection + 1, 6) }
                    stockMenu.choose(selection)
                    stockMenu.cue("move")
                }
                if (key == "menu") {
                    done = 1
                    stockMenu.cue("cancel")
                }
                if (key == "cancel") {
                    done = 1
                    stockMenu.cue("cancel")
                }
                if (key == "confirm") {
                    if (selection == 0) {
                        stockMenu.cue("choose")
                        itemmenu()
                    }
                    if (selection == 1) {
                        stockMenu.cue("choose")
                        equipmentmenu()
                    }
                    if (selection == 2) {
                        stockMenu.cue("choose")
                        abilitiesmenu()
                    }
                    if (selection == 3) {
                        if (context.menu.saveallowed == 0) {
                            stockMenu.message = "Saving is not allowed here"
                            stockMenu.cue("cancel")
                        } else {
                            stockMenu.cue("choose")
                            name = dirsav("Save game", 1, 0, 0, "")
                            if (name != "CANCEL") {
                                save(name)
                                stockMenu.message = "Saved " + name
                            }
                        }
                    }
                    if (selection == 4) {
                        stockMenu.cue("choose")
                        name = dirsav("Load game", 0, 0, 0, "")
                        if (name != "CANCEL") {
                            load(name)
                            done = 1
                        }
                    }
                    if (selection == 5) {
                        done = 1
                        stockMenu.cue("choose")
                        dos()
                    }
                }
            }
        }
        stockMenu.close(parent)
        return 0
    },

    // ---- the items screen ------------------------------------------------------------------------------------
    drawItems: (context) => {
        local(count) = stockMenu.stacks(context)
        local(index) = 0
        local(position) = 0
        local(y) = 0
        local(selection) = stockMenu.selection()
        local(actions) = {}
        actions[0] = "Use"
        actions[1] = "Info"
        actions[2] = "Drop"
        local(page) = integermuldiv(selection, 1, stockMenu.pageSize)
        local(first) = page * stockMenu.pageSize
        stockMenu.clearPanel()
        if (stockMenu.mode == "list") {
            stockMenu.header("Items")
            y = stockMenu.listTop + 28
            for (position = first; position < count && position < first + stockMenu.pageSize; position = position + 1) {
                stockMenu.row(y, stockMenu.stackHandles[position], "x " + stockMenu.stackQty[position], selection == position, 0)
                y = y + stockMenu.rowH
            }
            if (count == 0) {
                stockMenu.words(stockMenu.labelX, stockMenu.listTop + 28, "Nothing carried", 16, stockMenu.dimR, stockMenu.dimG, stockMenu.dimB)
            }
        }
        if (stockMenu.mode == "action") {
            stockMenu.header(stockMenu.stackHandles[selection])
            y = stockMenu.listTop + 28
            for (index = 0; index < 3; index = index + 1) {
                stockMenu.row(y, actions[index], "", stockMenu.slot == index, 0)
                y = y + stockMenu.rowH
            }
        }
        if (stockMenu.mode == "member") {
            local(members) = stockMenu.members(context)
            stockMenu.header("Use on")
            y = stockMenu.listTop + 28
            for (index = 0; index < stockMenu.memberCount; index = index + 1) {
                stockMenu.row(y, members[index].name, "", stockMenu.member == index, 0)
                y = y + stockMenu.rowH
            }
        }
        if (stockMenu.mode == "info") {
            local(data) = stockMenu.itemData(stockMenu.stackSources[selection])
            stockMenu.header(stockMenu.stackHandles[selection])
            if (data.description == "") {
                stockMenu.words(stockMenu.labelX, stockMenu.listTop + 28, stockMenu.stackHandles[selection], 16, stockMenu.inkR, stockMenu.inkG, stockMenu.inkB)
            } else {
                stockMenu.words(stockMenu.labelX, stockMenu.listTop + 28, data.description, 16, stockMenu.inkR, stockMenu.inkG, stockMenu.inkB)
            }
        }
        stockMenu.footer()
        return 0
    },
    itemScreen: (context) => {
        local(key) = ""
        local(done) = 0
        local(selection) = 0
        local(result)
        local(data)
        local(actorId) = 0
        local(parent) = stockMenu.begin(context, "items")
        local(previousMode) = ""
        stockMenu.mode = "list"
        stockMenu.slot = 0
        stockMenu.member = 0
        while (done == 0) {
            stockMenu.drawItems(context)
            key = wait()
            if (key != "") {
                key = stockMenu.normalize(key)
                previousMode = stockMenu.mode
                stockMenu.message = ""
                selection = stockMenu.selection()
                if (previousMode == "list") {
                    if (key == "up" || key == "down" || key == "left" || key == "right") {
                        if (key == "up") { selection = stockMenu.wrap(selection - 1, stockMenu.stackCount) }
                        if (key == "down") { selection = stockMenu.wrap(selection + 1, stockMenu.stackCount) }
                        if (key == "left") {
                            selection = selection - stockMenu.pageSize
                            if (selection < 0) { selection = 0 }
                        }
                        if (key == "right") {
                            selection = selection + stockMenu.pageSize
                            if (selection > stockMenu.stackCount - 1) { selection = stockMenu.stackCount - 1 }
                            if (selection < 0) { selection = 0 }
                        }
                        stockMenu.choose(selection)
                        stockMenu.cue("move")
                    }
                    if (key == "confirm") {
                        if (stockMenu.stackCount > 0) {
                            stockMenu.mode = "action"
                            stockMenu.slot = 0
                            stockMenu.cue("choose")
                        }
                    }
                    if (key == "cancel" || key == "menu") {
                        done = 1
                        stockMenu.cue("cancel")
                    }
                } else {
                    // Every sub-screen keeps its own index: `selection` is the stack while the list has the cursor.
                    stockMenu.withMember(stockMenu.context.party.selected, selection)
                }
                if (previousMode == "action") {
                    if (key == "up" || key == "down") {
                        if (key == "up") { stockMenu.slot = stockMenu.wrap(stockMenu.slot - 1, 3) }
                        if (key == "down") { stockMenu.slot = stockMenu.wrap(stockMenu.slot + 1, 3) }
                        stockMenu.cue("move")
                    }
                    if (key == "cancel") {
                        stockMenu.mode = "list"
                        stockMenu.cue("cancel")
                    }
                    if (key == "menu") {
                        done = 1
                        stockMenu.cue("cancel")
                    }
                    if (key == "confirm") {
                        if (stockMenu.slot == 0) {
                            if (stockMenu.stackQty[selection] < 1) {
                                stockMenu.message = "Nothing to use"
                                stockMenu.cue("cancel")
                            } else {
                                stockMenu.mode = "member"
                                stockMenu.member = 0
                                stockMenu.cue("choose")
                            }
                        }
                        if (stockMenu.slot == 1) {
                            stockMenu.mode = "info"
                            stockMenu.cue("choose")
                        }
                        if (stockMenu.slot == 2) {
                            data = stockMenu.itemData(stockMenu.stackSources[selection])
                            if (data.keyitem != 0) {
                                stockMenu.message = "Key items cannot be dropped"
                                stockMenu.cue("cancel")
                            } else {
                                if (stockMenu.stackQty[selection] < 1) {
                                    stockMenu.message = "Nothing to drop"
                                    stockMenu.cue("cancel")
                                } else {
                                    context.inventory.removeItem({ entryId: stockMenu.stackIds[selection], amount: 1 })
                                    stockMenu.mode = "list"
                                    stockMenu.message = "Dropped " + stockMenu.stackHandles[selection]
                                    stockMenu.cue("choose")
                                }
                            }
                        }
                    }
                } else {
                    if (previousMode == "member") {
                        if (key == "up" || key == "down") {
                            if (key == "up") { stockMenu.member = stockMenu.wrap(stockMenu.member - 1, stockMenu.memberCount) }
                            if (key == "down") { stockMenu.member = stockMenu.wrap(stockMenu.member + 1, stockMenu.memberCount) }
                            stockMenu.cue("move")
                        }
                        if (key == "cancel") {
                            stockMenu.mode = "action"
                            stockMenu.cue("cancel")
                        }
                        if (key == "menu") {
                            done = 1
                            stockMenu.cue("cancel")
                        }
                        if (key == "confirm") {
                            if (stockMenu.memberCount > 0) {
                                actorId = stockMenu.memberIds[stockMenu.member]
                                result = context.inventory.use({ entryId: stockMenu.stackIds[selection], actorId: actorId })
                                if (result.status == "complete") {
                                    stockMenu.mode = "list"
                                    stockMenu.message = "Used " + stockMenu.stackHandles[selection]
                                    stockMenu.cue("choose")
                                } else {
                                    stockMenu.message = result.error.message
                                    stockMenu.cue("cancel")
                                }
                            }
                        }
                    } else {
                        if (previousMode == "info") {
                            if (key == "cancel") {
                                stockMenu.mode = "action"
                                stockMenu.cue("cancel")
                            }
                            if (key == "menu") {
                                done = 1
                                stockMenu.cue("cancel")
                            }
                        }
                    }
                }
            }
        }
        stockMenu.close(parent)
        return 0
    },

    // ---- the equipment screen --------------------------------------------------------------------------------
    drawEquipment: (context) => {
        local(index) = 0
        local(y) = 0
        local(actorId) = 0
        local(slot) = ""
        local(itemId) = 0
        local(handle) = "-"
        local(character)
        local(data)
        local(position) = 0
        local(shown) = 0
        stockMenu.clearPanel()
        if (stockMenu.mode == "member") {
            local(members) = stockMenu.members(context)
            stockMenu.header("Equip")
            y = stockMenu.listTop + 28
            for (index = 0; index < stockMenu.memberCount; index = index + 1) {
                stockMenu.row(y, members[index].name, "", stockMenu.member == index, 0)
                y = y + stockMenu.rowH
            }
        }
        if (stockMenu.mode == "slot") {
            actorId = stockMenu.memberIds[stockMenu.member]
            stockMenu.stacks(context)
            stockMenu.header("Slot")
            y = stockMenu.listTop + 28
            for (index = 0; index < 16; index = index + 1) {
                slot = stockMenu.slotTokens[index]
                itemId = stockMenu.equippedAt(context, actorId, slot)
                handle = "-"
                if (itemId != 0) {
                    handle = stockMenu.handleOfStack(itemId)
                }
                stockMenu.row(y, slot, handle, stockMenu.slot == index, 0)
                y = y + stockMenu.rowH
            }
        }
        if (stockMenu.mode == "item") {
            actorId = stockMenu.memberIds[stockMenu.member]
            slot = stockMenu.slotTokens[stockMenu.slot]
            stockMenu.buildItemList(context)
            stockMenu.header(slot)
            y = stockMenu.listTop + 28
            if (stockMenu.listHasRemove == 1) {
                stockMenu.row(y, "Remove", "", stockMenu.selection() == 0, 0)
                y = y + stockMenu.rowH
            }
            for (position = 0; position < stockMenu.itemcount; position = position + 1) {
                shown = position
                if (stockMenu.listHasRemove == 1) {
                    shown = position + 1
                }
                stockMenu.row(y, stockMenu.stackHandles[stockMenu.listPositions[position]], "", stockMenu.selection() == shown, 0)
                y = y + stockMenu.rowH
            }
            if (stockMenu.itemcount == 0 && stockMenu.listHasRemove == 0) {
                stockMenu.words(stockMenu.labelX, stockMenu.listTop + 28, "Nothing fits", 16, stockMenu.dimR, stockMenu.dimG, stockMenu.dimB)
            }
        }
        stockMenu.footer()
        return 0
    },
    // The stacks whose definition fits the chosen slot for this character, in stack-id order (E-82 filter).
    buildItemList: (context) => {
        local(actorId) = stockMenu.memberIds[stockMenu.member]
        local(slot) = stockMenu.slotTokens[stockMenu.slot]
        local(member) = stockMenu.members(context)[stockMenu.member]
        local(character) = stockMenu.characterData(member.source, actorId)
        local(position) = 0
        local(data)
        local(usable) = 0
        stockMenu.stacks(context)
        stockMenu.itemcount = 0
        stockMenu.listPositions = {}
        stockMenu.listHasRemove = 0
        if (stockMenu.equippedAt(context, actorId, slot) != 0) {
            stockMenu.listHasRemove = 1
        }
        for (position = 0; position < stockMenu.stackCount; position = position + 1) {
            data = stockMenu.itemData(stockMenu.stackSources[position])
            usable = 0
            if (stockMenu.fits(data, character, slot) == 1) {
                usable = 1
                if (data.usedby == 1 && stockMenu.namesInclude(data.allowed, member.name) != 1) {
                    usable = 0
                }
            }
            if (usable == 1) {
                stockMenu.listPositions[stockMenu.itemcount] = position
                stockMenu.itemcount = stockMenu.itemcount + 1
            }
        }
        return stockMenu.itemcount
    },
    equipmentScreen: (context) => {
        local(key) = ""
        local(done) = 0
        local(actorId) = 0
        local(slot) = ""
        local(result)
        local(member)
        local(character)
        local(position) = 0
        local(shown) = 0
        local(usable) = 0
        local(data)
        local(hasRemove) = 0
        local(cursor) = 0
        local(parent) = stockMenu.begin(context, "equipment")
        stockMenu.mode = "member"
        stockMenu.member = 0
        stockMenu.slot = 0
        while (done == 0) {
            stockMenu.drawEquipment(context)
            key = wait()
            if (key != "") {
                key = stockMenu.normalize(key)
                stockMenu.message = ""
                cursor = stockMenu.selection()
                if (stockMenu.mode == "member") {
                    if (key == "up" || key == "down") {
                        if (key == "up") { stockMenu.member = stockMenu.wrap(stockMenu.member - 1, stockMenu.memberCount) }
                        if (key == "down") { stockMenu.member = stockMenu.wrap(stockMenu.member + 1, stockMenu.memberCount) }
                        stockMenu.cue("move")
                    }
                    if (key == "cancel" || key == "menu") {
                        done = 1
                        stockMenu.cue("cancel")
                    }
                    if (key == "confirm") {
                        if (stockMenu.memberCount > 0) {
                            stockMenu.mode = "slot"
                            stockMenu.slot = 0
                            stockMenu.withMember(stockMenu.memberIds[stockMenu.member], 0)
                            stockMenu.cue("choose")
                        }
                    }
                } else {
                    if (stockMenu.mode == "slot") {
                        if (key == "up" || key == "down") {
                            if (key == "up") { stockMenu.slot = stockMenu.wrap(stockMenu.slot - 1, 16) }
                            if (key == "down") { stockMenu.slot = stockMenu.wrap(stockMenu.slot + 1, 16) }
                            stockMenu.choose(stockMenu.slot)
                            stockMenu.cue("move")
                        }
                        if (key == "cancel") {
                            stockMenu.mode = "member"
                            stockMenu.cue("cancel")
                        }
                        if (key == "menu") {
                            done = 1
                            stockMenu.cue("cancel")
                        }
                        if (key == "confirm") {
                            stockMenu.mode = "item"
                            stockMenu.choose(0)
                            stockMenu.cue("choose")
                        }
                    } else {
                        if (stockMenu.mode == "item") {
                            actorId = stockMenu.memberIds[stockMenu.member]
                            slot = stockMenu.slotTokens[stockMenu.slot]
                            hasRemove = stockMenu.listHasRemove
                            shown = stockMenu.itemcount
                            if (hasRemove == 1) {
                                shown = shown + 1
                            }
                            if (key == "up" || key == "down") {
                                cursor = stockMenu.wrap(cursor, shown)
                                if (key == "up") { cursor = stockMenu.wrap(cursor - 1, shown) }
                                if (key == "down") { cursor = stockMenu.wrap(cursor + 1, shown) }
                                stockMenu.choose(cursor)
                                stockMenu.cue("move")
                            }
                            if (key == "cancel") {
                                stockMenu.mode = "slot"
                                stockMenu.choose(stockMenu.slot)
                                stockMenu.cue("cancel")
                            }
                            if (key == "menu") {
                                done = 1
                                stockMenu.cue("cancel")
                            }
                            if (key == "confirm") {
                                if (hasRemove == 1 && cursor == 0) {
                                    result = context.inventory.removeEquipment({ actorId: actorId, slot: slot })
                                } else {
                                    position = cursor
                                    if (hasRemove == 1) {
                                        position = cursor - 1
                                    }
                                    if (position < stockMenu.itemcount) {
                                        result = context.inventory.replace({ entryId: stockMenu.stackIds[stockMenu.listPositions[position]], actorId: actorId, slot: slot })
                                    }
                                }
                                if (result.status == "complete") {
                                    stockMenu.mode = "slot"
                                    stockMenu.choose(stockMenu.slot)
                                    stockMenu.message = "Equipped"
                                    stockMenu.cue("choose")
                                } else {
                                    stockMenu.message = result.error.message
                                    stockMenu.cue("cancel")
                                }
                            }
                        }
                    }
                }
            }
        }
        stockMenu.close(parent)
        return 0
    },
    namesInclude: (allowed, name) => {
        local(index) = 0
        for (index = 0; index < allowed.length; index = index + 1) {
            if (allowed[index] == name) {
                return 1
            }
        }
        return 0
    },

    // ---- the abilities screen --------------------------------------------------------------------------------
    moves: (context, member) => {
        local(data) = stockMenu.characterData(member.source, member.id)
        local(slots) = data.specialmoves
        local(index) = 0
        local(count) = slots.length
        local(move)
        local(spc)
        stockMenu.moveCount = 0
        stockMenu.moveFiles = {}
        stockMenu.moveNames = {}
        stockMenu.moveCosts = {}
        for (index = 0; index < count; index = index + 1) {
            move = slots[index]
            if (move.available == 1) {
                spc = battlemovedata(move.file)
                if (spc != null) {
                    // The `.spc` menu byte decides usability from the menu: 0 is usable, non-zero is not.
                    if (spc.menu == 0) {
                        stockMenu.moveFiles[stockMenu.moveCount] = move.file
                        stockMenu.moveNames[stockMenu.moveCount] = move.file
                        stockMenu.moveCosts[stockMenu.moveCount] = spc.smp
                        stockMenu.moveCount = stockMenu.moveCount + 1
                    }
                }
            }
        }
        return 0
    },
    moveDescription: (file) => {
        local(spc) = battlemovedata(file)
        if (spc == null) {
            return ""
        }
        return spc.description
    },
    drawAbilities: (context) => {
        local(index) = 0
        local(y) = 0
        local(actions) = {}
        actions[0] = "Use"
        actions[1] = "Info"
        local(selection) = stockMenu.selection()
        stockMenu.clearPanel()
        if (stockMenu.mode == "member") {
            local(members) = stockMenu.members(context)
            stockMenu.header("Abilities")
            y = stockMenu.listTop + 28
            for (index = 0; index < stockMenu.memberCount; index = index + 1) {
                stockMenu.row(y, members[index].name, "", stockMenu.member == index, 0)
                y = y + stockMenu.rowH
            }
        }
        if (stockMenu.mode == "list") {
            stockMenu.header("Abilities")
            y = stockMenu.listTop + 28
            for (index = 0; index < stockMenu.moveCount; index = index + 1) {
                stockMenu.row(y, stockMenu.moveNames[index], "SMP " + stockMenu.moveCosts[index], selection == index, 0)
                y = y + stockMenu.rowH
            }
            if (stockMenu.moveCount == 0) {
                stockMenu.words(stockMenu.labelX, stockMenu.listTop + 28, "No usable moves", 16, stockMenu.dimR, stockMenu.dimG, stockMenu.dimB)
            }
        }
        if (stockMenu.mode == "action") {
            stockMenu.header(stockMenu.moveNames[selection])
            y = stockMenu.listTop + 28
            for (index = 0; index < 2; index = index + 1) {
                stockMenu.row(y, actions[index], "", stockMenu.slot == index, 0)
                y = y + stockMenu.rowH
            }
        }
        if (stockMenu.mode == "info") {
            local(text) = stockMenu.moveDescription(stockMenu.moveFiles[selection])
            stockMenu.header(stockMenu.moveNames[selection])
            if (text == "") {
                stockMenu.words(stockMenu.labelX, stockMenu.listTop + 28, stockMenu.moveNames[selection], 16, stockMenu.inkR, stockMenu.inkG, stockMenu.inkB)
            } else {
                stockMenu.words(stockMenu.labelX, stockMenu.listTop + 28, text, 16, stockMenu.inkR, stockMenu.inkG, stockMenu.inkB)
            }
        }
        stockMenu.footer()
        return 0
    },
    abilitiesScreen: (context) => {
        local(key) = ""
        local(done) = 0
        local(member)
        local(spc)
        local(program) = ""
        local(parent) = stockMenu.begin(context, "abilities")
        stockMenu.mode = "member"
        stockMenu.member = 0
        stockMenu.slot = 0
        while (done == 0) {
            stockMenu.drawAbilities(context)
            key = wait()
            if (key != "") {
                key = stockMenu.normalize(key)
                stockMenu.message = ""
                if (stockMenu.mode == "member") {
                    if (key == "up" || key == "down") {
                        if (key == "up") { stockMenu.member = stockMenu.wrap(stockMenu.member - 1, stockMenu.memberCount) }
                        if (key == "down") { stockMenu.member = stockMenu.wrap(stockMenu.member + 1, stockMenu.memberCount) }
                        stockMenu.cue("move")
                    }
                    if (key == "cancel" || key == "menu") {
                        done = 1
                        stockMenu.cue("cancel")
                    }
                    if (key == "confirm") {
                        if (stockMenu.memberCount > 0) {
                            member = stockMenu.members(context)[stockMenu.member]
                            stockMenu.moves(context, member)
                            stockMenu.mode = "list"
                            stockMenu.withMember(member.id, 0)
                            stockMenu.cue("choose")
                        }
                    }
                } else {
                    if (stockMenu.mode == "list") {
                        if (key == "up" || key == "down") {
                            if (key == "up") { stockMenu.choose(stockMenu.wrap(stockMenu.selection() - 1, stockMenu.moveCount)) }
                            if (key == "down") { stockMenu.choose(stockMenu.wrap(stockMenu.selection() + 1, stockMenu.moveCount)) }
                            stockMenu.cue("move")
                        }
                        if (key == "cancel") {
                            stockMenu.mode = "member"
                            stockMenu.cue("cancel")
                        }
                        if (key == "menu") {
                            done = 1
                            stockMenu.cue("cancel")
                        }
                        if (key == "confirm") {
                            if (stockMenu.moveCount > 0) {
                                stockMenu.mode = "action"
                                stockMenu.slot = 0
                                stockMenu.cue("choose")
                            }
                        }
                    } else {
                        if (stockMenu.mode == "action") {
                            if (key == "up" || key == "down") {
                                if (key == "up") { stockMenu.slot = stockMenu.wrap(stockMenu.slot - 1, 2) }
                                if (key == "down") { stockMenu.slot = stockMenu.wrap(stockMenu.slot + 1, 2) }
                                stockMenu.cue("move")
                            }
                            if (key == "cancel") {
                                stockMenu.mode = "list"
                                stockMenu.cue("cancel")
                            }
                            if (key == "menu") {
                                done = 1
                                stockMenu.cue("cancel")
                            }
                            if (key == "confirm") {
                                if (stockMenu.slot == 1) {
                                    stockMenu.mode = "info"
                                    stockMenu.cue("choose")
                                } else {
                                    spc = battlemovedata(stockMenu.moveFiles[stockMenu.selection()])
                                    program = ""
                                    if (spc != null) {
                                        program = spc.program
                                    }
                                    if (program == "") {
                                        stockMenu.message = "Nothing happens"
                                    } else {
                                        member = stockMenu.members(context)[stockMenu.member]
                                        executeprogram(program, { source: "" + member.handle, target: "" + member.handle })
                                        stockMenu.message = "Used " + stockMenu.moveNames[stockMenu.selection()]
                                    }
                                    stockMenu.mode = "list"
                                    stockMenu.cue("choose")
                                }
                            }
                        } else {
                            if (stockMenu.mode == "info") {
                                if (key == "cancel") {
                                    stockMenu.mode = "action"
                                    stockMenu.cue("cancel")
                                }
                                if (key == "menu") {
                                    done = 1
                                    stockMenu.cue("cancel")
                                }
                            }
                        }
                    }
                }
            }
        }
        stockMenu.close(parent)
        return 0
    },

    // ---- the save/load picker (dirsav) -----------------------------------------------------------------------
    pick: (context, title, allowNew) => {
        local(key) = ""
        local(done) = 0
        local(list) = savelist()
        local(index) = 0
        local(count) = 0
        local(selection) = 0
        local(name) = ""
        local(answer) = ""
        local(y) = 0
        local(first) = 0
        local(shown) = 0
        local(choice) = ""
        stockMenu.saveNames = {}
        stockMenu.saveCount = 0
        for (index = 0; index < list.length; index = index + 1) {
            name = list[index].name
            // The picker shows the base name: `save(name)`/`load(name)` append the extension themselves.
            if (name != "") {
                if (len(name) > 4 && right(name, 4) == ".sav") {
                    name = left(name, len(name) - 4)
                }
                stockMenu.saveNames[stockMenu.saveCount] = name
                stockMenu.saveCount = stockMenu.saveCount + 1
            }
        }
        count = stockMenu.saveCount
        if (allowNew != 0) {
            count = count + 1
        }
        local(parent) = stockMenu.begin(context, "picker")
        while (done == 0) {
            stockMenu.clearPanel()
            stockMenu.header(title)
            y = stockMenu.listTop + 28
            for (index = 0; index < stockMenu.saveCount; index = index + 1) {
                stockMenu.row(y, stockMenu.saveNames[index], "", selection == index, 0)
                y = y + stockMenu.rowH
            }
            if (allowNew != 0) {
                stockMenu.row(y, "New save", "", selection == stockMenu.saveCount, 0)
            }
            if (stockMenu.saveCount == 0 && allowNew == 0) {
                stockMenu.words(stockMenu.labelX, stockMenu.listTop + 28, "No saves", 16, stockMenu.dimR, stockMenu.dimG, stockMenu.dimB)
            }
            key = wait()
            if (key != "") {
                key = stockMenu.normalize(key)
                if (key == "up" || key == "down") {
                    if (key == "up") { selection = stockMenu.wrap(selection - 1, count) }
                    if (key == "down") { selection = stockMenu.wrap(selection + 1, count) }
                    stockMenu.cue("move")
                }
                if (key == "cancel" || key == "menu") {
                    choice = "CANCEL"
                    done = 1
                    stockMenu.cue("cancel")
                }
                if (key == "confirm") {
                    if (count > 0) {
                        if (selection < stockMenu.saveCount) {
                            choice = stockMenu.saveNames[selection]
                        } else {
                            answer = prompt("Save name")
                            if (answer == "") {
                                choice = "CANCEL"
                            } else {
                                choice = answer
                            }
                        }
                        done = 1
                        stockMenu.cue("choose")
                    }
                }
            }
        }
        stockMenu.close(parent)
        return choice
    },
}

stockMenu.slotTokens[0] = "head"
stockMenu.slotTokens[1] = "neck"
stockMenu.slotTokens[2] = "right-hand"
stockMenu.slotTokens[3] = "left-hand"
stockMenu.slotTokens[4] = "body"
stockMenu.slotTokens[5] = "legs"
stockMenu.slotTokens[6] = "accessory-7"
stockMenu.slotTokens[7] = "accessory-8"
stockMenu.slotTokens[8] = "accessory-9"
stockMenu.slotTokens[9] = "accessory-10"
stockMenu.slotTokens[10] = "accessory-11"
stockMenu.slotTokens[11] = "accessory-12"
stockMenu.slotTokens[12] = "accessory-13"
stockMenu.slotTokens[13] = "accessory-14"
stockMenu.slotTokens[14] = "accessory-15"
stockMenu.slotTokens[15] = "accessory-16"

// ---- registration -------------------------------------------------------------------------------------------
// `internalmenu` stays the passthrough onto the facade; `dirsav` is the menu's own save/load picker, which is why it
// lives in this package rather than in the catalogue. The four providers replace the whole screen for their token.
registerplugin({
    name: "stock_menu",
    commands: {
        internalmenu: (menu, next) => {
            return next(menu)
        },
        dirsav: (title, allowNewFile, textColor, backColor, image, next) => {
            local(selected) = stockMenu.pick(stockMenu.context, title, allowNewFile)
            return selected
        },
    },
    menuProviders: {
        main: (context) => {
            return stockMenu.mainScreen(context)
        },
        items: (context) => {
            return stockMenu.itemScreen(context)
        },
        equipment: (context) => {
            return stockMenu.equipmentScreen(context)
        },
        abilities: (context) => {
            return stockMenu.abilitiesScreen(context)
        },
    },
})
