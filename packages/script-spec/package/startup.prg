// The script-spec library (docs/spec/engine/rpgcode-tooling.md#tool-5,
// docs/spec/engine/rpgcode-functions.md#tooling-the-rpgcode-spec-package).
// Every name here is RPGCode; the only native command is specResult, which the
// test runner registers and which records one outcome with this call's position.

global(specDepth)
global(specBeforeEach)
global(specAfterEach)
global(specAfterAll)
global(specNegate)
global(specOnlyUsed)

specBeforeEach = {}
specAfterEach = {}
specAfterAll = {}

function specCheck(ok, name, expected, actual) {
  local(result)
  result = ok
  if (specNegate) { result = !result }
  specNegate = 0
  if (result) { specResult("pass", name, "", "") }
  else { specResult("fail", name, expected, actual) }
}

// Scalar equality only; arrays need a type test the catalogue does not have.
function specEqual(a, b) {
  if (a == b) { return 1 }
  return 0
}

function specFlash(expected, actual) {
  if (specNegate == 1) { specNegate = 0; return actual ~= expected }
  return actual ~= expected
}

// Hook order inside one describe: beforeAll runs when it is registered (before
// the cases below it), then each case is wrapped by its enclosing levels'
// beforeEach outermost-first and afterEach innermost-first, and afterAll runs
// once when the describe body returns.
function describe(name, body) {
  specDepth = specDepth + 1
  body()
  if (specAfterAll[specDepth] != 0) { specAfterAll[specDepth]() }
  specAfterAll[specDepth] = 0
  specBeforeEach[specDepth] = 0
  specAfterEach[specDepth] = 0
  specDepth = specDepth - 1
}

function it(name, body) {
  local(level)
  for (level = 1; level <= specDepth; level = level + 1) {
    if (specBeforeEach[level] != 0) { specBeforeEach[level]() }
  }
  body()
  for (level = specDepth; level >= 1; level = level - 1) {
    if (specAfterEach[level] != 0) { specAfterEach[level]() }
  }
}

function test(name, body) {
  it(name, body)
}

function beforeEach(body) {
  specBeforeEach[specDepth] = body
}

function afterEach(body) {
  specAfterEach[specDepth] = body
}

function beforeAll(body) {
  body()
}

function afterAll(body) {
  specAfterAll[specDepth] = body
}

function skip(name, body) {
  // A skip respects the runner's per-case filter like `it`, so an isolated run of
  // another case does not report it.
  specCaseIndex = specCaseIndex + 1
  if (specOnlyCase >= 0) {
    if (specCaseIndex != specOnlyCase) { return }
  }
  specResult("skip", name, "", "")
}

function only(name, body) {
  specOnlyUsed = 1
  specResult("only", name, "", "")
  it(name, body)
}

function expect(actual) {
  return {
    toBe: (expected) => specCheck(actual == expected, "toBe", expected, actual),
    toEqual: (expected) => specCheck(specEqual(actual, expected), "toEqual", expected, actual),
    toBeTruthy: () => specCheck(actual != 0, "toBeTruthy", 1, actual),
    toBeNull: () => specCheck(actual == 0, "toBeNull", 0, actual),
    toContain: (needle) => specCheck(specContains(actual, needle), "toContain", needle, actual),
    // The tolerance is optional; an omitted (or zero) argument means 1e-7.
    toBeCloseTo: (expected, tolerance) => specCheck(specClose(actual, expected, tolerance), "toBeCloseTo", expected, actual),
    toThrow: (body) => specCheck(0, "toThrow", "a runtime error", "no error"),
    not: {
      toBe: (expected) => { specNegate = 1; specCheck(actual == expected, "toBe", expected, actual) },
      toEqual: (expected) => { specNegate = 1; specCheck(actual == expected, "toEqual", expected, actual) },
      toBeTruthy: () => { specNegate = 1; specCheck(actual != 0, "toBeTruthy", 1, actual) },
      toBeNull: () => { specNegate = 1; specCheck(actual == 0, "toBeNull", 0, actual) },
      toContain: (needle) => { specNegate = 1; specCheck(specContains(actual, needle), "toContain", needle, actual) },
      toBeCloseTo: (expected, tolerance) => { specNegate = 1; specCheck(specClose(actual, expected, tolerance), "toBeCloseTo", expected, actual) }
    }
  }
}

// Strings only: the catalogue has no type test or array length, so an array
// needle cannot be searched from script (reported in the 10.8 plan; needs an
// owner ruling, not a silent wrong answer).
function specContains(value, needle) {
  if (instr(value, needle) > 0) { return 1 }
  return 0
}

// |value - expected| <= limit. The limit is 1e-7 unless a non-zero tolerance is
// given; a callable must be called with its declared arity (ERR-2), so the
// "optional" argument is expressed as 0 rather than omitted.
function specClose(value, expected, tolerance) {
  local(limit)
  local(diff)
  limit = 0.0000001
  if (tolerance != 0) { limit = tolerance }
  diff = value - expected
  if (diff < 0) { diff = 0 - diff }
  if (diff <= limit) { return 1 }
  return 0
}
