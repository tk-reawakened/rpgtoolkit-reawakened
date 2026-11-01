/**
 * The spec runner (TOOL-5): `*.spec.prg` discovery, a fresh fixture per case,
 * determinism, and the strict/`only` modes.
 *
 * Each case is isolated by re-running the spec file once with the library's
 * `specOnlyCase` global set, so every case starts from a fresh `GameState` and
 * cannot see or leak state to its neighbour. Two runs of the same case must
 * produce the same outcomes and the same state hash.
 */

import {
  advanceScriptTick,
  createGameState,
  createScriptServices,
  drainEffects,
  hashGameState,
  startProgram,
  STEP_BUDGET,
  type GameState,
} from "@tk-reawakened/core";
import { SPEC_PLUGIN } from "./index.ts";

export type SpecOutcomeKind = "pass" | "fail" | "skip" | "only";

export type SpecOutcome = {
  readonly kind: SpecOutcomeKind;
  /** `<case>/<matcher>` as the library records it. */
  readonly label: string;
  readonly expected: string;
  readonly actual: string;
  readonly line: number;
  readonly column: number;
};

export type SpecCaseResult = {
  readonly name: string;
  readonly outcomes: readonly SpecOutcome[];
  /** Strict: only passes count. Lenient: a skip is tolerated and still reported. */
  readonly ok: boolean;
  /** `hashGameState` after the case's run. */
  readonly stateHash: string;
};

export type SpecFileReport = {
  readonly file: string;
  readonly cases: readonly SpecCaseResult[];
  readonly skipped: readonly string[];
  /** `only` narrowed the run; the text is stable. */
  readonly warning: string | null;
  readonly failures: readonly string[];
};

export type SpecRunOptions = {
  /** The library source prepended to the file. */
  readonly library: string;
  readonly seed?: number;
  readonly strict?: boolean;
};

export const ONLY_WARNING = "only() narrowed the run to the marked cases; unmarked cases were not run";

const OUTCOME_KINDS = new Set(["pass", "fail", "skip", "only"]);

function runIsolated(library: string, source: string, onlyCase: number, seed: number): {
  readonly outcomes: SpecOutcome[];
  readonly hash: string;
} {
  const state: GameState = createGameState({ seed });
  state.vm.globals.speconlycase = onlyCase + 1; // 0 (unset) runs every case
  startProgram(state.vm, { kind: "inline", text: `${library}\n${source}`, ir: "1" });
  const services = createScriptServices(state, [{ definition: SPEC_PLUGIN }]);
  for (let step = 0; step < 1000; step += 1) {
    if (advanceScriptTick(state, services, STEP_BUDGET) === "finished") break;
  }
  const outcomes: SpecOutcome[] = [];
  for (const record of drainEffects(state.vm)) {
    if (record.name !== "specresult") continue;
    const kind = String(record.args[0] ?? "");
    if (!OUTCOME_KINDS.has(kind)) continue;
    outcomes.push({
      kind: kind as SpecOutcomeKind,
      label: String(record.args[1] ?? ""),
      expected: String(record.args[2] ?? ""),
      actual: String(record.args[3] ?? ""),
      line: Number(record.args[5] ?? 0),
      column: Number(record.args[6] ?? 0),
    });
  }
  return { outcomes, hash: hashGameState(state) };
}

function caseNameOf(label: string): string {
  const slash = label.indexOf("/");
  return slash < 0 ? label : label.slice(0, slash);
}

/** `<matcher>: expected X, actual Y`, the message a failing case reports verbatim. */
export function failureMessage(outcome: SpecOutcome): string {
  const slash = outcome.label.indexOf("/");
  const matcher = slash < 0 ? outcome.label : outcome.label.slice(slash + 1);
  return `${matcher}: expected ${outcome.expected}, actual ${outcome.actual}`;
}

/** The case names, in source order, from one run with every case enabled. */
export function discoverCases(library: string, source: string, seed = 0): string[] {
  const names: string[] = [];
  for (const outcome of runIsolated(library, source, -1, seed).outcomes) {
    const name = caseNameOf(outcome.label);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Run one spec file: every case on a fresh fixture, twice, and compare. */
export function runSpecFile(file: string, source: string, options: SpecRunOptions): SpecFileReport {
  const seed = options.seed ?? 0;
  const strict = options.strict ?? true;
  const names = discoverCases(options.library, source, seed);
  const cases: SpecCaseResult[] = [];
  const skipped: string[] = [];
  const failures: string[] = [];
  let onlySeen = false;
  names.forEach((name, index) => {
    const first = runIsolated(options.library, source, index, seed);
    const second = runIsolated(options.library, source, index, seed);
    if (first.hash !== second.hash) {
      throw new Error(`${name}: two runs gave different state hashes (${first.hash} vs ${second.hash})`);
    }
    if (JSON.stringify(first.outcomes) !== JSON.stringify(second.outcomes)) {
      throw new Error(`${name}: two runs gave different outcomes`);
    }
    if (first.outcomes.some((outcome) => outcome.kind === "only")) onlySeen = true;
    if (first.outcomes.some((outcome) => outcome.kind === "skip")) skipped.push(name);
    const ok = first.outcomes.length > 0 && first.outcomes.every((outcome) => outcome.kind === "pass" || (!strict && outcome.kind === "skip"));
    for (const outcome of first.outcomes) if (outcome.kind === "fail") failures.push(`${name}: ${failureMessage(outcome)}`);
    cases.push({ name, outcomes: first.outcomes, ok, stateHash: first.hash });
  });
  return { file, cases, skipped, warning: onlySeen ? ONLY_WARNING : null, failures };
}
