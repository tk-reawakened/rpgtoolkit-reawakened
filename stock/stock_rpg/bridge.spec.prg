beforeEach(() => { executeprogram("startup.prg") })

it("forwards completed dialogue to the speaking actor", () => {
    seenCount = 0
    seenActor = 0
    seenTarget = 0
    seenText = ""
    gameSeen = 0
    game.on("dialogue.completed", (event) => { :gameSeen = :gameSeen + 1; :receivedActor = event.detail.actorId; :receivedTarget = event.detail.targetId; :receivedText = event.detail.text })
    specActor.on("talked", (event) => {
        :seenCount = :seenCount + 1
        :seenActor = event.detail["actorId"]
        :seenTarget = event.detail["targetId"]
        :seenText = event.detail.text
    })
    game.emit("dialogue.completed", { actorId: specActorId, targetId: specActorId, text: "Hello" })
    threadsleep(getthreadid(), 0.1)
    expect(gameSeen).toBe(1)
    expect(receivedActor).toBe(specActorId)
    expect(receivedTarget).toBe(specActorId)
    expect(receivedText).toBe("Hello")
    expect(seenCount).toBe(1)
    expect(seenActor).toBe(specActorId)
    expect(seenTarget).toBe(specActorId)
    expect(seenText).toBe("Hello")
})
it("forwards completed dialogue without a target", () => {
    seenCount = 0
    seenActor = 0
    seenTarget = -1
    seenText = ""
    specActor.on("talked", (event) => {
        :seenCount = :seenCount + 1
        :seenActor = event.detail["actorId"]
        :seenTarget = event.detail["targetId"]
        :seenText = event.detail["text"]
    })
    game.emit("dialogue.completed", { actorId: specActorId, targetId: 0, text: "No target" })
    threadsleep(getthreadid(), 0.1)
    expect(seenCount).toBe(1)
    expect(seenActor).toBe(specActorId)
    expect(seenTarget).toBe(0)
    expect(seenText).toBe("No target")
})
