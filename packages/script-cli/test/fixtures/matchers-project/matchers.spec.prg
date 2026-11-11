function raise() { missingCommand() }

describe("matchers that read arrays, doubles and errors", () => {
  beforeAll(() => { shared = 7 })
  it("compares element arrays element by element", () => {
    a[0][0] = 1
    a[0][1] = 2
    b[0][0] = 1
    b[0][1] = 2
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
  it("looks inside a string and an array", () => {
    list[0] = "x"
    list[1] = 5
    expect("hello world").toContain("lo w")
    expect(list).toContain(5)
  })
  it("compares fractions at a tolerance", () => {
    x = 1.5
    expect(x + 0.25).toBeCloseTo(1.25, 0.001)
  })
  it("sees an error raised in a nested call", () => {
    expect(() => raise()).toThrow()
  })
  it("starts from the group snapshot", () => {
    expect(shared).toBe(7)
  })
})
