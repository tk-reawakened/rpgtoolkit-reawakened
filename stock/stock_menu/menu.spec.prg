beforeEach(() => { executeprogram("startup.prg") })

describe("stock menu navigation", () => {
    it("normalizes legacy keys", () => {
        expect(stockMenu.normalize("UP")).toBe("up")
        expect(stockMenu.normalize("ENTER")).toBe("confirm")
        expect(stockMenu.normalize("ESC")).toBe("cancel")
        expect(stockMenu.normalize("menu")).toBe("menu")
    })
    it("chooses the first row of the selected page", () => {
        expect(stockMenu.firstOf(2, 6, 6)).toBe(0)
        expect(stockMenu.firstOf(7, 14, 6)).toBe(6)
        expect(stockMenu.firstOf(13, 14, 6)).toBe(12)
    })
})
