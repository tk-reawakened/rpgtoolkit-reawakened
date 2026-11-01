/**
 * Minimal argv parser for `tkr script`. `tkr` is one binary with groups; the
 * only group today is `script`, so the invocation is `tkr script <subcommand>`.
 */

export type SubcommandName = "check" | "fmt" | "test" | "docs" | "index";

export type ParsedArgs = {
  readonly subcommand: SubcommandName;
  readonly paths: readonly string[];
  readonly json: boolean;
  readonly check: boolean;
  readonly out: string | null;
  readonly dialect: "tk3" | "tk2";
  readonly strict: boolean;
};

export type ParseError = {
  readonly ok: false;
  readonly message: string;
  /** A valid subcommand if argument parsing reached one. */
  readonly subcommand: SubcommandName | null;
  /** The raw token the user supplied as a subcommand, even if invalid. */
  readonly attemptedSubcommand: string | null;
};

const SUBCOMMANDS: Record<string, SubcommandName> = {
  check: "check",
  fmt: "fmt",
  test: "test",
  docs: "docs",
  index: "index",
};

const USAGE = "usage: tkr script <check|fmt|test|docs|index> [options] <paths...>";

export function parseArgs(argv: readonly string[]): { readonly ok: true; readonly args: ParsedArgs } | ParseError {
  const args = argv.slice(2);
  if (args.length === 0) return { ok: false, message: USAGE, subcommand: null, attemptedSubcommand: null };

  const group = args[0];
  if (group !== "script") {
    return { ok: false, message: `expected group "script", got ${group === undefined ? "nothing" : `"${group}"`}\n${USAGE}`, subcommand: null, attemptedSubcommand: null };
  }

  if (args.length === 1) return { ok: false, message: USAGE, subcommand: null, attemptedSubcommand: null };

  const attempted = args[1]!;
  const subcommand = SUBCOMMANDS[attempted];
  if (subcommand === undefined) {
    return { ok: false, message: `unknown subcommand: ${attempted}\n${USAGE}`, subcommand: null, attemptedSubcommand: attempted };
  }

  let json = false;
  let check = false;
  let out: string | null = null;
  let dialect: "tk3" | "tk2" = "tk3";
  let strict = true;
  const paths: string[] = [];

  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--json") {
      json = true;
    } else if (arg === "--check") {
      check = true;
    } else if (arg === "--out") {
      const value = args[index + 1];
      if (value === undefined) return { ok: false, message: "--out requires a value", subcommand, attemptedSubcommand: subcommand };
      out = value;
      index += 1;
    } else if (arg.startsWith("--out=")) {
      out = arg.slice("--out=".length);
    } else if (arg === "--dialect") {
      const value = args[index + 1];
      if (value !== "tk3" && value !== "tk2") return { ok: false, message: "--dialect must be tk3 or tk2", subcommand, attemptedSubcommand: subcommand };
      dialect = value;
      index += 1;
    } else if (arg.startsWith("--dialect=")) {
      const value = arg.slice("--dialect=".length);
      if (value !== "tk3" && value !== "tk2") return { ok: false, message: "--dialect must be tk3 or tk2", subcommand, attemptedSubcommand: subcommand };
      dialect = value;
    } else if (arg === "--no-strict") {
      strict = false;
    } else if (arg.startsWith("-")) {
      return { ok: false, message: `unknown option: ${arg}`, subcommand, attemptedSubcommand: subcommand };
    } else {
      paths.push(arg);
    }
  }

  if (subcommand === "test" && paths.length === 0) {
    // test defaults to the current working directory if no path is given.
    paths.push(".");
  }

  if (paths.length === 0 && subcommand !== "test" && subcommand !== "docs") {
    return { ok: false, message: `tkr script ${subcommand}: at least one path is required`, subcommand, attemptedSubcommand: subcommand };
  }

  return {
    ok: true,
    args: {
      subcommand,
      paths,
      json,
      check,
      out,
      dialect,
      strict,
    },
  };
}
