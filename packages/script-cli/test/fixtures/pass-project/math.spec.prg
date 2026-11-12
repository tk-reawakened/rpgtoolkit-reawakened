describe("math", () => {
  it("adds", () => { expect(1 + 1).toBe(2) })
  it("subtracts", () => { expect(3 - 1).toEqual(2) })
})

function guarded() { on error goto :done; n = len("ab"); :done; return n }

it("the engine built-ins are available to specs", () => {
  expect(len("abc")).toBe(3)
  expect(castint(7.9)).toBe(7)
  expect(instr("hello", "ll")).toBe(3)
  autoLocal(true)
  temp = 5
  autoLocal(false)
  expect(guarded()).toBe(2)
})
