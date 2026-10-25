fighter = battle.fighter(1, 0)
statusLog = ""
fighter.on("statusChanged", (event) => { statusLog = statusLog + event.detail.rounds + ":" + event.detail.expired + ":" + event.detail.source + ";" })
applystatus("Hero", "StatusE/poison.ste")
removestatus("Hero", "StatusE/poison.ste")
