// The script-spec library (docs/spec/engine/rpgcode-tooling.md#tool-5,
// docs/spec/engine/rpgcode-functions.md#tooling-the-rpgcode-spec-package).
// Every name here is RPGCode. The native commands are the closed set of twelve the
// test runner registers: specResult records one outcome with this call's position;
// specCapture, specEqual, specContain, specClose, specThrowBegin, specThrowEnd and
// specCalled read what a library program cannot (a value's type, an element
// array's indices, a stored double, an error raised in a called function, the calls
// a spy recorded); specInput, specTicks, specRng and spyOn are test doubles a case
// calls directly (TOOL-5 "Test doubles and spies").
//
// Registration and running are separate. `describe`, `it`, `test`, `skip`, `only`
// and the four hooks only fill the tables below; the runner then calls `specRun()`
// after the spec's own text, and the tables are walked in definition order. Every
// case is registered before any runs, so a hook applies to every case of its group
// wherever in the group it was written.
//
// `specMode` says what one run of the walk does. 0 runs everything in one state
// (a library test with no runner). The test runner owns the other four and sets
// them before it resumes a run: 1 only reports the registered groups, cases and
// hooks; 2 runs the one case numbered `specTarget`; 3 runs the beforeAll hooks of
// the group numbered `specTarget` and reports a checkpoint, where the runner takes
// its snapshot of the simulation; 4 runs the afterAll hooks of that group. A case
// or a teardown run is resumed from the snapshot of the innermost group that has a
// beforeAll, so beforeAll runs once per group (TOOL-5, "Group hooks and the fresh
// fixture").
//
// The file itself is group 0. Group, case and hook records are plain globals, so a
// snapshot of the simulation carries them.

function specCheck(ok, name, expected, actual, negate) {
  local(passed)
  passed = ok
  if (negate) {
    passed = !passed
    expected = "not " + expected
  }
  specVerdict(passed, name, expected, actual)
}

// `<case>/<matcher>`: the runner groups outcomes by case without a new record
// kind (TOOL-5 fixes the kinds at pass/fail/skip/only).
function specVerdict(passed, name, expected, actual) {
  if (passed) { specResult("pass", specCaseName + "/" + name, "", "") }
  else { specResult("fail", specCaseName + "/" + name, expected, actual) }
}

// toBe and toEqual. `expected` is by reference so an array's elements are seen.
function specMatchEqual(snap, &expected, strict, name, negate) {
  local(ok)
  local(expectedText)
  local(actualText)
  ok = specEqual(snap, expected, strict, expectedText, actualText)
  specCheck(ok, name, expectedText, actualText, negate)
}

function specMatchContain(snap, &needle, negate) {
  local(ok)
  local(needleText)
  local(actualText)
  ok = specContain(snap, needle, needleText, actualText)
  specCheck(ok, "toContain", needleText, actualText, negate)
}

// |actual - expected| <= tolerance on the stored doubles; both are by reference so
// no name read truncates them (SEM-3).
function specMatchClose(snap, &expected, &tolerance, negate) {
  local(ok)
  local(expectedText)
  local(actualText)
  ok = specClose(snap, expected, tolerance, expectedText, actualText)
  specCheck(ok, "toBeCloseTo", expectedText, actualText, negate)
}

// toThrow: the subject is called between specThrowBegin and specThrowEnd, so an
// unhandled error in it or in anything it calls is seen and consumed. A subject that
// is not a function fails in both polarities.
function specMatchThrow(subject, negate) {
  local(opened)
  local(threw)
  local(code)
  opened = specThrowBegin(subject)
  if (opened == 0) {
    specResult("fail", specCaseName + "/toThrow", "a function", "not a function")
    return
  }
  subject()
  threw = specThrowEnd(code)
  if (negate) { specVerdict(!threw, "toThrow", "no runtime error", code) }
  else { specVerdict(threw, "toThrow", "a runtime error", code) }
}

// toHaveBeenCalledWith and toHaveBeenNthCalledWith. specCalled returns -1 for a
// subject that is not a spy, an args that is not a list or a bad call number:
// that fails in both polarities.
function specMatchCalled(snap, &args, any, &nth, name, negate) {
  local(ok)
  local(expectedText)
  local(actualText)
  ok = specCalled(snap, args, any, nth, expectedText, actualText)
  if (ok == -1) {
    specResult("fail", specCaseName + "/" + name, expectedText, actualText)
    return
  }
  specCheck(ok, name, expectedText, actualText, negate)
}

// ----------------------------------------------------------------- registration

function specAddChild(kind, id) {
  specChildCount[specCurrent] = specChildCount[specCurrent] + 1
  specChildKind[specCurrent + ":" + specChildCount[specCurrent]] = kind
  specChildId[specCurrent + ":" + specChildCount[specCurrent]] = id
}

function describe(name, body) {
  local(group)
  local(parent)
  parent = specCurrent
  specGroupCount = specGroupCount + 1
  group = specGroupCount
  specGroupName[group] = name
  specGroupParent[group] = parent
  specAddChild(1, group)
  if (specMode == 1) { specResult("pass", name, "group", group + ":" + parent) }
  specCurrent = group
  body()
  specCurrent = parent
}

// kind: 0 a case, 1 skipped, 2 focused with only().
function specCase(name, body, kind) {
  local(id)
  specCaseCount = specCaseCount + 1
  id = specCaseCount
  specCaseTitle[id] = name
  specCaseBody[id] = body
  specCaseGroup[id] = specCurrent
  specCaseKind[id] = kind
  specAddChild(0, id)
  if (specMode == 1) { specResult("pass", name, "case", kind + ":" + id + ":" + specCurrent) }
}

function it(name, body) {
  specCase(name, body, 0)
}

function test(name, body) {
  specCase(name, body, 0)
}

function skip(name, body) {
  specCase(name, body, 1)
}

function only(name, body) {
  specCase(name, body, 2)
}

// kind: "be" beforeEach, "ae" afterEach, "ba" beforeAll, "aa" afterAll.
function specAddHook(kind, body) {
  local(key)
  key = specCurrent + ":" + kind
  specHookCount[key] = specHookCount[key] + 1
  specHookBody[key + ":" + specHookCount[key]] = body
  if (specMode == 1) {
    if (kind == "ba") { specResult("pass", "beforeAll", "hook", specCurrent) }
    if (kind == "aa") { specResult("pass", "afterAll", "hook", specCurrent) }
  }
}

function beforeEach(body) {
  specAddHook("be", body)
}

function afterEach(body) {
  specAddHook("ae", body)
}

function beforeAll(body) {
  specAddHook("ba", body)
}

function afterAll(body) {
  specAddHook("aa", body)
}

function expect(&specSubject) {
  local(specSnap)
  specSnap = specCapture(specSubject)
  return {
    toBe: (&expected) => specMatchEqual(specSnap, expected, 1, "toBe", 0),
    toEqual: (&expected) => specMatchEqual(specSnap, expected, 0, "toEqual", 0),
    toBeTruthy: () => specCheck(!!specSubject, "toBeTruthy", 1, specSubject, 0),
    toBeNull: () => specCheck(specSubject == 0, "toBeNull", 0, specSubject, 0),
    toContain: (&needle) => specMatchContain(specSnap, needle, 0),
    // `tolerance` is required: a callable takes exactly its declared arity
    // (FUN-1/ERR-2) and the language has no default argument, so toBeCloseTo(x)
    // is the located failure callable.arity (owner ruling F-F; TOOL-5 "Arities").
    toBeCloseTo: (&expected, &tolerance) => specMatchClose(specSnap, expected, tolerance, 0),
    toThrow: () => specMatchThrow(specSubject, 0),
    toHaveBeenCalledWith: (&args) => specMatchCalled(specSnap, args, 1, 0, "toHaveBeenCalledWith", 0),
    toHaveBeenNthCalledWith: (&n, &args) => specMatchCalled(specSnap, args, 0, n, "toHaveBeenNthCalledWith", 0),
    not: {
      toBe: (&expected) => specMatchEqual(specSnap, expected, 1, "toBe", 1),
      toEqual: (&expected) => specMatchEqual(specSnap, expected, 0, "toEqual", 1),
      toBeTruthy: () => specCheck(!!specSubject, "toBeTruthy", 1, specSubject, 1),
      toBeNull: () => specCheck(specSubject == 0, "toBeNull", 0, specSubject, 1),
      toContain: (&needle) => specMatchContain(specSnap, needle, 1),
      toBeCloseTo: (&expected, &tolerance) => specMatchClose(specSnap, expected, tolerance, 1),
      toThrow: () => specMatchThrow(specSubject, 1),
      toHaveBeenCalledWith: (&args) => specMatchCalled(specSnap, args, 1, 0, "toHaveBeenCalledWith", 1),
      toHaveBeenNthCalledWith: (&n, &args) => specMatchCalled(specSnap, args, 0, n, "toHaveBeenNthCalledWith", 1)
    }
  }
}

// --------------------------------------------------------------------- running

// The hooks of one kind of one group, in registration order.
function specRunHooks(group, kind) {
  local(key)
  local(n)
  local(count)
  key = group + ":" + kind
  count = specHookCount[key]
  if (kind == "ba") { specCaseName = "beforeAll" }
  if (kind == "aa") { specCaseName = "afterAll" }
  for (n = 1; n <= count; n = n + 1) {
    specHookBody[key + ":" + n]()
  }
}

// beforeEach hooks run outermost group first, afterEach hooks innermost first.
function specBeforeEachChain(group) {
  if (group != 0) { specBeforeEachChain(specGroupParent[group]) }
  specRunHooks(group, "be")
}

function specAfterEachChain(group) {
  specRunHooks(group, "ae")
  if (group != 0) { specAfterEachChain(specGroupParent[group]) }
}

function specExecCase(id) {
  specCaseName = specCaseTitle[id]
  if (specCaseKind[id] == 1) {
    specResult("skip", specCaseName, "", "")
    return
  }
  if (specCaseKind[id] == 2) { specResult("only", specCaseName, "", "") }
  specBeforeEachChain(specCaseGroup[id])
  specCaseBody[id]()
  specAfterEachChain(specCaseGroup[id])
}

// Whether the target of this run lies in the subtree of `group`: the group of the
// target case (mode 2), or the group a setup or teardown run names (modes 3, 4).
function specWithin(group) {
  local(node)
  if (specMode == 2) { node = specCaseGroup[specTarget] }
  else { node = specTarget }
  while (node != group) {
    if (node == 0) { return 0 }
    node = specGroupParent[node]
  }
  return 1
}

function specRunCase(id) {
  if (specMode == 0) { specExecCase(id) }
  if (specMode == 2) {
    if (specTarget == id) { specExecCase(id) }
  }
}

function specRunChildren(group) {
  local(n)
  local(count)
  count = specChildCount[group]
  for (n = 1; n <= count; n = n + 1) {
    if (specChildKind[group + ":" + n] == 1) { specEnter(specChildId[group + ":" + n]) }
    else { specRunCase(specChildId[group + ":" + n]) }
  }
}

// Enter a group whose registration is complete. A setup run runs the group's
// beforeAll hooks and reports the checkpoint; the runner snapshots the simulation
// right after it, and every later case or teardown run of the group resumes there,
// at the statement below the report, with `specMode` changed.
function specEnter(group) {
  if (specMode == 0) {
    specRunHooks(group, "ba")
    specRunChildren(group)
    specRunHooks(group, "aa")
    return
  }
  if (specWithin(group) == 0) { return }
  if (specMode == 3) {
    if (specTarget == group) {
      specRunHooks(group, "ba")
      specResult("pass", "", "checkpoint", group)
    }
  }
  if (specMode == 3) {
    if (specTarget == group) { return }
  }
  specRunChildren(group)
  if (specMode == 4) {
    if (specTarget == group) { specRunHooks(group, "aa") }
  }
}

// The runner appends one call of this after the spec's own text.
function specRun() {
  if (specMode == 1) { return }
  specEnter(0)
}
