beforeEach(() => { executeprogram("startup.prg") })

describe("stock battle outcome", () => {
    it("continues while both parties have living fighters", () => {
        stockBattle.fighterCounts = { players: 1, enemies: 1 }
        stockBattle.livingCounts = { players: 1, enemies: 1 }
        stockBattle.refreshPendingOutcome()
        expect(stockBattle.pendingOutcome).toBe(0)
    })
    it("declares victory when all enemies have fallen", () => {
        stockBattle.fighterCounts = { players: 1, enemies: 2 }
        stockBattle.livingCounts = { players: 1, enemies: 0 }
        stockBattle.refreshPendingOutcome()
        expect(stockBattle.pendingOutcome).toBe(2)
    })
    it("prioritizes defeat when both parties have fallen", () => {
        stockBattle.fighterCounts = { players: 1, enemies: 1 }
        stockBattle.livingCounts = { players: 0, enemies: 0 }
        stockBattle.refreshPendingOutcome()
        expect(stockBattle.pendingOutcome).toBe(4)
    })
})
