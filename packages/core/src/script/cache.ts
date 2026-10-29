/**
 * The compiled-program cache (ADR 0004 decision 1; docs/spec/engine/rpgcode-modules-and-objects.md MOD-3, R-42).
 *
 * state. The key is the ref's identity: its source (the text, or the file path
 * and source hash), the compiler version, the ordered run-time include list, the
 * redirect table in force when it was compiled and its optional package owner.
 * The same key is the same compile, so a second request parses nothing; a changed
 * include list, redirect table or owner is a different key and compiles afresh
 * instead of mutating call sites that are already bound.
 */

import { compileProgram, programKey, type CompileContext, type Program, type ProgramNotice, type ProgramRef } from "./program.ts";

/** Compiled programs by ref identity. */
export type ProgramCache = {
  /** The compiled program of `ref`, compiling it on first request. */
  get(ref: ProgramRef): Program;
  /**
   * The first compiled program that defines `def` (FUN-8; entry 18.4), in
   * compile order, or `undefined` when no compiles so far defines it. The
   * caller looks in the running program first, so this only answers for a
   * handle made somewhere else — a lambda stored in a global and called from a
   * program another thread is running. Compile order is deterministic, so which
   * owner answers is deterministic too.
   */
  find(def: string): Program | undefined;
  /** How many compiles this cache has run (tests and diagnostics). */
  readonly compiles: number;
};

/**
 * Build a cache over `context`. `report` receives the notices of each compile
 * exactly once, when the compile happens, so a clash or cycle is raised once
 * however many threads share the program.
 *
 * Answers are also memoized per reference object. The VM asks for the current
 * frame's program on every instruction (`ensureCurrentProgram` and `stepThread`
 * in `vm.ts`), and an inline reference carries the whole program text, so
 * rebuilding the cache key per step costs more than the step it guards. That
 * memo rests on `ProgramRef` being immutable: every field is `readonly`, and
 * every producer (`fileProgramRef`, `withOwner`, `withRedirects`, restore and
 * the include/redirect re-pointing in `modules.ts`) builds a new object rather
 * than editing one. Editing a reference in place after its first request is a
 * contract violation, because this cache would keep answering for the content
 * it saw first; a changed program arrives as a new reference, whose key misses
 * and compiles afresh. Each cache keeps its own memo, so caches over different
 * contexts and separate rigs never share a compiled program.
 */
export function createProgramCache(
  context: CompileContext,
  report: (notices: readonly ProgramNotice[]) => void = () => {},
): ProgramCache {
  const programs = new Map<string, Program>();
  const byRef = new WeakMap<ProgramRef, Program>();
  let compiles = 0;
  return {
    get(ref) {
      const memoized = byRef.get(ref);
      if (memoized !== undefined) return memoized;
      const key = programKey(ref);
      const hit = programs.get(key);
      if (hit !== undefined) {
        byRef.set(ref, hit);
        return hit;
      }
      const compiled = compileProgram(ref, context);
      compiles += 1;
      programs.set(key, compiled);
      byRef.set(ref, compiled);
      if (compiled.notices.length > 0) report(compiled.notices);
      return compiled;
    },
    find(def) {
      for (const program of programs.values()) {
        if (Object.hasOwn(program.functions, def)) return program;
      }
      return undefined;
    },
    get compiles() {
      return compiles;
    },
  };
}
