beforeEach(() => { executeprogram("startup.prg") })

it("forwards completed dialogue to the speaking actor", () => {
    seenCount = 0
    seenText = ""
    gameSeen = 0
    game.on("dialogue.completed", (event) => { :gameSeen = :gameSeen + 1; :receivedActor = event.detail.actorId; :receivedTarget = event.detail.targetId; :receivedText = event.detail.text })
    specActor.on("talked", (event) => {
        :seenCount = :seenCount + 1
        :seenText = event.detail.text
    })
    game.emit("dialogue.completed", { actorId: specActorId, targetId: specActorId, text: "Hello" })
    threadsleep(getthreadid(), 0.1)
    expect(gameSeen).toBe(1)
    expect(receivedActor).toBe(specActorId)
    expect(receivedTarget).toBe(specActorId)
    expect(receivedText).toBe("Hello")
    expect(seenCount).toBe(1)
    expect(seenText).toBe("Hello")
})
