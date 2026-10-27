---
title: 'Statements, control flow, functions, expressions and the operand stack'
type: 'feature'
ticket: 5
created: '2026-10-15'
status: done
baseline_revision: '43189ac35038e110f4265fd4e8e93342b575dedf'
route: 'full'
route_source: 'auto'
risk: 'medium'
context: ['docs/guardrails.md', 'docs/spec/engine/rpgcode-language.md', 'docs/spec/engine/rpgcode-runtime.md', 'packages/core/src/script/lex.ts', 'packages/core/src/script/parse.ts', 'packages/core/src/script/lower.ts', 'packages/core/src/script/ops.ts', 'packages/core/src/script/registry.ts', 'packages/core/src/script/vm.ts']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** the frontend is the tracer's subset and nothing beyond it can parse or run. `lex.ts:28-34` knows six token kinds, `parse.ts:97-116` knows two statement forms, `ops.ts:20-26` knows six ops, and `ast.ts:17-25` knows three expressions; every operator, block, definition and declaration is rejected by name (`lex.ts:76-167`, e.g. `x = 1 + 2` → "entry 5"). Consequences: (a) the corpus cannot run — 16 `if`, 5 `else`, 4 `while`, 2 `until`, 6 `for`, 2 `switch`/6 `case`, 7 top-level `method` definitions, 22 in-class bodies, 18 `local(x) = v`, 6 `return &lvalue`, 14 `a[i]` and 122 plain calls are outside the subset (`discovery/language-readiness.md`, "Construct counts per file"), so epic Done-when 1 (`system.prg`/`start.prg` headless) is unreachable; (b) no IR instruction carries a source position, so entry 7's located diagnostics (R-38a, E-98, `docs/spec/engine/rpgcode-language.md:162`) and entry 10's snapshot work have nothing to read; (c) `Frame.operands` (`state.ts:38`) has never held a partial expression across a yield, so the operand-stack half of AD-7 is unproven; (d) the `scriptFunction` tier of AD-8's lookup is an empty stub (`registry.ts:38-48`), so no call can reach a user function, and `Frame.locals` (`state.ts:37`) cannot express a by-reference parameter or a `return &lvalue` result.

**Approach:** replace the subset frontend with the full TK3 grammar as ruled by entry 1 and migrated by entry 27, and make the step machine able to execute it. Four pieces, one lane:

1. **Lexer** (`lex.ts`): the whole §9.2 surface — every operator and punctuation, `/* */` and legacy `*`/`**` comments, the `_` continuation (LEX-1/LEX-5), a 1-based `line` on every token, and no keyword rejection (keywords become parser vocabulary).
2. **Parser + AST** (`parse.ts`, `ast.ts`): precedence-climbing over the 15-level table (EXP-2, `rpgcode-language.md:104-126`), the statement set (`if`/`elseif`/`else` STX-3, `while`, `until` SEM-2, `for` STX-4, `switch`/`case`/`default` STX-2, `:label` STX-5, `return`, assignments, calls), function definitions with typed and `&` parameters (FUN-1, FUN-6), and the FUN-2 declaration forms.
3. **Lowering + IR** (`lower.ts`, `ops.ts`, `program.ts`): a linear stack-machine IR whose every instruction carries `pos: { file, line }` (the single owner of that mapping), jumps for every control statement, per-function and per-program label tables, hoisted function tables keyed by name then arity, and a `Program` that stays outside `GameState` (AD-7).
4. **VM** (`vm.ts`, `state.ts`, `registry.ts`, `builtins.ts`): the new ops, the function frame stack (overload by arity, `&` parameters, `return &lvalue`, deep recursion without JS recursion), truthiness and the operator semantics of SEM-3, calls resolved through AD-8's precedence with the `scriptFunction` tier filled, and FUN-7 unwinding as a `vm.control` effect the VM applies.

The synthetic program of Design Notes is the deliverable proof: deep recursion, locals shadowing globals, an operand stack caught mid-expression by a blocking call, snapshot and restore at every step.

## Boundaries & Constraints

**Always:** G1 — explicit step machine, statuses never promises, every state field `PlainData` (`AssertPlainData<GameState>` still passes), no generator/`async`/`await`/`Promise` under `core/src/script/**`; G2 — `core` imports nothing outside `core`; G3/AD-13 — no `Date`/`performance.now`/`Math.random`/`Intl`, `^` evaluates through `fmath.pow` and `**` stays banned; ADR 0004 decision 1 — a Unified AST lowered to a flat linear IR, never AST-walking in the tick loop; AD-7 — `Frame`/`Thread`/`VmState` keep their listed fields, compiled code stays outside state, and the IR change carries a `COMPILER_VERSION` bump plus a previous-version fixture save and a restore test over it (`save/state.ts:11-15`); AD-8 — the command contract is untouched (a command still mutates nothing and reports `effects`), `Arg = { value, ref }` stays the operand unit, and calls resolve in AD-8's stated order redirect → script function → built-in → extension (`registry.ts:38-48`); LEX-10 — names fold by the existing ASCII-only `foldAscii` (`lex.ts:53`), never `toLowerCase`; R-38a/E-98 — every `StepOp` carries `pos`, the one source-position owner entries 7 and 10 read; every new file header cites `docs/spec/engine/rpgcode-language.md` (rule id) or `rpgcode-runtime.md` (SEM id); the corpus-settled leniencies STX-1, STX-2, STX-3, FUN-1, FUN-2, FUN-3, ELSE-NEXT-LINE and INDEX-BARE-IDENT each get a test.

**Never:** no classes, objects, `->`, `this`, `var`, access labels, `operator=`/`operator[]`, `release()` or `new` (entry 6) · no `#include`, `include()`, implicit `file.func`, `redirect`/`killRedirect` or a `.` token (entry 8) · no error handlers, `on error`, `resume next`, `debugger(msg)`, `Logger` sinks or located `Diagnostic` conversion (entry 7 — this entry only *carries* `pos`) · no thread kinds, `threadSleep`, `tellThread`, the wait-kind registry or the per-tick budget ruling (entry 9) · no `kill`, `autoLocal(true)` as a command, `castLit`/`castNum`/`castInt`, `len`/`left`/`mid`/`inStr`/`replace`/`split`/`trim`/`lcase`/`ucase`/`asc`/`chr`/`charAt`, `iif`, arrays-as-maps built-ins or the catalogue registration (entries 12, 13, 21) · no `run`, `branch`, `change`, `rpgCode`, `delay`, `getTickCount`, `done`, `stop` *names* (entry 13) — this entry ships the *mechanism* (`vm.control` effects for unwind/run/jump) and upgrades `CORE_PLUGIN.end` to return the `end` control effect, because FUN-7 unwinding is in this entry's scope · no Toolkit 2.x dialect, `@` lines, `< >` blocks, `#Mwin` unquoted arguments or `returnMethod` (entry 15) · no `break`/`continue` (see Design Notes) · no `runLog`, golden, `golden/**`, `packages/runner-headless/**` or `tools/**` change · no new npm dependency, no `eslint.config.js` change, no `tools/deps/edges.json` change (module-internal) · no snapshot migration chain, restore bounds or the script-created nesting bound (entry 11) · no source-to-source conversion of legacy files (config, not the parser).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Brace on the next line (STX-1, 24 corpus sites) | `if (x)` newline `{` … `}` | parses; the header is not a complete statement until its `{` | none |
| Brace-less body | `if (x) y = 1` | rejected: braces are mandatory (STX-1) | `syntax.unsupported`, naming STX-1 and the line |
| `}` ends the statement before it (STX-6) | `if (x) { y = 1 }` | well-formed; no `;` or newline before `}` needed | none |
| `else` on the line after `}` (STX-3, 1 corpus site) | `}` newline `else { … }` | the `else` binds to that `if` | none |
| `else if` (two words) | `else if (c) { … }` | synonyms of `elseif` (STX-3) | none |
| `case (1)` with no colon (STX-2, 6 corpus sites) | `switch (x) { case (1)` newline `{ … }` | the colon is optional; `case (1):`, `case (1)` and `case 1:` are the same label; a case value is a full expression | none |
| `default` with or without a colon | `default { … }` / `default: { … }` | both accepted | none |
| Fall-through | two cases, the first's block ends | no fall-through: the first block jumps past the switch | none |
| `until` checks first (SEM-2) | `until (x) { … }` with `x` already false | the body runs at least once; the loop stops when `x` is true | none |
| `for` with empty parts (STX-4) | `for (; n < 3; ) { … }` | the `;` inside the header are separators, not terminators; an empty condition never exits by condition | none |
| Label (STX-5) | `:top` in a function body | recorded in that function's label table; not visible in another function | duplicate label in one scope → `compile.duplicate-label` |
| `:`-name in an argument (STX-5) | `branch(:loop)` | a label reference: the folded name as a string value | none |
| `:`-name elsewhere in an expression | `:x = 1` inside a function with a local `x` | a global reference: writes the global past the local (SEM-4) | none |
| Duplicate definition | two `function f(a)` in one program | declaration error naming the definition (R-38a names this as a real 3.1 declaration error) | `compile.duplicate-function`, with the line |
| Overload by arity (FUN-1) | `function f(a)` and `function f(a, b)` | `f(1)` and `f(1, 2)` dispatch to the matching definition; a type never takes part | no match → falls through to the built-in tier, then `unknown.command` |
| Typed parameter (FUN-1, 4 corpus sites) | `method clone(CArray rhs) { … }` | the type is documentation only: accepted, not checked, not part of overload choice | none |
| `&` parameter (FUN-1, EXP-3) | `function inc(&n) { n = n + 1 }` then `inc(x)` | the callee's writes reach the caller's variable (true aliasing, not copy-back) | none |
| `&` parameter at both spellings | `&n` and `n &` in a parameter list | both are the same by-reference parameter (the two spec wordings disagree; see Design Notes) | none |
| `&` parameter given a non-variable argument | `inc(1 + 2)` | the parameter is a plain local of its own name; no caller write-back | none |
| `local(x) = v` in a `for` initialiser (FUN-2, 18 corpus sites) | `for (local(i) = 0; i < 3; ++i) { … }` | declares `i` in the frame and assigns it in one statement | none |
| `global(x) = v` past a local | a frame local `x`, then `global(x) = 2` | writes the global; the local is unchanged (SEM-4) | none |
| `local(x)` alone (FUN-2) | `local(x)` as a statement | declares and leaves it unset: reads as 0; an existing global is not clobbered | none |
| `return` forms (FUN-3) | `return`, `return e`, `return &x`, `return &a[i]` | a bare `return` yields the unset value 0; `return &lvalue` yields an `Arg` carrying the lvalue's `ref` | none |
| Call as an assignment target (FUN-3, 6 corpus sites) | `ret = get(1); get(2)` and `f(x) = v` where `f` returns `&lvalue` | the value is written through the returned `ref` | no `ref` on the result → `vm.bad-lvalue` |
| Deep recursion | a recursive function called 500+ levels deep | frames are pushed on `Thread.frames` (plain data); the VM loop is iterative, so no JS stack is used | `RangeError` impossible here; the nesting bound is entry 11's |
| Precedence (EXP-2, R-30) | `-2^2`, `2^3^2`, `x & y == z`, `a != b`, `a ~= b` | `(-2)^2` = 4; `(2^3)^2` = 64; `x & (y == z)`; `!=` is "not equal" (R-31 → LEX-3) | none |
| `^` result (AD-13) | `2 ^ 0.5`, `(-8) ^ (1/3)` | `fmath.pow` exactly (a fractional power is the deterministic one); no `Math.pow`, no `**` | none |
| Truthiness (R-39, SEM-3:14) | `if ("off") …`, `if ("") …`, `if (0) …`, `if ("FALSE") …` | `"off"` (case-insensitive) is false; `""`, `"FALSE"` and any non-empty non-`off` string are true; a number is true when not zero | none |
| No short-circuit (R-40) | `f() && g()`, `a ? b : c` | every operand evaluates, including both `?:` arms and both sides of `&&`/`||` | none |
| Comparison and conversion (SEM-3) | `"abc" == "ABC"`, `5 == "5"`, `"5.0" == 5`, `"abc" < "abd"`, `"10" < "9"`, `1 + "2"`, `7 / 2` | 0, 1, 0, 0, 0, `"12"`, 3.5 exactly as the SEM-3 worked-values table | none |
| Bitwise and shifts (SEM-3:26) | `7 % 0`, `1 << 33` | `%` by zero is the catchable error ruled in errors-and-threads; a shift count is modulo 32 | `%` by zero → the ERR-2 class error (entry 7 reports it; this entry throws it) |
| Unset read (SEM-5) | `y = never` then `y` | 0 for arithmetic, the empty string when a string is wanted; **the read creates the variable** | none |
| Index (SEM-5, EXP-6, 14 corpus sites) | `a[1]`, `a["1"]`, `a[1.0]`, `m["Key"]` vs `m["key"]`, `a[1][2]`, `f(x)[i]` | `a[1]`, `a["1"]` and `a[1.0]` are one element; a string key keeps its case; an index chain names one variable; the key is the six-significant-digit format | none |
| Snapshot mid-operand-stack | `result = 1 + sleep(2) + 3` snapshotted during the wait | `Frame.operands` holds the partial stack; the restored VM finishes with the identical state hash | none |
| Previous-version snapshot (AD-7) | a `compiler: "1"` save in `fixtures/save/` | refused before its `vm` payload is read | `restore.compiler-mismatch`; owner ruling 2026-10-27: a compiler mismatch refuses the whole save, only a source mismatch restarts a thread (entry 11) |
| `break` / `continue` | `break` inside a loop | not 3.1 syntax: the spec's keyword list has no break/continue | `syntax.unsupported`, naming the spec, with the line |

</frozen-after-approval>

## Code Map

Edited (each read before changing):

- `packages/core/src/script/lex.ts` (327 lines) — widen `Token` (`lex.ts:28-34`) with `line: number`, an `op` kind and the full punctuation set; delete `rejectKeyword`'s "entry 5" cases (`lex.ts:76-124`) and `rejectCharacter`'s operator/index/brace/colon cases (`lex.ts:127-167`) for everything entry 5 now accepts; keep `foldAscii` (`lex.ts:53`), the LEX-3 sigil adjacency (`lex.ts:286-293`) and the `#include`-by-name rejection (`lex.ts:208-217`); add `/* */`, legacy `*`/`**` line comments, the `_` continuation and line accounting.
- `packages/core/src/script/ast.ts` (28) — `Expr` becomes the full expression union (literal, variable, global-scoped variable, label ref, call, index, unary, binary, ternary, prefix/postfix `++`/`--`), plus `Lvalue`, `Statement` (block, if, while, until, for, switch, label, return, function definition, assignment, call), `Block`, `FunctionDef`, `Param`, and a `line` on every node.
- `packages/core/src/script/parse.ts` (125) — replace the two-form parser (`parse.ts:97-116`) with the statement parser and the precedence-climbing `parseExpression`; keep the `describe`-based error message style (`parse.ts:22-37`).
- `packages/core/src/script/ops.ts` (26) — widen `StepOp` to the union of Design Notes, each variant carrying `pos: SourcePos`.
- `packages/core/src/script/lower.ts` (49) — AST → ops with jumps, label tables, the function table, the statement-value convention and `pos` stamping.
- `packages/core/src/script/program.ts` (58) — `Program` gains `functions` and `labels`; `COMPILER_VERSION` `"1"` → `"2"` (`program.ts:25`, AD-7's check); `compileProgram` passes the `file` label (`ref.path`, else `"<inline>"`) into the frontend.
- `packages/core/src/script/state.ts` (107) — `Frame.locals` becomes `{ [name: string]: LocalSlot }` with `LocalSlot = { value: Value; ref: RefId }`; `globalRef`/`localRef` (`state.ts:69-76`) stay the ref builders and are the aliasing vocabulary.
- `packages/core/src/script/vm.ts` (354) — dispatch the new ops; frame entry/return; `loadArg`/`storeVar`/`writeRef` (`vm.ts:251-354`) become slot- and alias-aware; `takeArgs`/`checkArity` reused; the `call` case consults AD-8's precedence before `commands.get` (`vm.ts:211-237`); apply `vm.control` effects; attach `pos` to every error.
- `packages/core/src/script/registry.ts` (179) — realise the `scriptFunction` tier of `CommandTiers`/`TIER_ORDER` (`registry.ts:38-48`) as a frame-entering `FunctionTarget` resolution and export the shared `resolveCall` (Design Notes), keeping `assembleCommands`/`createCommandLookup` behaviour for the built-in and extension tiers.
- `packages/core/src/script/builtins.ts` (84) — `CORE_PLUGIN`'s `end` returns the `end` control effect instead of `{ value: null }` (`builtins.ts:62-67`); `sleep` untouched.
- `packages/core/src/script/errors.ts` (28) — `ScriptError` gains `pos: SourcePos | null`; new codes `compile.duplicate-function`, `compile.duplicate-label`, `vm.bad-lvalue`, `vm.unknown-label`, `vm.bad-operand`.
- `packages/core/src/script/index.ts` (58) — export the new surface (`SourcePos`, `Program`'s parts, `resolveCall`, the `vm.control` effect kind, `LocalSlot`), additive.
- New `packages/core/src/script/values.ts` — the pure value layer: `truthy` (R-39), `toStringValue`/`toNumberValue` (SEM-3:15-23), `toInt32` (SEM-3:24-26), the six-significant-digit number-to-string, `compareEqual`/`compareRelational` (SEM-3:12-13) and `indexKey` (SEM-5:61-63). Entry 12's `castLit`/`castNum`/`castInt` consume this module instead of re-implementing it.
- Tests: `packages/core/test/script-frontend.test.ts` (149, all 18 pinned IR/`deepEqual` expectations and the 2 `compiler: "1"` literals change), `script-vm.test.ts` (360, 4 `compiler` literals and the hand-built `Frame` shapes), `script-state.test.ts` (71, `state.schema.compiler === "1"`), `script-registry.test.ts` (1 `compiler` literal), new `script-expressions.test.ts`, `script-control-flow.test.ts`, `script-functions.test.ts`, `script-operand-stack.test.ts`; `packages/runner-harness/test/script-host.test.ts` gains the mid-expression yield case.
- `packages/core/test/fixtures/ports/good.ts` (`FrameIsPlainData` at line 64, the `compiler: "1"` ref at line 82, `locals: {}` at 84) and `fixtures/plain-data/good.ts` — pin the new `Frame`/`LocalSlot` shape; the `AssertPlainData` assertions stay.
- New `packages/core/test/fixtures/save/compiler-1-snapshot.json` — a previous-version save (AD-7's check). Safe to add: `eslint.config.js:217` ignores `packages/core/test/fixtures/**`, the lint fixtures are selected by extension (`.ts`/`.tsx`/`.mts`/`.cts`), and `tools/fixtures/author/generate.mjs` writes only its own explicit list into `fixtures/authored/`.

Not to touch: `golden/**`, `packages/runner-headless/**`, `tools/**`, `eslint.config.js`, `tools/deps/edges.json`, `packages/core/src/save/sections.ts` (the placeholder sections), any other package.

## Tasks & Acceptance

**Execution:**
- [ ] `_bmad-output/.../architecture-rpgtoolkit-reawakened.md` — amend AD-7's `Frame` clause to state that `locals` maps a name to a plain-data slot `{ value, ref }` whose `ref` is the variable the name actually reads and writes (`local:<name>` for a plain local; the caller's ref for a by-reference parameter), so a by-reference parameter aliases rather than copies and `return &lvalue` survives the frame pop. Doc-only commit, before the code (G7). AD-7 today lists the field without its value shape (verified against the AD-7 rule), so this is a clarification the code needs, not a shape change.
- [ ] `packages/core/src/script/lex.ts` — the full §9.2 token set with `line` on every token; keep the sigil adjacency and the `#` rules; `/* */`, legacy `*`/`**` comments and the `_` continuation; delete the now-obsolete "entry 5" rejections and keep the "entry 6/7/8/9/12/13/15" ones.
- [ ] `packages/core/src/script/ast.ts` + `parse.ts` — the expression and statement grammar of Design Notes; every node carries its line; the parse errors name the construct and the rule id.
- [ ] `packages/core/src/script/ops.ts` + `lower.ts` + `program.ts` — the IR union with `pos` on every variant, jump lowering for `if`/`while`/`until`/`for`/`switch`, the label and function tables, hoisting, `COMPILER_VERSION = "2"`.
- [ ] `packages/core/src/script/values.ts` — truthiness, comparison, conversion, the number-to-string algorithm and the index key, all pure and all covered by the pinned SEM-3 worked values.
- [ ] `packages/core/src/script/state.ts` + `vm.ts` — `LocalSlot` locals, the new ops, frame entry/return, overload by arity, `&` parameters, `return &`, `vm.control` effects, `pos` on errors.
- [ ] `packages/core/src/script/registry.ts` + `builtins.ts` + `errors.ts` + `index.ts` — the `scriptFunction` tier and `resolveCall`, `end` returning the `end` effect, the new codes, the exports.
- [ ] Update `packages/core/test/script-frontend.test.ts`, `script-vm.test.ts`, `script-state.test.ts`, `script-registry.test.ts`, both `fixtures/**/good.ts` and add `fixtures/save/compiler-1-snapshot.json` — the existing pins must describe the new IR, not be deleted.
- [ ] Add `packages/core/test/script-expressions.test.ts`, `script-control-flow.test.ts`, `script-functions.test.ts`, `script-operand-stack.test.ts` and the `runner-harness` mid-expression case — the acceptance criteria below, one file per family.
- [ ] Iterate with `node --test packages/core/test/script-*.test.ts packages/runner-harness/test/script-host.test.ts` until green, then hand off for the full command set in Verification.

**Acceptance Criteria:**
- Given the synthetic program of Design Notes, when it is compiled and run to completion, then every statement and operator form it uses produced the values Design Notes pins, and `hashState` is stable across two runs.
- Given the same program, when `runThreadsPhase(vm, services, 1)` advances it one VM step at a time, then after **every** step the state round-trips (`canon(restoreGameState(snapshot(s))) === snapshot(s)`), a fresh VM restored from any of those snapshots finishes with the identical final `hashState`, and at least one of those steps is taken while `Frame.operands` is non-empty (a partial expression).
- Given `result = 1 + sleep(2) + 3` driven through the harness, when the snapshot taken during the wait is restored into a fresh host, then both runs finish with the identical per-tick `stateHash` and `result` is 4.
- Given `function fact(n) { if (n <= 1) { return 1 } return n * fact(n - 1) }`, when `fact(500)` runs, then it returns the same value in both runs, the deepest state carries 500 frames, and no host stack overflow occurs (the VM loop is iterative).
- Given a global `x = 1` and `function f() { local(x) = 9; return x }`, when `f()` is called, then the call returns 9 and the global `x` is still 1; and given `function g() { global(x) = 2 }`, when `g()` runs, then the global is 2 (SEM-4).
- Given `function inc(&n) { n = n + 1 }` and `x = 1`, when `inc(x)` runs, then `x` is 2, and when `inc(1 + 2)` runs, then no caller variable changes and the parameter is a plain local.
- Given `function pick() { return &g }` and `g = 1`, when `pick() = 5` runs, then `g` is 5.
- Given the two overloads `f(a)` and `f(a, b)`, when `f(1)` and `f(1, 2)` run, then each reaches its own body; and given a third `f(a)` definition in the same program, when it compiles, then it fails with `compile.duplicate-function` naming the line (R-38a).
- Given each precedence row of the EXP-2 table, when it is evaluated, then the pinned value holds — `-2^2` = 4, `2^3^2` = 64, `x & y == z` = `x & (y == z)`, `a != b` is "not equal" (R-31), `a and b` = `a && b`, and `^` uses `fmath.pow` (a vector equal to `fmath.pow(a, b)` bit for bit).
- Given `"off"`, `""`, `"FALSE"`, `0` and `3` as conditions, when `if`/`while`/`until` test them, then only `"off"`, `"OFF"` and `0` are false (R-39); and given `f() && g()` with recording stubs, when it runs, then both were called, and `c ? a : b` calls both `a` and `b` (R-40).
- Given the SEM-3 worked-values table (`"abc" == "ABC"`, `5 == "5"`, `"5.0" == 5`, `"abc" < "abd"`, `"10" < "9"`, `"Hello " + 32`, `1 + "2"`, `7 / 2`), when each is evaluated, then every value matches the table.
- Given `a[1]`, `a["1"]` and `a[1.0]` written in sequence, when they are read back, then all three name one variable; given `m["Key"]` and `m["key"]`, when each is assigned, then they are two variables (SEM-5).
- Given the seven corpus-settled leniency forms (brace on the next line, `case (1)` without a colon, `else` on a later line, a typed parameter `CArray rhs`, `local(x) = v` as a `for` initialiser, `return &a[i]`, `a[ident]`), when each is compiled, then it parses and runs, and the strict brace-less form is still rejected.
- Given a `compiler: "1"` save fixture, when `restoreGameState` is called on it, then it fails with `restore.compiler-mismatch` before any section payload is read.
- Given the unchanged golden fixtures and the whole change, when `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:strict`, `pnpm graph`, `pnpm golden`, `pnpm provenance` and `pnpm licence` run, then every one passes and no golden file was edited.

## Implementation Notes

Empty at planning time (route: full).

## Plan Change Log

Empty until the first `bad_plan` loopback.

## Design Notes

**The 15-level table (EXP-2, `rpgcode-language.md:112-126`), tightest first.** 1 `()` call, `[]` index, `->` member (entry 6), postfix `++ --` · 2 unary `- + ! ~`, prefix `++ --` (right) · 3 `^` (left) · 4 `* / %` · 5 `+ -` · 6 `<< >>` · 7 `< <= > >=` · 8 `== ~= !=` · 9 `&` · 10 `` ` `` · 11 `|` · 12 `&&`/`and` · 13 `||`/`or` · 14 `?:` (right) · 15 assignment `= += -= *= /= %= ^= &= |= <<= >>=` (right). R-30 (`rpgcode-language.md:128`) settles `^` at level 3, below unary, left-associative: `-2^2` = `(-2)^2` = 4 and `2^3^2` = `(2^3)^2` = 64. `&` at 9 and the comparisons at 7–8 are the doc's C-inversion (`x & y == z` = `x & (y == z)`). A single `=` in a condition is an assignment, never a comparison (EXP-4, `rpgcode-language.md:133`), which falls out of level 15.

**Step IR** (ADR 0004 decision 1's linear array; replaces `ops.ts:20-26`):

```ts
export type SourcePos = { readonly file: string; readonly line: number };

export type StepOp =
  | { readonly op: "push"; value: Value; pos: SourcePos }        // literal, also a label-reference name (STX-5)
  | { readonly op: "name"; name: string; pos: SourcePos }        // the array-name operand of an index (EXP-6/SEM-5)
  | { readonly op: "load"; name: string; pos: SourcePos }        // read a name → Arg(value, ref); creates it (SEM-4/SEM-5)
  | { readonly op: "declRef"; scope: VarScope; name: string; pos: SourcePos } // FUN-2: push the declared name's Arg
  | { readonly op: "storeRef"; pos: SourcePos }                  // write the value through the ref beneath it, keep the value
  | { readonly op: "index"; pos: SourcePos }                     // [.., baseName, index] → element Arg
  | { readonly op: "dup"; pos: SourcePos }
  | { readonly op: "pop"; pos: SourcePos }
  | { readonly op: "unop"; operator: UnaryOp; pos: SourcePos }
  | { readonly op: "binop"; operator: BinaryOp; pos: SourcePos }
  | { readonly op: "select"; pos: SourcePos }                    // a ? b : c, all three evaluated (R-40)
  | { readonly op: "jump"; target: number; pos: SourcePos }
  | { readonly op: "jumpIfFalse"; target: number; pos: SourcePos }
  | { readonly op: "call"; name: string; argc: number; pos: SourcePos } // AD-8's four-tier dispatch
  | { readonly op: "return"; pos: SourcePos };                   // FUN-3/FUN-7: pop this frame
```

`push` ≙ `OP_PUSH`, `call` ≙ `OP_CALL`, `return` ≙ `OP_RETURN`, `jump` ≙ `OP_JUMP`; there is still no `OP_YIELD`, because a blocking call is a call outcome, not an opcode (the tracer's Q11). `binop`/`unop`/`select` replace the tracer's plan of one op per operator: the operator travels in the op, so the union stays one variant each and the operators list is the EXP-2 table. **`kill`-style statement values:** §9.4 makes every operator yield a value (assignment included), so the lowering keeps the tracer's convention — **every statement lowering leaves exactly one value**, and the caller appends one `pop` (the tracer's `lower`, `lower.ts:35-48`). Control statements therefore leave the unset value (`push 0`) on every path, which balances the stack at each join without a phi.

**Lowering sketches.** `if`: `<c>; jumpIfFalse L1; <A>; jump Lend; L1: <c2>; jumpIfFalse L2; <B>; jump Lend; L2: <C>; Lend: push 0`. `while`: `Ltop: <c>; jumpIfFalse Lend; <B>; jump Ltop; Lend: push 0`. `until` (check first, SEM-2): `Ltop: <c>; unop !; jumpIfFalse Lend; <B>; jump Ltop; Lend: push 0` — one op for both loops. `for`: `<init>` (the statement's own `pop`), `Ltop: <cond or nothing>; Lend:…; <B>; <step>; jump Ltop; Lend: push 0`. `switch`: `<x>; L1: dup; <v1>; binop ==; jumpIfFalse L2; pop; <A>; jump Lend; L2: dup; <v2>; binop ==; jumpIfFalse L3; pop; <B>; jump Lend; L3: pop; <D>; Lend: push 0` — `x` is evaluated once and carried on the stack, each comparison uses SEM-3's `==`, and every block ends with `jump Lend`, so there is no fall-through (STX-2). Assignment `x = v`: `load x; <v>; storeRef` — one write path for a name, an index and a call result; `local(x) = v`: `declRef local x; <v>; storeRef`; `a[i] = v`: `name a; <i-as-key>; index; <v>; storeRef`. Compound `x += v`: `load x; dup; <v>; binop +; ...` — for a named target the second `load` is the `dup`; for `a[i] += v` the sequence is `name a; <i>; index; dup; <v>; binop +; storeRef`, which evaluates `i` once. `x++`/`++x`: the same shape with the value returned before or after the increment.

**`Frame.locals` as slots, and why.** A by-reference parameter must alias, not copy: a write inside the callee has to land in the caller's variable, and `return &x` has to hand back a live `RefId`. Storing each local as `{ value, ref }` gives both from AD-7's existing field: `ref === "local:<name>"` is a plain local whose storage is `value`; any other `ref` is an alias, so `load` reads through it and `storeRef`/the name-write path writes through it. Only `PlainData` is added (G1.2), and `Arg = { value, ref }` already carried this idea at the call boundary (`builtins.ts:42`). This is the shape the AD-7 doc-only task above states. The alternative — copy-in/copy-out for `&` parameters — was rejected: it needs a second copy of every parameter value and an unknown write-back order, and it cannot express `return &param`. The measure of the change: a `COMPILER_VERSION` bump to `"2"` (the opcode table and the frame shape both change, and the compiler check dominates any per-section number) plus `SCHEMA_VERSIONS.vm = 2` and the previous-version fixture, exactly as `save/state.ts:11-15` requires.

**Call resolution (AD-8's precedence, `registry.ts:38-48`).** One `call` op; one shared resolver in `registry.ts`:

```ts
export type FunctionTarget = {
  readonly program: ProgramRef;
  readonly entry: number;
  readonly params: readonly ParamInfo[];   // { name, byRef }
};
export type CallResolution =
  | { readonly kind: "function"; readonly target: FunctionTarget }
  | { readonly kind: "command"; readonly command: ResolvedCommand };
export function resolveCall(name: string, argc: number, program: Program, commands: CommandLookup): CallResolution | undefined;
```

Order: redirect (entry 8, a name rewrite, absent now) → script function (`program.functions[name]` matching `argc`) → built-in (`commands.get`) → extension (entry 21/22, inside `commands`). A script function resolves only by name **and parameter count** (FUN-1: never by type), which is why the resolver takes `argc` while `TierLookup` does not — a `CommandHandler` cannot enter a frame (a handler is pure and mutates nothing, AD-8), so the `scriptFunction` tier returns a *target*, not a handler, and `runThread`'s `call` case (`vm.ts:211-237`) enters the frame itself. The tier stub's doc comment is corrected to say so; `assembleCommands`, `createCommandLookup` and the warning behaviour stay as entry 3 shipped them.

**Control effects (FUN-7, STX-5).** A command may not move the instruction pointer or pop frames, but AD-10 makes the VM the owner of the `vm` section, so the VM is entitled to apply a `vm` control effect — the same route by which it already applies `out` (AD-8). The effect is the existing plain-data shape `CommandEffect = { kind, args }` (`plugin.ts:143-146`): `{ kind: "vm.control", args: ["end"] }`, `["run", <ProgramRef>]` and `["jump", "<label>"]`. `end` abandons every frame of the thread and finishes it; `run` abandons them and starts the new program in the same thread (FUN-7: the caller ends *before* the new one starts, and when the `run()` program calls `end()` the whole chain is finished); `jump` resolves the label in the current frame's function scope (a label never crosses a function, STX-5). The alternative — a `control` field on `CommandResult` — would be a contract change requiring a doc-first AD-8 amendment, for no gain. `CORE_PLUGIN.end` returns the `end` effect from this entry; entry 13 owns `done`/`stop` and the `run`/`branch`/`change`/`rpgCode`/`delay`/`iif`/`getTickCount` names, and needs to emit nothing new to get the unwinding.

**Source positions: one owner (R-38a, E-98).** The lexer records a 1-based `line` on every token; the parser copies it onto every AST node; `lower` stamps every emitted op with `pos`. `file` comes from the program reference — `ref.path` for `kind: "file"`, and `"<inline>"` for an inline program, whose `ProgramRef` carries only text (AD-7's shape has no room for a name, and changing it would change a state type for a cosmetic gain); entry 8 can give a real name to file programs and entry 19 to imported ones. To keep the per-op cost one object reference, the lowering interns one frozen `SourcePos` per distinct `(file, line)` pair in a `Map` and reuses it. `pos` never enters a hash: compiled code lives outside `GameState` (AD-7), so the canonical form is unaffected.

**Value semantics (`values.ts`, SEM-3, SEM-5).** Equality is numeric when both sides are numbers and an exact, case-sensitive byte comparison otherwise, with a never-assigned variable counting as a number; the relational operators always compare numerically, converting a string side with the longest-prefix rule of `rpgcode-runtime.md:15`; bitwise, `%` and the shifts convert with `ToInt32` and a shift count is modulo 32; `+` concatenates when either side is a string, using the six-significant-digit number-to-string (`rpgcode-runtime.md:16-23`). Truthiness is `rpgcode-runtime.md:14` (R-39): a string is true unless it folds to `"off"`, a number is true when it is not zero. A `null` operand — "no value", what a woken `sleep` or a plain command pushes — behaves as the unset value: 0 in a numeric context, the empty string in a string context (SEM-5). The lowering of `?:` and `&&`/`||` follows R-40 literally: `&&`, `||` and `?:` evaluate **all** operands, so `&&`/`||` are `binop` and `?:` is `select` (evaluate cond, then the true arm, then the false arm; `select` picks by truthiness). **This is a deliberate reading of one sentence** (`rpgcode-language.md:141`, `rpgcode-runtime.md:14`); the alternative, that only `&&`/`||` lose short-circuiting and `?:` branches, was rejected because the sentence names `?:` explicitly and the ruling is the doc's, not this plan's.

**Indexes and array names (EXP-6, SEM-5).** `a[i]` indexes the variable whose name is `a` joined with the formatted key, so `a` is pushed as a *name* (`name`) not read as a value, and `index` computes `<base>[<key>]` and resolves it by the ordinary scope rule. A call or member base (`f(x)[i]`, EXP-6) contributes its value converted to text. An index chain is a name chain: `a[1][2]` names `a[1][2]`, which is SEM-5's rule applied twice, and the alternative reading (the value of `a[1]` names a second array) is recorded here as the rejected one because it would make `m["k"][2]` depend on a stored value no doc mentions. The key format is SEM-5's (the six-significant-digit number, a string key verbatim), so `a[1]`, `a["1"]` and `a[1.0]` are one variable and `m["Key"]` differs from `m["key"]`. `kill`, whole-array semantics and `autoLocal(true)` as a command remain entry 12's; the frame's `autoLocal` flag is honoured by the name resolver here because SEM-4 conditions the plain-assignment scope on it.

**Function definitions and hoisting.** Definitions are program-level (7 top-level and 22 in-class in the corpus, none nested) and hoisted: the parser collects them, and the lowering emits top-level code from op 0 and each function body after it, recording `entry`/`end`, `params` and its own `labels`. A call therefore works before the definition's line (MOD-1's settled hoisting, `discovery/language-readiness.md:287` + the doc-fix proposal it lists, item 11). A definition inside a block is an error naming the construct. A program of definitions only (the shape of `system.prg`, `discovery/language-readiness.md` "What `system.prg` needs from the VM") lowers to a single `return`: loading it runs nothing. Overload is by count; two definitions of one name and count is a declaration error, which R-38a (`rpgcode-language.md:154-156`) names as a real 3.1 error. `inline` is accepted and ignored (FUN-6); `method` and `function` are the same keyword (FUN-4); a parameter is `[Type] name [&]` with the type ignored (FUN-1), and — because `rpgcode-language.md:83` writes the `&` after the name while `:132` and the keywords section write it before it — **both spellings are accepted** and mean one by-reference parameter; the disagreement is recorded as a doc question rather than silently resolved in code.

**`:`-name (STX-5 vs SEM-4).** `:`-name is two things in the docs: a label statement and a label argument (`rpgcode-language.md:87`, `:134`), and a global-forcing name read (the scope paragraph, `rpgcode-language.md:62`). The parser decides by position and nothing else: at statement position followed immediately by a statement terminator, or in an argument list, `:name` is a label statement / label reference (the folded name carried as a string, resolved by `vm.control`); anywhere else in an expression it is a global reference (`load` with `ref = global:<name>`). The corpus uses neither form, so no game can notice the choice.

**`break`/`continue`.** Not 3.1: the keyword table (`rpgcode-language.md:55-70`) has no entry for them, loops are exited by their condition, `end()` or a label, and the corpus never uses them (0 uses, `discovery/language-readiness.md:122`, "Never used anywhere"). They keep failing, but with a message citing the spec rather than "entry 5 adds it", and a test pins it. The lexer's current `break`/`continue` rejection (`lex.ts:87-88`) is rewritten, not deleted.

**The synthetic program** (the deliverable proof; one statement per line, `{` on its own line for the STX-1 leniency):

```
global(hits) = 0
count = 4
function twice(n) { return n + n }
function bump(&n) { n = n + 1 }
function ref() { return &count }
function sum(n)
{
  if (n <= 0) { return 0 }
  return n + sum(n - 1)
}
function fact(n) {
  if (n <= 1) { return 1 }
  return n * fact(n - 1)
}
function classify(v) {
  switch (v) {
    case (0) { return "none" }
    case (1): { return "one" }
    default: { return "many" }
  }
  return "unreachable"
}
local(i) = 0
total = 0
while (i < 3) { total = total + twice(i); i = i + 1 }
until (i >= 5) { i = i + 1 }
for (local(j) = 0; j < 2; ++j) { hits = hits + 1 }
bump(total)
ref() = 10
deep = sum(20)
big = fact(8)
label = classify(1)
off = "off"
if (off) { label = "truthy" } else { label = label + "!" }
mid = 1 + sleep(2) + 3
end()
```

Pinned outcomes: `i` 5, `total` 7 (`twice(0)+twice(1)+twice(2)` = 0+2+4 in the `while`, then `bump` adds 1), `count` 10 through the reference `ref()` returns, `hits` 2, `deep` 210 (`sum(20)` = 20·21/2), `big` 40320, `label` `"one!"` (`classify(1)` then the false `"off"` condition takes the `else`), `mid` 4, thread `finished`; the top-level `local(i)`/`local(j)` never enter the global table and the global `count` is written only through the returned reference. The operand-stack case is `mid = 1 + sleep(2) + 3`: at the yield the frame's `operands` holds the partial `[1]`, the restored VM re-wakes the same call and pushes 0, and `binop +` twice gives 4.

## Verification

Commands (in the worktree, after `pnpm install`; the fixtures fetch is needed for `test:strict`):

- `pnpm typecheck` — `tsc -b` plus every package's test typecheck; expected: no errors, including `core`'s `AssertPlainData<GameState>` assertions with the new `LocalSlot` shape.
- `pnpm lint` — `node tools/check-core-deps.mjs && eslint .`; expected: clean; the G1.4 bans (no generator, `async`, `await`, `Promise`, `queueMicrotask`) apply to every new `core/src/script/**` file with no suppression, and the G3 `Math`/`**` rules hold in `values.ts` and the new op handlers.
- `node --test packages/core/test/script-frontend.test.ts packages/core/test/script-expressions.test.ts packages/core/test/script-control-flow.test.ts packages/core/test/script-functions.test.ts packages/core/test/script-operand-stack.test.ts packages/core/test/script-vm.test.ts packages/core/test/script-state.test.ts` — expected: all pass, none skipped.
- `pnpm test` — `tsc -b && node --test "packages/*/test/*.test.ts"`; expected: all tests pass, none skipped (the no-skips job), including `script-registry.test.ts`, `lint-rules.test.ts` and both updated `fixtures/**/good.ts`.
- `pnpm test:strict` — `tsc -b && node tools/no-skips/run.mjs` after `pnpm fixtures:fetch`; expected: every test runs, 0 skipped.
- `node --test packages/runner-harness/test/script-host.test.ts` — expected: pass, including the new mid-expression yield case (`result = 1 + sleep(2) + 3` snapshotted during the wait restores to the identical per-tick hash).
- `pnpm graph` — expected: unchanged edge list (`values.ts` is a module inside `core`, not a package).
- `pnpm golden` — expected: green against the unchanged `golden/test-double/{run.json,golden.json}` and `golden/hash-vectors.json`; no golden file edited (G5) and no `runLog`/headless change.
- `pnpm provenance` — expected: clean; no legacy identifier appears in any new or changed `.ts` or fixture.
- `pnpm licence` — expected: clean; no dependency was added.

The acceptance tests themselves, by name: `script-frontend.test.ts` — "tokenizes every §9.2 operator, comment form and the `_` continuation with line numbers", "rejects the TK2, class, module and error-handling constructs by name and entry", "parses the seven corpus-settled leniency forms", "rejects a brace-less body naming STX-1"; `script-expressions.test.ts` — "the EXP-2 table evaluates in the ruled order", "`^` equals `fmath.pow` bit for bit", "the SEM-3 worked values match", "the SEM-5 index key unifies 1, "1" and 1.0", "truthiness is `off`-based and `0` is false", "`&&`, `||` and `?:` evaluate every operand", "`%` by zero throws the ERR-2 class error", "a null operand behaves as the unset value"; `script-control-flow.test.ts` — "`if`/`elseif`/`else` selects correctly with `else` on the next line", "`while` and `until` differ only in the check-first polarity", "`for` accepts empty parts and a `local(x) = v` initialiser", "`switch` matches colon-less cases, falls through to `default` and never falls through", "a label is visible in its own function only and `branch(:name)` carries its folded name"; `script-functions.test.ts` — "overload by arity reaches each definition", "a duplicate name and arity is a declaration error naming the line", "a typed parameter is ignored and both `&` spellings alias", "`local` shadows a global and `global` reaches past it", "`local(x)` alone declares and leaves it unset", "`return &lvalue` makes a call an assignment target", "the `end` control effect abandons every frame and finishes the thread", "`run` abandons the caller before the new program starts", "`fact` recurses 500 deep without a host stack overflow"; `script-operand-stack.test.ts` — "every VM step of the synthetic program round-trips through snapshot and restore", "a restored VM finishes with the identical final state hash", "at least one step has a non-empty operand stack mid-expression"; `runner-harness/test/script-host.test.ts` — "a blocking call inside an expression snapshots and restores mid-operand-stack"; `script-state.test.ts` — "a `compiler` \"1\" fixture save is refused with `restore.compiler-mismatch`".
