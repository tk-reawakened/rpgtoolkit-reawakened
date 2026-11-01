// The script-spec library (docs/spec/engine/rpgcode-tooling.md#tool-5,
// docs/spec/engine/rpgcode-functions.md#tooling-the-rpgcode-spec-package).
// Every name here is RPGCode; the only native command is specResult, which the
// test runner registers and which records one outcome with this call's position.

global(specDepth)
global(specBeforeEach)
global(specAfterEach)
global(specAfterAll)
global(specBeforeEachCount)
global(specAfterEachCount)
global(specAfterAllCount)
global(specNegate)
global(specCaseName)
global(specCaseIndex)
global(specOnlyCase)
global(specCollect)
global(specOnlyMark)

specCaseIndex = 0

specBeforeEach = {}
specAfterEach = {}
specAfterAll = {}
specBeforeEachCount = {}
specAfterEachCount = {}
specAfterAllCount = {}

function specCheck(ok, name, expected, actual) {
  local(result)
  local(label)
  result = ok
  if (specNegate) { result = !result }
  specNegate = 0
  // `<case>/<matcher>`: the runner groups outcomes by case without a new record
  // kind (TOOL-5 fixes the kinds at pass/fail/skip/only).
  label = specCaseName + "/" + name
  if (result) { specResult("pass", label, "", "") }
  else { specResult("fail", label, expected, actual) }
}

// Scalar equality only; arrays need a type test the catalogue does not have.
function specEqual(a, b) {
  if (a == b) { return 1 }
  return 0
}

// Hook order inside one describe: beforeAll runs when it is registered (before
// the cases below it), then each case is wrapped by its enclosing levels'
// beforeEach outermost-first and afterEach innermost-first, and afterAll runs
// once when the describe body returns.
function describe(name, body) {
  local(specHook)
  specDepth = specDepth + 1
  body()
  if (specCollect == 0) {
    for (specHook = 1; specHook <= specAfterAllCount[specDepth]; specHook = specHook + 1) {
      specAfterAll[specDepth + ":" + specHook]()
    }
  }
  for (specHook = 1; specHook <= specAfterAllCount[specDepth]; specHook = specHook + 1) {
    specAfterAll[specDepth + ":" + specHook] = 0
  }
  for (specHook = 1; specHook <= specBeforeEachCount[specDepth]; specHook = specHook + 1) {
    specBeforeEach[specDepth + ":" + specHook] = 0
  }
  for (specHook = 1; specHook <= specAfterEachCount[specDepth]; specHook = specHook + 1) {
    specAfterEach[specDepth + ":" + specHook] = 0
  }
  specAfterAllCount[specDepth] = 0
  specBeforeEachCount[specDepth] = 0
  specAfterEachCount[specDepth] = 0
  specDepth = specDepth - 1
}

function it(name, body) {
  local(level)
  local(specHook)
  specCaseIndex = specCaseIndex + 1
  if (specCollect) {
    if (specOnlyMark) { specResult("pass", name, "case", "only") }
    else { specResult("pass", name, "case", "normal") }
    return
  }
  if (specOnlyCase != 0) {
    if (specCaseIndex != specOnlyCase) { return }
  }
  specCaseName = name
  if (specOnlyMark) { specResult("only", name, "", "") }
  for (level = 1; level <= specDepth; level = level + 1) {
    for (specHook = 1; specHook <= specBeforeEachCount[level]; specHook = specHook + 1) {
      specBeforeEach[level + ":" + specHook]()
    }
  }
  body()
  for (level = specDepth; level >= 1; level = level - 1) {
    for (specHook = 1; specHook <= specAfterEachCount[level]; specHook = specHook + 1) {
      specAfterEach[level + ":" + specHook]()
    }
  }
}

function test(name, body) {
  it(name, body)
}

function beforeEach(body) {
  specBeforeEachCount[specDepth] = specBeforeEachCount[specDepth] + 1
  specBeforeEach[specDepth + ":" + specBeforeEachCount[specDepth]] = body
}

function afterEach(body) {
  specAfterEachCount[specDepth] = specAfterEachCount[specDepth] + 1
  specAfterEach[specDepth + ":" + specAfterEachCount[specDepth]] = body
}

function beforeAll(body) {
  if (specCollect == 0) { body() }
}

function afterAll(body) {
  specAfterAllCount[specDepth] = specAfterAllCount[specDepth] + 1
  specAfterAll[specDepth + ":" + specAfterAllCount[specDepth]] = body
}

function skip(name, body) {
  specCaseIndex = specCaseIndex + 1
  if (specCollect) {
    specResult("pass", name, "case", "skip")
    return
  }
  if (specOnlyCase != 0) {
    if (specCaseIndex != specOnlyCase) { return }
  }
  specResult("skip", name, "", "")
}

function only(name, body) {
  specOnlyMark = 1
  it(name, body)
  specOnlyMark = 0
}

// A bound method supplies both allowed argument counts while the matcher remains
// a dictionary of ordinary callables (FUN-1, OOP-11 and ADR 0014).
class SpecCloseMatcher {
  public:
  var actual
  var negated
  method SpecCloseMatcher(value, negative) { actual = value; negated = negative }
  method close(expected) {
    specNegate = negated
    specCheck(specClose(actual, expected, 0.0000001), "toBeCloseTo", expected, actual)
  }
  method close(expected, tolerance) {
    specNegate = negated
    specCheck(specClose(actual, expected, tolerance), "toBeCloseTo", expected, actual)
  }
}

function expect(actual) {
  local(positive)
  local(negative)
  positive = SpecCloseMatcher(actual, 0)
  negative = SpecCloseMatcher(actual, 1)
  return {
    toBe: (expected) => specCheck(actual == expected, "toBe", expected, actual),
    toEqual: (expected) => specCheck(specEqual(actual, expected), "toEqual", expected, actual),
    toBeTruthy: () => specCheck(!!actual, "toBeTruthy", 1, actual),
    toBeNull: () => specCheck(actual == 0, "toBeNull", 0, actual),
    toContain: (needle) => specCheck(specContains(actual, needle), "toContain", needle, actual),
    toBeCloseTo: positive.close,
    toThrow: (body) => specCheck(0, "toThrow", "a runtime error", "no error"),
    not: {
      toBe: (expected) => { specNegate = 1; specCheck(actual == expected, "toBe", expected, actual) },
      toEqual: (expected) => { specNegate = 1; specCheck(specEqual(actual, expected), "toEqual", expected, actual) },
      toBeTruthy: () => { specNegate = 1; specCheck(!!actual, "toBeTruthy", 1, actual) },
      toBeNull: () => { specNegate = 1; specCheck(actual == 0, "toBeNull", 0, actual) },
      toContain: (needle) => { specNegate = 1; specCheck(specContains(actual, needle), "toContain", needle, actual) },
      toBeCloseTo: negative.close
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

// |value - expected| <= tolerance, on whole numbers. SEM-3:209 truncates every
// variable operand of arithmetic, and both the actual value and `expected` reach
// here through a variable read, so closeness is decided on truncated whole
// numbers: the one-argument overload's 1e-7 default is truncated to 0 on use, and
// an explicit fraction such as 0.001 is 0 too. Honest fractional closeness needs a
// native helper (an owner decision, not something this script can fake).
function specClose(value, expected, tolerance) {
  local(diff)
  diff = value - expected
  if (diff < 0) { diff = 0 - diff }
  if (diff <= tolerance) { return 1 }
  return 0
}
