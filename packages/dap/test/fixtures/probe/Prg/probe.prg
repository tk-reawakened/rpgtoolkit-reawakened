// prg/probe.prg — the debug-adapter fixture (entry 10.10, #950).
//
// Two threads: the blocking program and the persistent thread it starts. A
// call inside a function, so a debugger can step over it, into it and out of
// it, and a local in that function, so a frame above the innermost can still
// be inspected. `local(...)` is needed because a plain assignment creates a
// global unless `autoLocal(true)` is in force (SEM-4).
//
// The tests find their breakpoint line by searching the code below, never a
// comment: a comment that names a statement would otherwise match first.
total = 1
spare = thread("sleeploop = 1", 1)
function twice(n) {
    local(doubled)
    doubled = n * 2
    return doubled
}
function compute() {
    local(seed)
    seed = total + 2
    result = twice(seed)
    return seed * 10
}
counter = compute()
end()
