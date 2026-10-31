---
type: epic
title: "First-class functions and pure-RPGCode plugin architecture"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-5"]
assignee: ""
risk: high
status: done
tracker_id: "#916"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/916"
---

# First-class functions and pure-RPGCode plugin architecture

## Description

RPGCode evolves from static command-tier resolution into an extensible, modern language with first-class function values and closures (`&fn`, anonymous methods, plain-data `FunctionHandle` in `Value`). Functions can be stored in variables, passed to other functions, and reassigned to override or wrap engine commands. This collapses the complex 4-tier resolution system (redirects, built-ins, script functions, legacy native plugins) into a unified, deterministic environment table. Authors and community creators can write full feature sets (battle systems, audio middleware, weather engines, quest trackers) entirely in portable, sandboxed RPGCode without C++ DLLs or heavy manifest plumbing.

## Outcome

RPGCode scripts can store, pass, invoke, and wrap functions as first-class values. Community feature sets package as modular `.prg` files that compose cleanly via middleware chaining. The legacy 4-tier resolution pipeline and compile-time redirect table collapse into a unified environment table, with 100% backwards compatibility for legacy games.

## Done when

1. A script function or built-in command can be referenced with `&name` and stored in a local, global, or object variable.
2. Stored function handles can be invoked dynamically with standard call syntax: `f(args)` or `obj->fn(args)`.
3. Anonymous methods / function expressions (`method(params) { ... }`) can be instantiated, passed as callbacks, and assigned.
4. An author can reassign a global symbol to wrap or override a built-in command, saving the original handle and chaining to it.
5. Function handles in `GameState.vm` serialize to plain JSON (G1) and restore bit-identically across saves and snapshots (G3).
6. Legacy 3.1 games (including `#redirect`, `#include`, and arity overloading) run identically with zero regressions in the headless golden test suite.
7. Compiler / parser diagnostics emit clean errors for arity mismatches, non-callable invocations, and circular inclusion.

## Boundaries

- Extends `core/script` (parser, compiler, AST, lowerer, VM, and registry).
- Does not alter host bindings, runners, or editor chrome.
- Preserves Blue Oak Bronze-or-better dependency constraints (G6) and pure TypeScript core rules (G2).
- Legacy 3.1 script compatibility is non-negotiable; old syntax continues to compile and execute identically.

## References

- spec - `_bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md`, section Capabilities (CAP-5)
- spine - `_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md`, AD-7, AD-8, AD-10, AD-14, AD-26
- constraint - `docs/guardrails.md`, G1, G2, G3, G7
- reference - `docs/spec/engine/rpgcode-language.md`, `rpgcode-modules-and-objects.md`, `rpgcode-functions.md`
- idea - `_bmad-output/initiative-rpgtoolkit-reawakened/nice-to-have.md`, "First-class function handles and pure-RPGCode plugin architecture"

## Notes

- Decision: Owner approved incepting as Epic 18 on 2026-10-18.
- Priority: Scheduled ahead of downstream runtime epics (Battle, Menu, Audio implementation) to establish the clean plugin and middleware contract early.
- Waits on `epic-rpgcode-vm` (Epic 3) because it builds directly on the step-machine VM, AST, and lowerer.
- Waits on `epic-platform-baseline` (Epic 1) for CI gates and test harness.
- Guardrail G1 compliance: Function handles are plain data (`{ kind: "function", id: number }`), never native V8 closures or C++ pointers.
- Guardrail G3 compliance: Invocations through function pointers run within the exact deterministic step budget and fixed tick ordering.
