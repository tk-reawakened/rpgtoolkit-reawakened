/**
 * The rule-based linter (docs/spec/engine/rpgcode-tooling.md#tool-3 and the
 * epic's Done-when 6). Every rule reads the TOOL-6 index, the units the compiler
 * parsed while building it (#tool-3-rules) and the gate-checked catalogue - never
 * a fresh parse of the source - and produces the one TOOL-3 diagnostic shape with
 * a stable `<area>/<rule>` id. A rule that cannot be assessed for a program is
 * listed in the summary's `unassessed`, never treated as clean (#tool-3-assessment).
 *
 * A project configures rules in one file: a per-rule severity (`off` disables)
 * and an ignore list. Configuring nothing yields the defaults, and nothing is
 * silently suppressed - the summary names the disabled rules and counts the
 * ignored findings.
 */

import { commandDocumentation, foldAscii, HOST_METHOD_NAMES, type ResolvedPlugin } from "@tk-reawakened/core";
import { legacyFixes } from "./fixes.ts";
import { formatSource } from "./format.ts";
import {
  boundCallSites,
  forEachExpression,
  hasComputedLabelTarget,
  hasDynamicReference,
  hasErrorHandler,
  labelsIn,
  mentionsIn,
  nestedBlocks,
  parsedOf,
  scopesOf,
  siteKey,
  siteOf,
  TERMINATOR_NAMES,
  type ParsedFacts,
  type Site,
} from "./lint-analysis.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { rangeOf } from "./diagnostics.ts";
import type { IndexDocument, IndexProgram, IndexPos } from "./index-document.ts";
import type { Block, ProgramUnit } from "@tk-reawakened/core";

export type RuleId =
  | "lint/unknown-command"
  | "lint/command-arity"
  | "lint/shadowed-builtin"
  | "lint/unresolved-include"
  | "dialect/sigil"
  | "dialect/return-method"
  | "dialect/obsolete-control"
  | "dialect/unquoted-command-argument"
  | "lint/unused-variable"
  | "lint/unused-label"
  | "lint/unused-function"
  | "lint/unreachable-code"
  | "lint/deprecated-command"
  | "lint/obsolete-command"
  | "style/format";

export type LintSeverity = "error" | "warning" | "info" | "hint";

export type RuleDefinition = {
  readonly id: RuleId;
  readonly defaultSeverity: LintSeverity;
  /** One line a game author can act on. */
  readonly rationale: string;
  /** Whether the linter can also rewrite the source for this rule. */
  readonly fix: boolean;
};

/** The rule table. A rule never changes meaning without a major change to the index/spec. */
export const RULES: readonly RuleDefinition[] = [
  {
    id: "lint/unknown-command",
    defaultSeverity: "error",
    rationale: "A call names no script function, class, label or registered command, so it fails at run time.",
    fix: false,
  },
  {
    id: "lint/command-arity",
    defaultSeverity: "warning",
    rationale: "A call passes fewer required or more parameters than the registered command takes.",
    fix: false,
  },
  {
    id: "lint/shadowed-builtin",
    defaultSeverity: "warning",
    rationale: "A script definition reuses a registered command's name, so the command wins at the call site (R-35).",
    fix: false,
  },
  {
    id: "lint/unresolved-include",
    defaultSeverity: "warning",
    rationale: "An include names a file the asset index does not serve, so its definitions are missing.",
    fix: false,
  },
  {
    id: "dialect/sigil",
    defaultSeverity: "warning",
    rationale: "The legacy `!`/`$` sigil is ignored by the lexer; deleting it makes the program plain (docs/spec/engine/rpgcode-dialects.md:57-69).",
    fix: true,
  },
  {
    id: "dialect/return-method",
    defaultSeverity: "warning",
    rationale: "`#ReturnMethod(x)` is the pre-3.1 spelling of `return x`.",
    fix: false,
  },
  {
    id: "dialect/obsolete-control",
    defaultSeverity: "warning",
    rationale: "`#Dos`, `#Windows`, `#Gone`, `#Over`, `#Reset` and `#Win` are older engine controls; they must not be removed without proving the result keeps their behavior.",
    fix: false,
  },
  {
    id: "dialect/unquoted-command-argument",
    defaultSeverity: "warning",
    rationale: "A `#Command` line with an unquoted argument is the Toolkit 2.x spelling; 3.1 reads `command(\"text\")`.",
    fix: false,
  },
  {
    id: "lint/unused-variable",
    defaultSeverity: "warning",
    rationale: "A `local(x)` nothing in its function reads, passes, calls or captures is probably a mistake or left over.",
    fix: false,
  },
  {
    id: "lint/unused-label",
    defaultSeverity: "warning",
    rationale: "A label nothing in its function branches to or names is dead weight (STX-5).",
    fix: false,
  },
  {
    id: "lint/unused-function",
    defaultSeverity: "hint",
    rationale: "In a closed project, a function no call, read or string names and no entry point declares has no static use.",
    fix: false,
  },
  {
    id: "lint/unreachable-code",
    defaultSeverity: "warning",
    rationale: "A statement after `return` or the built-in `end` in the same block, with no label before it, can never run.",
    fix: false,
  },
  {
    id: "lint/deprecated-command",
    defaultSeverity: "warning",
    rationale: "The catalogue marks the command deprecated; its entry names the replacement and why. Replacing it may change defaults or waits.",
    fix: false,
  },
  {
    id: "lint/obsolete-command",
    defaultSeverity: "warning",
    rationale: "The catalogue marks the command obsolete: it no longer does what it did in Toolkit 3.1.",
    fix: false,
  },
  {
    id: "style/format",
    defaultSeverity: "hint",
    rationale: "The line differs from the TOOL-4 formatter's output (indentation by brace depth and canonical casing).",
    fix: true,
  },
];

/** Why a rule did not run over all of a program (docs/spec/engine/rpgcode-tooling.md#tool-3-assessment). */
export type UnassessedReason =
  | "missing-source"
  | "unknown-dialect"
  | "unsupported-dialect"
  | "unmapped-source-span"
  | "invalid-program"
  | "incomplete-project"
  | "dynamic-reference";

export type Unassessed = {
  /** The program name, as `LintResult.programs` names it. */
  readonly file: string;
  readonly rule: RuleId;
  readonly reason: UnassessedReason;
};

/** One ignore entry: a rule, a file, a line or any combination; absent fields match anything. */
export type LintIgnore = {
  readonly rule?: string;
  readonly file?: string;
  readonly line?: number;
};

/** The one per-project config file (`tkr-lint.json`). */
export type LintConfig = {
  readonly severity?: { readonly [rule: string]: LintSeverity | "off" };
  readonly ignore?: readonly LintIgnore[];
};

export type LintSummary = {
  readonly diagnostics: number;
  /** Rules the config turned off, so a reader knows the run is narrower than the table. */
  readonly disabledRules: readonly string[];
  /** Findings an ignore entry matched and removed. */
  readonly ignoredRanges: number;
  /** Rules that did not run over all of a program; their silence is not a clean result. */
  readonly unassessed: readonly Unassessed[];
};

export type LintResult = {
  readonly diagnostics: readonly Diagnostic[];
  /** `programs[i]` is the name of the program `diagnostics[i]` was found in, so a caller can name the file. */
  readonly programs: readonly string[];
  readonly summary: LintSummary;
};

export type LintOptions = {
  readonly plugins: readonly ResolvedPlugin[];
  readonly config?: LintConfig;
  /** Each program's source text, keyed by its name; the dialect rules run where it is supplied. */
  readonly sources?: { readonly [name: string]: string };
  /**
   * Whether the run has an asset index behind it. Only then can an unserved
   * include be told from a file the project ships elsewhere, so the rule is off
   * without one (the CLI passes true; a stock baseline over sources without their
   * game tree passes false).
   */
  readonly resolveIncludes?: boolean;
  /** Report index findings only for each indexed program's own source unit. */
  readonly ownUnitsOnly?: boolean;
  /**
   * The source dialect, when the caller knows it (a `--dialect` argument or the
   * project). A program reference's own `dialect` wins. Without either, the rules
   * that read the parsed program are unassessed: the compiler's default is not
   * evidence of the dialect.
   */
  readonly dialect?: "tk3" | "tk2";
  /**
   * A closed project: every program of the project is in the index, and
   * `entryPoints` names the functions called from outside it. Only then does
   * `lint/unused-function` run. The caller derives this from the selected project
   * file, never from a list of paths.
   */
  readonly project?: { readonly closed: true; readonly entryPoints: readonly string[] };
};

const SEVERITIES = new Set<string>(["error", "warning", "info", "hint", "off"]);

/**
 * Validate a parsed config file. Returns the config, or the problems that make
 * it unusable - an unknown rule id or severity is a problem, never ignored,
 * because a typo in a rule name would otherwise silently disable a rule.
 */
export function readLintConfig(value: unknown): { readonly ok: true; readonly config: LintConfig } | { readonly ok: false; readonly problems: readonly string[] } {
  const problems: string[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, problems: ["the lint config must be a JSON object"] };
  }
  const record = value as Record<string, unknown>;
  const known = new Set<string>(RULES.map((rule) => rule.id));
  const severity = record.severity;
  if (severity !== undefined) {
    if (severity === null || typeof severity !== "object" || Array.isArray(severity)) {
      problems.push("severity must be an object of rule id to error|warning|info|hint|off");
    } else {
      for (const [rule, level] of Object.entries(severity)) {
        if (!known.has(rule)) problems.push(`severity names the unknown rule ${JSON.stringify(rule)}`);
        if (typeof level !== "string" || !SEVERITIES.has(level)) {
          problems.push(`severity for ${rule} must be error, warning, info, hint or off`);
        }
      }
    }
  }
  const ignore = record.ignore;
  if (ignore !== undefined) {
    if (!Array.isArray(ignore)) {
      problems.push("ignore must be an array");
    } else {
      ignore.forEach((entry, index) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          problems.push(`ignore[${index}] must be an object`);
          return;
        }
        const item = entry as Record<string, unknown>;
        if (item.rule !== undefined && (typeof item.rule !== "string" || !known.has(item.rule))) {
          problems.push(`ignore[${index}].rule names an unknown rule`);
        }
        if (item.file !== undefined && typeof item.file !== "string") problems.push(`ignore[${index}].file must be a string`);
        if (item.line !== undefined && (typeof item.line !== "number" || !Number.isInteger(item.line))) {
          problems.push(`ignore[${index}].line must be an integer`);
        }
      });
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    config: {
      ...(severity === undefined ? {} : { severity: severity as { readonly [rule: string]: LintSeverity | "off" } }),
      ...(ignore === undefined ? {} : { ignore: ignore as readonly LintIgnore[] }),
    },
  };
}

type Catalogue = {
  /** Folded name to its canonical documentation entry. */
  readonly byName: Map<string, ReturnType<typeof commandDocumentation>[number]>;
};

function catalogueOf(plugins: readonly ResolvedPlugin[]): Catalogue {
  const byName = new Map<string, ReturnType<typeof commandDocumentation>[number]>();
  for (const entry of commandDocumentation(plugins)) {
    const folded = foldAscii(entry.name);
    const existing = byName.get(folded);
    if (existing === undefined || existing.canonicalName !== folded) byName.set(folded, entry);
  }
  return { byName };
}

function rangeOfSite(pos: IndexPos): { start: { line: number; column: number }; end: { line: number; column: number } } {
  return rangeOf({ file: pos.file, line: pos.line, ...(pos.col === undefined ? {} : { col: pos.col }), ...(pos.endCol === undefined ? {} : { endCol: pos.endCol }) }, "");
}

function diagnostic(rule: RuleDefinition, severity: LintSeverity, pos: IndexPos, message: string): Diagnostic {
  return { code: rule.id, severity, range: rangeOfSite(pos), message, rule: rule.id };
}

/** The registered arity bounds of a command: required parameters, and the most it accepts. */
function arityOf(entry: ReturnType<typeof commandDocumentation>[number]): { readonly min: number; readonly max: number } {
  const variadic = entry.params.some((param) => param.variadic);
  return {
    min: entry.params.filter((param) => !param.optional && !param.variadic).length,
    max: variadic ? Number.POSITIVE_INFINITY : entry.params.length,
  };
}
// TOOL-5 names exist only when the spec runner loads its test package.
const SPEC_NAMES: Readonly<Record<string, true>> = {
  describe: true, it: true, test: true, beforeeach: true, aftereach: true, beforeall: true, afterall: true,
  expect: true, skip: true, only: true, tobe: true, toequal: true, tobetruthy: true, tobenull: true,
  tocontain: true, tobecloseto: true, tothrow: true,
  // TOOL-5 test doubles and spies (#tool-5-doubles).
  tohavebeencalledwith: true, tohavebeennthcalledwith: true, specinput: true, specticks: true, specrng: true, spyon: true,
};


function ruleOf(id: RuleId): RuleDefinition {
  const rule = RULES.find((item) => item.id === id);
  if (rule === undefined) throw new Error(`no rule ${id}`);
  return rule;
}

function rulesFor(program: IndexProgram, catalogue: Catalogue, options: LintOptions, boundSites: ReadonlySet<string>): Diagnostic[] {
  const found: Diagnostic[] = [];
  const unknown = ruleOf("lint/unknown-command");
  const arity = ruleOf("lint/command-arity");
  const shadowed = ruleOf("lint/shadowed-builtin");
  const unresolved = ruleOf("lint/unresolved-include");
  const declared = new Set<string>([...program.functions.map((fn) => foldAscii(fn.name)), ...program.classes.map((cls) => foldAscii(cls.name)), ...program.labels.map((label) => foldAscii(label.name))]);
  // A plain-name call may invoke a *variable* that holds a callable (FUN-8): the
  // lowering emits a load of that name before the call, so a name read anywhere in
  // the program is resolved at run time and is not an unknown command.
  const callableVariables = new Set(program.references.filter((site) => site.kind === "read" && site.name !== null).map((site) => foldAscii(site.name!)));
  // A parameter is called as a callable without a load, so the index states the
  // parameter names; a call to one is not an unknown command.
  for (const param of program.parameters) callableVariables.add(foldAscii(param));
  // A host object's methods are call targets that are not registered commands (`context.inventory.use`, `fighter.damage`).
  const hostMethods = new Set<string>();
  for (const name of HOST_METHOD_NAMES) {
    callableVariables.add(foldAscii(name));
    hostMethods.add(foldAscii(name));
  }

  for (const call of program.calls) {
    if (options.ownUnitsOnly && call.pos.file !== program.key) continue;
    if (call.file !== null) continue;
    const name = foldAscii(call.name);
    if (declared.has(name) || catalogue.byName.has(name) || callableVariables.has(name) ||
        (foldAscii(program.name).endsWith(".spec.prg") && Object.hasOwn(SPEC_NAMES, name))) continue;
    // A bare identifier statement lowers to a zero-argument call; a missing name is
    // the only fact the index has, so the rule states exactly that.
    found.push(diagnostic(unknown, unknown.defaultSeverity, call.pos, `\`${call.written ?? call.name}\` is not a script function, class, label or registered command`));
  }

  for (const call of program.calls) {
    if (options.ownUnitsOnly && call.pos.file !== program.key) continue;
    if (call.file !== null) continue;
    // A name that is also a host method (`context.inventory.replace`) may be that method rather than the command of
    // the same name, so its arity is not the catalogue's to state.
    if (hostMethods.has(foldAscii(call.name))) continue;
    // A callable parameter, local or reassigned name, or a declared method, runs before or instead of the command (#2077).
    if (boundSites.has(siteKey(call.pos))) continue;
    const entry = catalogue.byName.get(foldAscii(call.name));
    if (entry === undefined) continue;
    const bounds = arityOf(entry);
    if (call.arity >= bounds.min && call.arity <= bounds.max) continue;
    const expected = bounds.max === Number.POSITIVE_INFINITY ? `${bounds.min} or more` : bounds.min === bounds.max ? `${bounds.min}` : `${bounds.min} to ${bounds.max}`;
    found.push(diagnostic(arity, arity.defaultSeverity, call.pos, `\`${entry.canonicalName}\` takes ${expected} parameter(s); this call passes ${call.arity}`));
  }

  for (const fn of program.functions) {
    if (options.ownUnitsOnly && fn.file !== program.key) continue;
    const entry = catalogue.byName.get(foldAscii(fn.name));
    if (entry === undefined) continue;
    found.push(diagnostic(shadowed, shadowed.defaultSeverity, { file: fn.file, line: fn.line, ...(fn.col === undefined ? {} : { col: fn.col }), ...(fn.endCol === undefined ? {} : { endCol: fn.endCol }) }, `\`${fn.name}\` shadows the registered command \`${entry.canonicalName}\`; calls bind to the command (R-35)`));
  }

  if (options.resolveIncludes) for (const include of program.includes) {
    if (options.ownUnitsOnly && include.file !== program.key) continue;
    if (include.key !== undefined) continue;
    found.push(diagnostic(unresolved, unresolved.defaultSeverity, { file: include.file, line: include.line, ...(include.col === undefined ? {} : { col: include.col }), ...(include.endCol === undefined ? {} : { endCol: include.endCol }) }, `nothing serves \`${include.path}\`, so its definitions are missing`));
  }

  return found;
}

/**
 * Legacy syntax still gets a warning when the source dialect is unknown.
 * Only 3.1-safe sigil edits are offered here; TK2 conversion needs an explicit
 * dialect and is exposed by the language server's migration action.
 */
function dialectDiagnostics(source: string): Diagnostic[] {
  const found: Diagnostic[] = [];
  for (const [index, line] of source.split("\n").entries()) {
    const match = /^(\s*)#(\w+)\s*(?:\((.*)\))?\s*$/.exec(line);
    if (match === null) continue;
    const name = match[2]!.toLowerCase();
    const argument = match[3];
    const rule: RuleId | undefined = ["dos", "windows", "gone", "over", "reset", "win"].includes(name)
      ? "dialect/obsolete-control"
      : name === "returnmethod" && argument !== undefined
        ? "dialect/return-method"
        : argument !== undefined && !/^".*"$/.test(argument.trim())
          ? "dialect/unquoted-command-argument"
          : undefined;
    if (rule === undefined) continue;
    found.push({
      code: rule,
      severity: "warning",
      range: { start: { line: index + 1, column: match[1]!.length + 1 }, end: { line: index + 1, column: line.length } },
      message: `Legacy Toolkit 2.x syntax: select the Toolkit 2.x language mode to review a behavior-preserving conversion.`,
      rule,
    });
  }
  for (const fix of legacyFixes(source)) {
    const [first] = fix.edits;
    if (first === undefined) throw new Error(`${fix.rule} produced no edit`);
    found.push({
      code: fix.rule,
      severity: "warning",
      range: first.range,
      message: fix.title,
      rule: fix.rule,
      fix: fix.edits.map((item) => ({ ...item, rule: fix.rule })),
    });
  }
  return found.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.column - b.range.start.column);
}

function ignored(diagnostic: Diagnostic, file: string, config: LintConfig): boolean {
  return (config.ignore ?? []).some((entry) => {
    if (entry.rule !== undefined && entry.rule !== diagnostic.rule) return false;
    if (entry.file !== undefined && foldAscii(entry.file) !== foldAscii(file)) return false;
    if (entry.line !== undefined && entry.line !== diagnostic.range.start.line) return false;
    return true;
  });
}

type CatalogueEntry = ReturnType<typeof commandDocumentation>[number];

const FOLDED_HOST_METHODS: ReadonlySet<string> = new Set([...HOST_METHOD_NAMES].map((name) => foldAscii(name)));

/** The rules that read the parsed program and therefore need a stated 3.1 dialect. */
const PARSED_RULES: readonly RuleId[] = [
  "lint/unused-variable",
  "lint/unused-label",
  "lint/unreachable-code",
  "lint/deprecated-command",
  "lint/obsolete-command",
];

/** Collects findings and unassessed entries for one rule run. */
type Sink = {
  readonly report: (rule: RuleId, site: Site, message: string) => void;
  readonly skip: (rule: RuleId, reason: UnassessedReason) => void;
};

/** Whether a program's parsed facts can be read as 3.1, or why not. */
function parsedReadiness(program: IndexProgram, parsed: ParsedFacts | undefined, dialect: "tk3" | "tk2" | undefined): UnassessedReason | null {
  if (program.diagnostics.length > 0) return "invalid-program";
  if (parsed === undefined) return "missing-source";
  const compiled = parsed.dialect ?? "tk3";
  const stated = parsed.dialect ?? dialect;
  if (stated === undefined) return "unknown-dialect";
  if (stated !== compiled) return "unsupported-dialect";
  // TK2 normalisation moves columns; the original span is not verified (tk2.ts), so no finding is claimed.
  if (stated === "tk2") return "unmapped-source-span";
  return null;
}

function unusedVariables(unit: ProgramUnit, sink: Sink): void {
  for (const scope of scopesOf(unit)) {
    if (scope.kind !== "function" && scope.kind !== "method") continue;
    const declared = new Map<string, { readonly name: string; readonly site: Site }>();
    forEachExpression(scope.body, (expr) => {
      if (expr.kind !== "decl" || expr.scope !== "local") return;
      const name = foldAscii(expr.name);
      if (!declared.has(name)) declared.set(name, { name: expr.name, site: siteOf(unit, expr) });
    }, true);
    if (declared.size === 0) continue;
    if (hasDynamicReference(scope.body)) {
      sink.skip("lint/unused-variable", "dynamic-reference");
      continue;
    }
    const read = mentionsIn(scope.body, { readsOnly: true });
    for (const [name, local] of declared) {
      if (read.has(name)) continue;
      sink.report("lint/unused-variable", local.site, `\`${local.name}\` is declared local but nothing in this function reads, passes, calls or captures it`);
    }
  }
}

function unusedLabels(unit: ProgramUnit, sink: Sink, projectMentions: ReadonlySet<string> | null): void {
  for (const scope of scopesOf(unit)) {
    const labels = labelsIn(scope.body);
    if (labels.length === 0) continue;
    if (hasDynamicReference(scope.body) || hasComputedLabelTarget(scope.body)) {
      sink.skip("lint/unused-label", "dynamic-reference");
      continue;
    }
    let mentioned: ReadonlySet<string>;
    if (scope.kind === "program") {
      // A program-level label can be named from another program; only a closed project can rule that out.
      if (projectMentions === null) {
        sink.skip("lint/unused-label", "incomplete-project");
        continue;
      }
      mentioned = projectMentions;
    } else {
      mentioned = mentionsIn(scope.body, { readsOnly: false });
    }
    for (const label of labels) {
      if (mentioned.has(foldAscii(label.name))) continue;
      sink.report("lint/unused-label", siteOf(unit, label), `nothing in this ${scope.kind === "program" ? "project" : scope.kind} branches to or names the label \`:${label.name}\``);
    }
  }
}

function unreachableCode(unit: ProgramUnit, sink: Sink, isTerminator: (site: Site, name: string) => boolean): void {
  const walk = (block: Block): void => {
    let after: { readonly line: number; readonly what: string } | null = null;
    let reported = false;
    for (const statement of block) {
      if (statement.kind === "label") {
        after = null;
        reported = false;
        continue;
      }
      // A label inside a nested block is a branch target, so the statement holding it can be entered (STX-5).
      if (after !== null && nestedBlocks(statement).some((nested) => labelsIn(nested).length > 0)) {
        after = null;
        reported = false;
      }
      if (after !== null) {
        // A class declaration leaves a placeholder literal statement; it is not code that runs.
        if (statement.kind === "expr" && statement.expr.kind === "literal") continue;
        if (!reported) {
          sink.report("lint/unreachable-code", siteOf(unit, statement), `this statement can never run: the ${after.what} on line ${after.line} leaves the block first and no label follows it`);
          reported = true;
        }
        continue;
      }
      for (const nested of nestedBlocks(statement)) walk(nested);
      if (statement.kind === "return") {
        after = { line: statement.line, what: "`return`" };
      } else if (statement.kind === "expr" && statement.expr.kind === "call" && statement.expr.file === undefined && isTerminator(siteOf(unit, statement.expr), statement.expr.name)) {
        after = { line: statement.line, what: `built-in \`${statement.expr.name}\`` };
      }
    }
  };
  for (const scope of scopesOf(unit)) {
    if (scope.body.length > 0 && (hasErrorHandler(scope.body) || hasDynamicReference(scope.body))) {
      sink.skip("lint/unreachable-code", "dynamic-reference");
      continue;
    }
    walk(scope.body);
  }
}

function retiredCommands(unit: ProgramUnit, sink: Sink, catalogue: Catalogue, bound: ReadonlySet<string>): void {
  for (const scope of scopesOf(unit)) {
    forEachExpression(scope.body, (expr) => {
      if (expr.kind !== "call" || expr.file !== undefined) return;
      const site = siteOf(unit, expr);
      if (bound.has(siteKey(site))) return;
      const entry = catalogue.byName.get(foldAscii(expr.name));
      if (entry === undefined) return;
      const rule: RuleId | null = entry.tags.includes("obsolete") ? "lint/obsolete-command" : entry.tags.includes("deprecated") ? "lint/deprecated-command" : null;
      if (rule === null) return;
      sink.report(rule, site, retiredMessage(expr.name, entry, rule === "lint/obsolete-command" ? "obsolete" : "deprecated"));
    }, false);
  }
}

function retiredMessage(written: string, entry: CatalogueEntry, status: "deprecated" | "obsolete"): string {
  const replacement = entry.replacedBy === null
    ? ""
    : entry.replacedBy.kind === "command"
      ? ` Use \`${entry.replacedBy.name}\` in new code, checking its defaults and waits first.`
      : ` ${entry.replacedBy.text.replace(/\.?$/, ".")}`;
  const reason = entry.reason === null ? "" : ` ${entry.reason.replace(/\.?$/, ".")}`;
  return `\`${written}\` is ${status} in the command catalogue.${replacement}${reason}`;
}

function styleFindings(source: string, sink: Sink): Diagnostic[] {
  const formatted = formatSource(source, { dialect: "tk3" });
  if (!formatted.changed) return [];
  const before = source.split("\n");
  const after = formatted.text.split("\n");
  // TOOL-4 never joins or splits lines; if the count differs, no line-exact edit is known.
  if (before.length !== after.length) {
    sink.skip("style/format", "unmapped-source-span");
    return [];
  }
  const rule = ruleOf("style/format");
  const found: Diagnostic[] = [];
  before.forEach((line, index) => {
    const original = line.replace(/\r$/, "");
    const wanted = after[index]!.replace(/\r$/, "");
    if (original === wanted || original.length === 0) return;
    const range = { start: { line: index + 1, column: 1 }, end: { line: index + 1, column: original.length } };
    found.push({
      code: rule.id,
      severity: rule.defaultSeverity,
      range,
      message: "This line differs from the formatter's output (TOOL-4: indentation by brace depth and canonical casing).",
      rule: rule.id,
      fix: [{ range, newText: wanted, rule: rule.id }],
    });
  });
  return found;
}

/** Every name any program of a closed project mentions, or why the project cannot be read whole. */
const DYNAMIC_PROJECT_CALLS = new Set(["include", "thread", "tellthread", "mainfile", "redirect", "killredirect", "killallredirects"]);
const PROGRAM_CALLS = new Set(["run", "executeprogram", "replaceprogram", "change", "prg"]);

function projectFacts(document: IndexDocument, dialect: "tk3" | "tk2" | undefined, entryPoints: readonly string[]): { readonly mentions: Set<string> } | { readonly reason: UnassessedReason } {
  const mentions = new Set<string>(entryPoints.map((name) => foldAscii(name)));
  for (const program of document.programs) {
    const parsed = parsedOf(program);
    const readiness = parsedReadiness(program, parsed, dialect);
    if (readiness !== null) return { reason: readiness };
    if (program.includes.some((include) => include.key === undefined)) return { reason: "incomplete-project" };
    for (const unit of parsed!.units) {
      for (const scope of scopesOf(unit)) {
        if (hasDynamicReference(scope.body)) return { reason: "dynamic-reference" };
        let dynamicProgram = false;
        forEachExpression(scope.body, (expr) => {
          if (expr.kind !== "call" || expr.file !== undefined) return;
          const name = foldAscii(expr.name);
          if (DYNAMIC_PROJECT_CALLS.has(name)) dynamicProgram = true;
          const file = expr.args[0];
          if (PROGRAM_CALLS.has(name) && (file?.kind !== "literal" || typeof file.value !== "string")) dynamicProgram = true;
        }, false);
        if (dynamicProgram) return { reason: "dynamic-reference" };
        for (const name of mentionsIn(scope.body, { readsOnly: false })) mentions.add(name);
      }
    }
    for (const reference of program.references) if (reference.name !== null) mentions.add(foldAscii(reference.name));
    for (const call of program.calls) mentions.add(foldAscii(call.name));
  }
  return { mentions };
}

/**
 * Lint every program of an index. Severity comes from the config's override or
 * the rule's default; a rule set to `off` is not run and is named in the summary;
 * an ignore entry removes a finding and is counted; a rule that could not be
 * assessed for a program is listed in `summary.unassessed`.
 */
export function lint(document: IndexDocument, options: LintOptions): LintResult {
  const catalogue = catalogueOf(options.plugins);
  const config = options.config ?? {};
  const disabled: string[] = [];
  const enabledIds = new Set<string>();
  for (const rule of RULES) {
    const override = config.severity?.[rule.id];
    if (override === "off") disabled.push(rule.id);
    else enabledIds.add(rule.id);
  }
  const severityOf = (rule: RuleDefinition): LintSeverity => {
    const override = config.severity?.[rule.id];
    return override === undefined || override === "off" ? rule.defaultSeverity : override;
  };
  const diagnostics: Diagnostic[] = [];
  const programs: string[] = [];
  const unassessed = new Map<string, Unassessed>();
  let ignoredRanges = 0;

  const emit = (found: Diagnostic, programName: string): void => {
    if (found.rule === undefined || !enabledIds.has(found.rule)) return;
    const rule = ruleOf(found.rule as RuleId);
    if (ignored(found, programName, config)) {
      ignoredRanges += 1;
      return;
    }
    diagnostics.push({ ...found, severity: severityOf(rule) });
    programs.push(programName);
  };
  const skip = (file: string, rule: RuleId, reason: UnassessedReason): void => {
    if (!enabledIds.has(rule)) return;
    const key = `${file}\u0000${rule}\u0000${reason}`;
    if (!unassessed.has(key)) unassessed.set(key, { file, rule, reason });
  };

  const project = options.project;
  const facts = project === undefined ? null : projectFacts(document, options.dialect, project.entryPoints);
  const projectMentions = facts !== null && "mentions" in facts ? facts.mentions : null;
  const reportedFunctions = new Set<string>();
  const programKeys = new Set(document.programs.map((program) => program.key));

  for (const program of document.programs) {
    const parsed = parsedOf(program);
    const bound = parsed === undefined ? { sites: new Set<string>(), assigned: new Set<string>() } : boundCallSites(parsed.units, FOLDED_HOST_METHODS);
    for (const found of rulesFor(program, catalogue, options, bound.sites)) emit(found, program.name);
    const source = options.sources?.[program.name];
    if (source !== undefined) for (const found of dialectDiagnostics(source)) emit(found, program.name);

    const scoped: Diagnostic[] = [];
    const sink: Sink = {
      report: (ruleId, site, message) => scoped.push(diagnostic(ruleOf(ruleId), ruleOf(ruleId).defaultSeverity, site, message)),
      skip: (ruleId, reason) => skip(program.name, ruleId, reason),
    };
    const readiness = parsedReadiness(program, parsed, options.dialect);
    const main = parsed?.units[0];
    if (readiness !== null || main === undefined) {
      for (const rule of PARSED_RULES) skip(program.name, rule, readiness ?? "missing-source");
    } else {
      const isTerminator = (site: Site, name: string): boolean => {
        const folded = foldAscii(name);
        return TERMINATOR_NAMES.has(folded) && !bound.sites.has(siteKey(site)) && catalogue.byName.get(folded)?.canonicalName === "end";
      };
      if (enabledIds.has("lint/unused-variable")) unusedVariables(main, sink);
      if (enabledIds.has("lint/unused-label")) unusedLabels(main, sink, project === undefined ? null : projectMentions);
      if (enabledIds.has("lint/unreachable-code")) unreachableCode(main, sink, isTerminator);
      if (enabledIds.has("lint/deprecated-command") || enabledIds.has("lint/obsolete-command")) retiredCommands(main, sink, catalogue, bound.sites);
    }

    if (enabledIds.has("style/format")) {
      const stated = parsed?.dialect ?? options.dialect;
      if (program.diagnostics.length > 0) skip(program.name, "style/format", "invalid-program");
      else if (stated === "tk2") skip(program.name, "style/format", "unsupported-dialect");
      else if (source === undefined) skip(program.name, "style/format", "missing-source");
      else if (stated === undefined) skip(program.name, "style/format", "unknown-dialect");
      else scoped.push(...styleFindings(source, sink));
    }

    if (enabledIds.has("lint/unused-function") && program.functions.length > 0) {
      if (project === undefined) skip(program.name, "lint/unused-function", "incomplete-project");
      else if (projectMentions === null) skip(program.name, "lint/unused-function", (facts as { readonly reason: UnassessedReason }).reason);
      else {
        for (const fn of program.functions) {
          if (fn.className !== null) continue;
          // A function shared through an include is reported once, by the program whose main unit defines it;
          // one in a unit no program of the index owns is not checked, and says so.
          if (fn.file !== program.key) {
            if (!programKeys.has(fn.file)) skip(program.name, "lint/unused-function", "incomplete-project");
            continue;
          }
          // Every inline program has the key `<inline>`, so its name keeps two inline programs' functions apart.
          const identity = fn.file === "<inline>" ? `${program.name}\u0000${fn.id}` : fn.id;
          if (reportedFunctions.has(identity)) continue;
          reportedFunctions.add(identity);
          if (projectMentions.has(foldAscii(fn.name))) continue;
          const pos: IndexPos = { file: fn.file, line: fn.line, ...(fn.col === undefined ? {} : { col: fn.col }), ...(fn.endCol === undefined ? {} : { endCol: fn.endCol }) };
          scoped.push(diagnostic(ruleOf("lint/unused-function"), "hint", pos, `no static use of \`${fn.name}\` was found in this project and it is not a declared entry point`));
        }
      }
    }

    scoped.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.column - b.range.start.column);
    for (const found of scoped) emit(found, program.name);
  }
  return {
    diagnostics,
    programs,
    summary: { diagnostics: diagnostics.length, disabledRules: disabled, ignoredRanges, unassessed: [...unassessed.values()] },
  };
}
